const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MIN_INACTIVITY, MIN_GRACE, officeRules } = require("./openHouse");

describe("OfficeFactory", function () {
  async function beneficiaries(heir1, heir2) {
    return [
      { wallet: heir1.address, shareBps: 6000, emailHash: ethers.ZeroHash },
      { wallet: heir2.address, shareBps: 4000, emailHash: ethers.ZeroHash },
    ];
  }

  async function openWith(factory, owner, heir1, heir2) {
    const tx = await factory.connect(owner).openOffice(officeRules(), await beneficiaries(heir1, heir2));
    const receipt = await tx.wait();
    const parsed = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "OfficeOpened");
    return parsed.args;
  }

  it("mints a plate, initializes the account, and lets the heir sweep cash", async function () {
    const [owner, heir1, heir2] = await ethers.getSigners();
    const Cash = await ethers.getContractFactory("MockCashToken");
    const cash = await Cash.deploy();
    await cash.waitForDeployment();

    const Factory = await ethers.getContractFactory("OfficeFactory");
    const factory = await Factory.deploy(ethers.ZeroAddress, await cash.getAddress());
    await factory.waitForDeployment();

    const opened = await openWith(factory, owner, heir1, heir2);
    const account = await ethers.getContractAt("HeirAccount", opened.account);
    const nft = await ethers.getContractAt("HeirEstateCertificate", await factory.certificate());

    expect(await nft.ownerOf(opened.tokenId)).to.equal(owner.address);
    expect(await nft.accountOf(opened.tokenId)).to.equal(opened.account);
    expect(await account.allowedTokenAt(0)).to.equal(await cash.getAddress());
    expect(await account.factory()).to.equal(await factory.getAddress());

    await cash.mint(opened.account, 1_000_000n);
    await owner.sendTransaction({ to: opened.account, value: ethers.parseEther("1") });
    await ethers.provider.send("evm_increaseTime", [Number(MIN_INACTIVITY + MIN_GRACE) + 1]);
    await ethers.provider.send("evm_mine", []);

    await account.connect(heir1).claim();
    expect(await cash.balanceOf(heir1.address)).to.equal(600_000n);
    expect(await nft.locked(opened.tokenId)).to.equal(true);
    await expect(nft.transferFrom(owner.address, heir2.address, opened.tokenId)).to.be.revertedWithCustomError(
      nft,
      "Soulbound"
    );
  });

  it("uses a Tokenbound-shaped registry when one is configured", async function () {
    const [owner, heir1, heir2] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("MockTokenboundRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Factory = await ethers.getContractFactory("OfficeFactory");
    const factory = await Factory.deploy(await registry.getAddress(), ethers.ZeroAddress);
    await factory.waitForDeployment();

    const opened = await openWith(factory, owner, heir1, heir2);
    const account = await ethers.getContractAt("HeirAccount", opened.account);
    expect(await account.beneficiaryCount()).to.equal(2n);
    expect(await account.lastActive()).to.be.greaterThan(0n);
    expect(await account.factory()).to.equal(await factory.getAddress());
  });

  it("allowlists a book pair next to cash so claim can sweep both", async function () {
    const [owner, heir1, heir2] = await ethers.getSigners();
    const Cash = await ethers.getContractFactory("MockCashToken");
    const cash = await Cash.deploy();
    await cash.waitForDeployment();
    const Stock = await ethers.getContractFactory("MockStockToken");
    const stock = await Stock.deploy();
    await stock.waitForDeployment();
    const Factory = await ethers.getContractFactory("OfficeFactory");
    const factory = await Factory.deploy(ethers.ZeroAddress, await cash.getAddress());
    await factory.waitForDeployment();
    const tx = await factory.connect(owner).openOfficeWithTokens(officeRules(), await beneficiaries(heir1, heir2), [
      await stock.getAddress(),
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
    const account = await ethers.getContractAt("HeirAccount", opened.account);
    expect(await account.allowedTokenAt(0)).to.equal(await cash.getAddress());
    expect(await account.allowedTokenAt(1)).to.equal(await stock.getAddress());
  });

  it("locks the shared implementation and pauses opens", async function () {
    const [owner, heir1, heir2, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("OfficeFactory");
    const factory = await Factory.deploy(ethers.ZeroAddress, ethers.ZeroAddress);
    await factory.waitForDeployment();
    const impl = await ethers.getContractAt("HeirAccount", await factory.implementation());
    await expect(
      impl.initialize(
        owner.address,
        1n,
        officeRules(),
        [
          { wallet: stranger.address, shareBps: 10000, emailHash: ethers.ZeroHash },
        ],
        []
      )
    ).to.be.revertedWithCustomError(impl, "AlreadyInitialized");

    await factory.connect(owner).pause();
    await expect(factory.connect(owner).openOffice(officeRules(), await beneficiaries(heir1, heir2))).to.be.revertedWithCustomError(
      factory,
      "EnforcedPause"
    );
    await factory.connect(owner).unpause();
    const opened = await openWith(factory, owner, heir1, heir2);
    expect(opened.tokenId).to.equal(1n);
  });
});
