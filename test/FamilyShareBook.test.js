const { expect } = require("chai");
const { ethers } = require("hardhat");
const { officeRules, houseOpenArgs, deployHouseFactory } = require("./openHouse");

describe("FamilyShareBook", function () {
  const SHARES = ethers.parseEther("10");
  const PRICE = 2_000_000n;

  async function openOffice() {
    const [head, heir, cousin, stranger] = await ethers.getSigners();
    const Cash = await ethers.getContractFactory("MockCashToken");
    const cash = await Cash.deploy();
    await cash.waitForDeployment();
    const Factory = await ethers.getContractFactory("OfficeFactory");
    const factory = await Factory.deploy(ethers.ZeroAddress, await cash.getAddress());
    await factory.waitForDeployment();
    const tx = await factory.connect(head).openOffice(officeRules(), [
      { wallet: heir.address, shareBps: 6000, emailHash: ethers.ZeroHash },
      { wallet: cousin.address, shareBps: 4000, emailHash: ethers.ZeroHash },
    ]);
    const receipt = await tx.wait();
    const opened = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "OfficeOpened").args;
    const Stock = await ethers.getContractFactory("MockStockToken");
    const stock = await Stock.deploy();
    await stock.waitForDeployment();
    const houses = await deployHouseFactory(await factory.certificate());
    const openedHouse = await houses.connect(head).openHouse(
      houseOpenArgs({
        certificate: await factory.certificate(),
        tokenId: opened.tokenId,
        pot: opened.account,
        stock: await stock.getAddress(),
        cash: await cash.getAddress(),
      })
    );
    const houseLog = (await openedHouse.wait()).logs
      .map((l) => {
        try {
          return houses.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "HouseOpened");
    const house = await ethers.getContractAt("OfficeHouse", houseLog.args.house);
    const share = await ethers.getContractAt("FamilyShare", houseLog.args.share);
    const book = await ethers.getContractAt("FamilyShareBook", await house.book());
    return { head, heir, cousin, stranger, stock, house, share, book };
  }

  it("lets a cousin take an ask and keeps the seat with the seller", async function () {
    const { head, heir, cousin, stock, house, share, book } = await openOffice();
    await house.connect(head).grant(heir.address, ethers.parseEther("60"));
    await house.connect(head).addSeat(heir.address);

    await share.connect(heir).approve(await book.getAddress(), SHARES);
    await book.connect(heir).postAsk(PRICE, SHARES);
    expect(await share.balanceOf(await book.getAddress())).to.equal(SHARES);

    const cost = await book.quoteFor(SHARES, PRICE);
    expect(cost).to.equal(20_000_000n);
    await stock.mint(cousin.address, cost);
    await stock.connect(cousin).approve(await book.getAddress(), cost);
    await book.connect(cousin).fill(0, SHARES);

    expect(await share.balanceOf(cousin.address)).to.equal(SHARES);
    expect(await share.balanceOf(heir.address)).to.equal(ethers.parseEther("50"));
    expect(await stock.balanceOf(heir.address)).to.equal(cost);
    expect(await house.isSeat(cousin.address)).to.equal(false);
    expect(await house.isSeat(heir.address)).to.equal(true);
    expect(await book.printCount()).to.equal(1n);
    const print = await book.printAt(0);
    expect(print.price).to.equal(PRICE);
    expect(print.shares).to.equal(SHARES);
  });

  it("locks practice stock on a bid and returns it on cancel", async function () {
    const { heir, stock, book } = await openOffice();
    const cost = await book.quoteFor(SHARES, PRICE);
    await stock.mint(heir.address, cost);
    await stock.connect(heir).approve(await book.getAddress(), cost);
    await book.connect(heir).postBid(PRICE, SHARES);
    expect(await stock.balanceOf(await book.getAddress())).to.equal(cost);
    await book.connect(heir).cancel(0);
    expect(await stock.balanceOf(heir.address)).to.equal(cost);
    expect(await book.openCount()).to.equal(0);
  });

  it("lets a seller fill a locked bid", async function () {
    const { head, heir, cousin, stock, house, share, book } = await openOffice();
    await house.connect(head).grant(cousin.address, SHARES);
    const cost = await book.quoteFor(SHARES, PRICE);
    await stock.mint(heir.address, cost);
    await stock.connect(heir).approve(await book.getAddress(), cost);
    await book.connect(heir).postBid(PRICE, SHARES);
    await share.connect(cousin).approve(await book.getAddress(), SHARES);
    await book.connect(cousin).fill(0, SHARES);
    expect(await share.balanceOf(heir.address)).to.equal(SHARES);
    expect(await stock.balanceOf(cousin.address)).to.equal(cost);
    const [bidId, bidPrice] = await book.bestBid();
    expect(bidPrice).to.equal(0n);
    expect(bidId).to.equal(0n);
  });

  it("rejects a stranger fill of their own order and a frozen post", async function () {
    const { head, heir, stock, house, share, book } = await openOffice();
    await house.connect(head).grant(heir.address, SHARES);
    await share.connect(heir).approve(await book.getAddress(), SHARES);
    await book.connect(heir).postAsk(PRICE, SHARES);
    await expect(book.connect(heir).fill(0, SHARES)).to.be.revertedWithCustomError(book, "BadOrder");
    await house.connect(head).freeze();
    await stock.mint(head.address, 1);
    await expect(book.connect(head).postBid(PRICE, SHARES)).to.be.revertedWithCustomError(book, "FrozenHouse");
    await book.connect(heir).cancel(0);
    expect(await book.openCount()).to.equal(0);
    expect(await share.balanceOf(heir.address)).to.equal(SHARES);
  });

  it("rejects an ask the maker cannot pay", async function () {
    const { heir, book } = await openOffice();
    await expect(book.connect(heir).postAsk(PRICE, SHARES)).to.be.revertedWithCustomError(book, "UnpaidAsk");
  });
});
