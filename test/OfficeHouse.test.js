const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CURVE_SHARES, MIN_VOTING, officeRules, houseOpenArgs, deployHouseFactory } = require("./openHouse");

describe("OfficeHouse", function () {
  const PERIOD = MIN_VOTING;

  async function openOffice(platform = ethers.ZeroAddress, platformBps = 0) {
    const [head, heir, cousin, stranger, ...rest] = await ethers.getSigners();
    const treasury = rest[4] || rest[rest.length - 1];
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
    const houses = await deployHouseFactory(await factory.certificate(), platform, platformBps);
    const openedHouse = await houses.connect(head).openHouse(
      houseOpenArgs({
        certificate: await factory.certificate(),
        tokenId: opened.tokenId,
        pot: opened.account,
        stock: await stock.getAddress(),
        cash: await cash.getAddress(),
        votingPeriod: PERIOD,
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
    const curve = await ethers.getContractAt("FamilyLaunchCurve", houseLog.args.curve);
    return { head, heir, cousin, stranger, treasury, cash, factory, opened, stock, houses, house, share, book, curve };
  }

  it("lets the head hand out shares that receive a stock drop and stay transferable", async function () {
    const { head, heir, cousin, stock, house, share, opened, book } = await openOffice();
    await house.connect(head).grant(heir.address, ethers.parseEther("60"));
    await house.connect(head).grant(cousin.address, ethers.parseEther("40"));
    expect(await share.totalSupply()).to.equal(CURVE_SHARES + ethers.parseEther("100"));
    expect(await house.circulatingShares()).to.equal(ethers.parseEther("100"));
    expect(await book.getAddress()).to.not.equal(ethers.ZeroAddress);

    await stock.mint(head.address, 1_000_000n);
    await stock.connect(head).approve(await house.getAddress(), 1_000_000n);
    await house.connect(head).deposit(1_000_000n);

    expect(await stock.balanceOf(opened.account)).to.equal(300_000n);
    expect(await house.owed(heir.address)).to.equal(420_000n);
    expect(await house.owed(cousin.address)).to.equal(280_000n);

    await house.connect(heir).claim();
    expect(await stock.balanceOf(heir.address)).to.equal(420_000n);

    await share.connect(heir).transfer(cousin.address, ethers.parseEther("60"));
    expect(await house.owed(heir.address)).to.equal(0n);
    expect(await house.owed(cousin.address)).to.equal(280_000n);
    expect(await share.balanceOf(cousin.address)).to.equal(ethers.parseEther("100"));
    expect(await house.isSeat(cousin.address)).to.equal(false);
  });

  it("keeps unpaid stock on the seller as pending instead of pushing inside the ERC-20 hook", async function () {
    const { head, heir, cousin, stock, house, share } = await openOffice();
    await house.connect(head).grant(heir.address, ethers.parseEther("60"));
    await house.connect(head).grant(cousin.address, ethers.parseEther("40"));
    await stock.mint(head.address, 1_000_000n);
    await stock.connect(head).approve(await house.getAddress(), 1_000_000n);
    await house.connect(head).deposit(1_000_000n);

    await share.connect(heir).transfer(cousin.address, ethers.parseEther("10"));
    expect(await stock.balanceOf(heir.address)).to.equal(0n);
    expect(await house.owed(heir.address)).to.equal(420_000n);
    expect(await house.owed(cousin.address)).to.equal(280_000n);
    expect(await share.balanceOf(cousin.address)).to.equal(ethers.parseEther("50"));
    await house.connect(heir).claim();
    expect(await stock.balanceOf(heir.address)).to.equal(420_000n);
    expect(await house.owed(heir.address)).to.equal(0n);
  });

  it("passes a payee change only when named seats vote a majority", async function () {
    const { head, heir, cousin, house } = await openOffice();
    await house.connect(head).addSeat(heir.address);
    await house.connect(head).addSeat(cousin.address);
    const id = await house.connect(head).proposePayee.staticCall(0, 10_000, 0);
    await house.connect(head).proposePayee(0, 10_000, 0);
    await house.connect(head).vote(id, true);
    await house.connect(heir).vote(id, true);
    await expect(house.execute(id)).to.be.revertedWithCustomError(house, "TooEarly");
    await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
    await ethers.provider.send("evm_mine", []);
    await house.execute(id);
    expect(await house.holderBps()).to.equal(10_000);
    expect(await house.potBps()).to.equal(0);
  });

  it("does not pay the launch curve the stock sitting on unsold shares", async function () {
    const { head, heir, stock, house, curve } = await openOffice();
    await house.connect(head).grant(heir.address, ethers.parseEther("100"));
    await stock.mint(head.address, 1_000_000n);
    await stock.connect(head).approve(await house.getAddress(), 1_000_000n);
    await house.connect(head).deposit(1_000_000n);
    expect(await house.owed(heir.address)).to.equal(700_000n);
    expect(await house.owed(await curve.getAddress())).to.equal(0n);
  });

  it("rejects a stranger vote and a failed majority", async function () {
    const { head, heir, stranger, house } = await openOffice();
    await house.connect(head).addSeat(heir.address);
    await house.connect(head).proposePayee(10_000, 0, 0);
    await expect(house.connect(stranger).vote(0, true)).to.be.revertedWithCustomError(house, "NotSeat");
    await house.connect(head).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [Number(PERIOD) + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(house.execute(0)).to.be.revertedWithCustomError(house, "NotPassed");
  });

  it("takes the factory platform cut before the family split", async function () {
    const signers = await ethers.getSigners();
    const treasury = signers[9];
    const withCut = await openOffice(treasury.address, 100);
    expect(await withCut.house.platform()).to.equal(treasury.address);
    expect(await withCut.house.platformBps()).to.equal(100);
    expect(await withCut.houses.platformBps()).to.equal(100);

    await withCut.house.connect(withCut.head).grant(withCut.heir.address, ethers.parseEther("60"));
    await withCut.house.connect(withCut.head).grant(withCut.cousin.address, ethers.parseEther("40"));
    await withCut.stock.mint(withCut.head.address, 1_000_000n);
    await withCut.stock.connect(withCut.head).approve(await withCut.house.getAddress(), 1_000_000n);
    await expect(withCut.house.connect(withCut.head).deposit(1_000_000n))
      .to.emit(withCut.house, "PlatformPaid")
      .withArgs(treasury.address, 10_000n);

    expect(await withCut.stock.balanceOf(treasury.address)).to.equal(10_000n);
    expect(await withCut.stock.balanceOf(withCut.opened.account)).to.equal(297_000n);
    expect(await withCut.house.owed(withCut.heir.address)).to.equal(415_800n);
    expect(await withCut.house.owed(withCut.cousin.address)).to.equal(277_200n);
  });

  it("routes a 15% factory platform cut before the family split", async function () {
    const signers = await ethers.getSigners();
    const treasury = signers[9];
    const withCut = await openOffice(treasury.address, 1_500);
    expect(await withCut.house.platform()).to.equal(treasury.address);
    expect(await withCut.house.platformBps()).to.equal(1_500);
    expect(await withCut.houses.platformBps()).to.equal(1_500);

    await withCut.house.connect(withCut.head).grant(withCut.heir.address, ethers.parseEther("60"));
    await withCut.house.connect(withCut.head).grant(withCut.cousin.address, ethers.parseEther("40"));
    await withCut.stock.mint(withCut.head.address, 1_000_000n);
    await withCut.stock.connect(withCut.head).approve(await withCut.house.getAddress(), 1_000_000n);
    await expect(withCut.house.connect(withCut.head).deposit(1_000_000n))
      .to.emit(withCut.house, "PlatformPaid")
      .withArgs(treasury.address, 150_000n);

    expect(await withCut.stock.balanceOf(treasury.address)).to.equal(150_000n);
    expect(await withCut.stock.balanceOf(withCut.opened.account)).to.equal(255_000n);
    expect(await withCut.house.owed(withCut.heir.address)).to.equal(357_000n);
    expect(await withCut.house.owed(withCut.cousin.address)).to.equal(238_000n);
  });

  it("refuses a platform cut above 15%", async function () {
    const HouseFactory = await ethers.getContractFactory("OfficeHouseFactory");
    const signers = await ethers.getSigners();
    const treasury = signers[9].address;
    const cert = ethers.Wallet.createRandom().address;
    await expect(HouseFactory.deploy(treasury, 1_501, cert)).to.be.revertedWithCustomError(
      HouseFactory,
      "BadLaunch"
    );
  });

  it("refuses a platform cut with no treasury", async function () {
    const HouseFactory = await ethers.getContractFactory("OfficeHouseFactory");
    const cert = ethers.Wallet.createRandom().address;
    const ok = await HouseFactory.deploy(ethers.ZeroAddress, 0, cert);
    await ok.waitForDeployment();
    await expect(HouseFactory.deploy(ethers.ZeroAddress, 100, cert)).to.be.revertedWithCustomError(
      ok,
      "BadLaunch"
    );
  });

  it("freezes grants and proposals when the head closes the letter", async function () {
    const { head, heir, house } = await openOffice();
    await house.connect(head).freeze();
    await expect(house.connect(head).grant(heir.address, 1)).to.be.revertedWithCustomError(house, "FrozenHouse");
    await expect(house.connect(head).proposePayee(10_000, 0, 0)).to.be.revertedWithCustomError(
      house,
      "FrozenHouse"
    );
  });

  it("caps grants at maxSupply and migrates the seat when the plate moves", async function () {
    const { head, heir, stranger, factory, opened, house, share } = await openOffice();
    const leftover = (await house.maxSupply()) - (await share.totalSupply());
    await expect(house.connect(head).grant(heir.address, leftover + 1n)).to.be.revertedWithCustomError(
      house,
      "BadSeat"
    );
    const nft = await ethers.getContractAt("HeirEstateCertificate", await factory.certificate());
    await nft.connect(head).transferFrom(head.address, stranger.address, opened.tokenId);
    await house.connect(stranger).syncHead();
    expect(await house.isSeat(stranger.address)).to.equal(true);
    expect(await house.isSeat(head.address)).to.equal(false);
    expect(await house.patriarch()).to.equal(stranger.address);
  });
});
