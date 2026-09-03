const { expect } = require("chai");
const { ethers } = require("hardhat");
const { artifacts } = require("hardhat");
const { officeRules, houseOpenArgs, deployHouseFactory, MIN_VOTING } = require("./openHouse");

describe("Office access control and deploy bounds", function () {
  async function deployOffice() {
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
    const opened = (await tx.wait()).logs
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
    return { head, heir, cousin, stranger, cash, stock, factory, houses, opened };
  }

  it("gates mock mint to MINTER_ROLE", async function () {
    const { stranger, cash, stock } = await deployOffice();
    expect(await cash.MINTER_ROLE()).to.equal(ethers.id("MINTER_ROLE"));
    await expect(cash.connect(stranger).mint(stranger.address, 1)).to.be.revertedWithCustomError(
      cash,
      "AccessControlUnauthorizedAccount"
    );
    await expect(stock.connect(stranger).mint(stranger.address, 1)).to.be.revertedWithCustomError(
      stock,
      "AccessControlUnauthorizedAccount"
    );
  });

  it("refuses a second house on the same plate and a pot that is not the bound account", async function () {
    const { head, stranger, cash, stock, factory, houses, opened } = await deployOffice();
    const args = houseOpenArgs({
      certificate: await factory.certificate(),
      tokenId: opened.tokenId,
      pot: opened.account,
      stock: await stock.getAddress(),
      cash: await cash.getAddress(),
    });
    await houses.connect(head).openHouse(args);
    await expect(houses.connect(head).openHouse(args)).to.be.revertedWithCustomError(houses, "BadLaunch");
    const HouseFactory = await ethers.getContractFactory("OfficeHouseFactory");
    const other = await HouseFactory.deploy(ethers.ZeroAddress, 0, await factory.certificate());
    await other.waitForDeployment();
    await expect(
      other.connect(head).openHouse({ ...args, pot: stranger.address, votingPeriod: MIN_VOTING })
    ).to.be.revertedWithCustomError(other, "BadLaunch");
  });

  it("refuses kit deploy from anyone but the house factory", async function () {
    const { stranger, houses } = await deployOffice();
    const kit = await ethers.getContractAt("FamilyKitFactory", await houses.kit());
    await expect(
      kit.connect(stranger).deploy({
        house: stranger.address,
        stock: stranger.address,
        cash: stranger.address,
        pot: stranger.address,
        shareName: "X",
        shareSymbol: "X",
        curveSupply: 1,
        graduationQuote: 4,
        snipeSeconds: 1,
        platform: ethers.ZeroAddress,
      })
    ).to.be.revertedWithCustomError(kit, "AccessControlUnauthorizedAccount");
  });

  it("keeps OfficeHouse under the 24kb Robinhood cap", async function () {
    const art = await artifacts.readArtifact("OfficeHouse");
    const bytes = (art.deployedBytecode.length - 2) / 2;
    expect(bytes).to.be.lte(24_576);
  });
});
