const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  CURVE_SHARES,
  GRADUATION_CASH,
  SNIPE_SECONDS,
  DEADLINE,
  officeRules,
  houseOpenArgs,
  deployHouseFactory,
} = require("./openHouse");

describe("FamilyLaunchCurve", function () {
  const CURVE = CURVE_SHARES;
  const GRAD = GRADUATION_CASH;
  const SNIPE = SNIPE_SECONDS;

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
        curveSupply: CURVE,
        graduationQuote: GRAD,
        snipeSeconds: SNIPE,
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
    const curve = await ethers.getContractAt("FamilyLaunchCurve", await house.curve());
    return { head, heir, cousin, stranger, cash, opened, house, share, curve };
  }

  it("uses the pons decay: 99% at open for everyone, about 25% at one second, zero at five", async function () {
    const { head, stranger, curve } = await openOffice();
    expect(await curve.currentSnipeTaxBps(stranger.address)).to.equal(9900);
    expect(await curve.currentSnipeTaxBps(head.address)).to.equal(9900);
    await ethers.provider.send("evm_increaseTime", [1]);
    await ethers.provider.send("evm_mine", []);
    expect(await curve.currentSnipeTaxBps(stranger.address)).to.equal(2475);
    await ethers.provider.send("evm_increaseTime", [1]);
    await ethers.provider.send("evm_mine", []);
    expect(await curve.currentSnipeTaxBps(stranger.address)).to.equal(309);
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine", []);
    expect(await curve.currentSnipeTaxBps(stranger.address)).to.equal(0);
  });

  it("sends sniper savings to the pot and taxes a named seat the same as the public", async function () {
    const { head, heir, stranger, cash, opened, house, share, curve } = await openOffice();
    const spend = 1_000_000_000n;
    await cash.mint(stranger.address, spend);
    await cash.connect(stranger).approve(await curve.getAddress(), spend);
    const before = await cash.balanceOf(opened.account);
    const buyTx = await curve.connect(stranger).buy(spend, 0, DEADLINE);
    const bought = (await buyTx.wait()).logs
      .map((l) => {
        try {
          return curve.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "Bought");
    const saved = (await cash.balanceOf(opened.account)) - before;
    expect(saved).to.equal(bought.args.savings);
    expect(bought.args[3]).to.be.gt(0);
    expect(bought.args.savings).to.be.gt(0n);
    expect(await share.balanceOf(stranger.address)).to.equal(bought.args.sharesOut);
    expect(await house.isSeat(stranger.address)).to.equal(false);

    await house.connect(head).addSeat(heir.address);
    await cash.mint(heir.address, spend);
    await cash.connect(heir).approve(await curve.getAddress(), spend);
    const heirPreview = await curve.previewBuy(spend, heir.address);
    expect(heirPreview.snipe).to.be.gt(0n);
    await curve.connect(heir).buy(spend, heirPreview.sharesOut, DEADLINE);
    expect(await share.balanceOf(heir.address)).to.equal(heirPreview.sharesOut);
  });

  it("lets the head seed below graduation and sends leftover shares to the pot", async function () {
    const { head, stranger, cash, opened, share, curve } = await openOffice();
    const deposit = 2_000_000_000n;
    await cash.mint(head.address, deposit);
    await cash.connect(head).approve(await curve.getAddress(), deposit);
    await curve.connect(head).seed(deposit);
    expect(await curve.realQuote()).to.equal(deposit);
    await expect(curve.connect(head).seed(GRAD)).to.be.revertedWithCustomError(curve, "BadLaunch");

    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);
    await cash.mint(stranger.address, GRAD);
    await cash.connect(stranger).approve(await curve.getAddress(), GRAD);
    await curve.connect(stranger).buy(GRAD, 0, DEADLINE);
    expect(await curve.graduated()).to.equal(true);
    expect(await share.balanceOf(opened.account)).to.be.gt(0n);
    expect(await share.balanceOf(head.address)).to.equal(0n);
    await expect(curve.connect(head).buy(1_000_000n, 0, DEADLINE)).to.be.revertedWithCustomError(
      curve,
      "ClosedCurve"
    );
  });

  it("buys back from the curve until it fills", async function () {
    const { head, heir, cash, share, curve } = await openOffice();
    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);
    const spend = 500_000_000n;
    await cash.mint(heir.address, spend);
    await cash.connect(heir).approve(await curve.getAddress(), spend);
    const preview = await curve.previewBuy(spend, heir.address);
    await curve.connect(heir).buy(spend, preview.sharesOut, DEADLINE);
    await share.connect(heir).approve(await curve.getAddress(), preview.sharesOut);
    const sell = await curve.previewSell(preview.sharesOut);
    await curve.connect(heir).sell(preview.sharesOut, sell.quoteOut, DEADLINE);
    expect(await share.balanceOf(heir.address)).to.equal(0n);
    expect(sell.quoteOut).to.be.gt(0n);
    expect(await curve.connect(head).currentSnipeTaxBps(head.address)).to.equal(0);
  });

  it("ignores donated shares so sell stays open", async function () {
    const { head, heir, cash, share, curve } = await openOffice();
    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);
    const spend = 500_000_000n;
    await cash.mint(heir.address, spend);
    await cash.connect(heir).approve(await curve.getAddress(), spend);
    const preview = await curve.previewBuy(spend, heir.address);
    await curve.connect(heir).buy(spend, preview.sharesOut, DEADLINE);
    await houseGrantOne(head, heir, share, curve);
    await share.connect(heir).transfer(await curve.getAddress(), 1n);
    const sell = await curve.previewSell(preview.sharesOut / 2n);
    expect(sell.quoteOut).to.be.gt(0n);
  });
});

async function houseGrantOne(head, heir, share, curve) {
  const house = await ethers.getContractAt("OfficeHouse", await curve.house());
  if ((await share.balanceOf(heir.address)) > 1n) return;
  await house.connect(head).grant(heir.address, ethers.parseEther("1"));
}
