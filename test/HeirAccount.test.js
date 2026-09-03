const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MIN_INACTIVITY, MIN_GRACE, officeRules } = require("./openHouse");

describe("HeirAccount (office Option A)", function () {
  const tokenId = 1n;

  let owner, heir1, heir2, stranger;
  let nft;
  let cash;
  let registry;
  let account;

  const beneficiariesOf = (a, b) => [
    { wallet: a.address, shareBps: 6000, emailHash: ethers.ZeroHash },
    { wallet: b.address, shareBps: 4000, emailHash: ethers.ZeroHash },
  ];

  const warpPastGrace = async () => {
    await ethers.provider.send("evm_increaseTime", [Number(MIN_INACTIVITY + MIN_GRACE) + 1]);
    await ethers.provider.send("evm_mine", []);
  };

  beforeEach(async function () {
    [owner, heir1, heir2, stranger] = await ethers.getSigners();
    const Nft = await ethers.getContractFactory("MockEstateNFT");
    nft = await Nft.deploy();
    await nft.waitForDeployment();
    await nft.mint(owner.address, tokenId);

    const Cash = await ethers.getContractFactory("MockCashToken");
    cash = await Cash.deploy();
    await cash.waitForDeployment();

    const Registry = await ethers.getContractFactory("Mock6551Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    const tx = await registry.createAccount(
      await nft.getAddress(),
      tokenId,
      officeRules(),
      beneficiariesOf(heir1, heir2),
      [await cash.getAddress()]
    );
    const receipt = await tx.wait();
    const created = receipt.logs
      .map((l) => {
        try {
          return registry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "AccountCreated");
    account = await ethers.getContractAt("HeirAccount", created.args.account);
  });

  it("binds token() to the estate NFT", async function () {
    const t = await account.token();
    expect(t.tokenContract).to.equal(await nft.getAddress());
    expect(t.tokenId).to.equal(tokenId);
    expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
  });

  it("lets the owner execute and checkIn while alive", async function () {
    await owner.sendTransaction({ to: await account.getAddress(), value: ethers.parseEther("1") });
    await expect(
      account.connect(owner).execute(heir1.address, ethers.parseEther("0.1"), "0x", 0)
    ).to.changeEtherBalance(heir1, ethers.parseEther("0.1"));
    const before = await account.lastActive();
    await ethers.provider.send("evm_increaseTime", [60]);
    await ethers.provider.send("evm_mine", []);
    await account.connect(owner).checkIn();
    expect(await account.lastActive()).to.be.greaterThan(before);
  });

  it("rejects execute from a stranger and after the timer", async function () {
    await expect(
      account.connect(stranger).execute(stranger.address, 0, "0x", 0)
    ).to.be.revertedWithCustomError(account, "NotSigner");
    await warpPastGrace();
    await expect(
      account.connect(owner).execute(owner.address, 0, "0x", 0)
    ).to.be.revertedWithCustomError(account, "NotSigner");
  });

  it("sweeps ETH and allowlisted cash 60/40 and soulbinds the plate", async function () {
    await owner.sendTransaction({ to: await account.getAddress(), value: ethers.parseEther("10") });
    await cash.mint(await account.getAddress(), 1_000_000n);
    await warpPastGrace();

    await expect(account.connect(heir1).claim()).to.changeEtherBalance(heir1, ethers.parseEther("6"));
    expect(await cash.balanceOf(heir1.address)).to.equal(600_000n);
    expect(await nft.locked(tokenId)).to.equal(true);
    await expect(nft.transferFrom(owner.address, stranger.address, tokenId)).to.be.revertedWithCustomError(
      nft,
      "Soulbound"
    );

    await expect(account.connect(heir2).claim()).to.changeEtherBalance(heir2, ethers.parseEther("4"));
    expect(await cash.balanceOf(heir2.address)).to.equal(400_000n);
    expect(await cash.balanceOf(await account.getAddress())).to.equal(0n);

    await expect(account.connect(heir1).claim()).to.be.revertedWithCustomError(account, "AlreadyClaimed");
    await expect(account.connect(stranger).claim()).to.be.revertedWithCustomError(account, "NotBeneficiary");
  });

  it("leaves later cash stranded until every heir claims, then skimDust pays the last claimant", async function () {
    await cash.mint(await account.getAddress(), 1_000_000n);
    await warpPastGrace();
    await account.connect(heir1).claim();
    expect(await cash.balanceOf(heir1.address)).to.equal(600_000n);
    await cash.mint(await account.getAddress(), 500_000n);
    await expect(account.skimDust()).to.be.revertedWithCustomError(account, "StillOpen");
    await account.connect(heir2).claim();
    expect(await cash.balanceOf(heir2.address)).to.equal(400_000n);
    expect(await cash.balanceOf(await account.getAddress())).to.equal(500_000n);
    await account.skimDust();
    expect(await cash.balanceOf(heir2.address)).to.equal(900_000n);
    expect(await cash.balanceOf(await account.getAddress())).to.equal(0n);
  });

  it("rejects claim before the timer ends", async function () {
    await expect(account.connect(heir1).claim()).to.be.revertedWithCustomError(account, "NotClaimable");
  });

  it("rejects a duplicate allowlist and shares that do not sum to 10000", async function () {
    const cashAddr = await cash.getAddress();
    await expect(
      registry.createAccount(await nft.getAddress(), 2n, officeRules(), beneficiariesOf(heir1, heir2), [
        cashAddr,
        cashAddr,
      ])
    ).to.be.revertedWithCustomError(account, "InvalidAllowlist");

    await expect(
      registry.createAccount(
        await nft.getAddress(),
        3n,
        officeRules(),
        [{ wallet: heir1.address, shareBps: 5000, emailHash: ethers.ZeroHash }],
        [cashAddr]
      )
    ).to.be.revertedWithCustomError(account, "InvalidShares");
  });

  it("rejects duplicate heirs, an oracle flag, and short timers", async function () {
    const cashAddr = await cash.getAddress();
    await expect(
      registry.createAccount(
        await nft.getAddress(),
        4n,
        officeRules(),
        [
          { wallet: heir1.address, shareBps: 6000, emailHash: ethers.ZeroHash },
          { wallet: heir1.address, shareBps: 4000, emailHash: ethers.ZeroHash },
        ],
        [cashAddr]
      )
    ).to.be.revertedWithCustomError(account, "DuplicateBeneficiary");

    await expect(
      registry.createAccount(
        await nft.getAddress(),
        5n,
        officeRules({ oracleEnabled: true }),
        beneficiariesOf(heir1, heir2),
        [cashAddr]
      )
    ).to.be.revertedWithCustomError(account, "InvalidRules");

    await expect(
      registry.createAccount(
        await nft.getAddress(),
        6n,
        officeRules({ inactivityPeriod: 1n, gracePeriod: 0n }),
        beneficiariesOf(heir1, heir2),
        [cashAddr]
      )
    ).to.be.revertedWithCustomError(account, "InvalidRules");
  });

  it("lets the living owner rewrite beneficiaries and reset the timer", async function () {
    await account.connect(owner).setBeneficiaries([
      { wallet: stranger.address, shareBps: 10000, emailHash: ethers.ZeroHash },
    ]);
    expect(await account.beneficiaryCount()).to.equal(1n);
    expect((await account.beneficiaryAt(0)).wallet).to.equal(stranger.address);
    await expect(account.connect(heir1).setBeneficiaries(beneficiariesOf(heir1, heir2))).to.be.revertedWithCustomError(
      account,
      "NotSigner"
    );
  });
});
