const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArcCash", function () {
  const USDC = "0x3600000000000000000000000000000000000000";

  it("treats only Arc + the USDC predeploy as native cash", async function () {
    const Harness = await ethers.getContractFactory("ArcCashHarness");
    const harness = await Harness.deploy();
    await harness.waitForDeployment();

    expect(await harness.isArc(5042)).to.equal(true);
    expect(await harness.isArc(5042002)).to.equal(true);
    expect(await harness.isArc(4663)).to.equal(false);
    expect(await harness.isArc(31337)).to.equal(false);

    expect(await harness.nativeIsCash(5042, USDC)).to.equal(true);
    expect(await harness.nativeIsCash(5042002, USDC)).to.equal(true);
    expect(await harness.nativeIsCash(4663, USDC)).to.equal(false);
    expect(await harness.nativeIsCash(5042, ethers.ZeroAddress)).to.equal(false);
    const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
    expect(await harness.nativeIsCash(5042, EURC)).to.equal(false);
    expect(await harness.nativeIsCash(5042002, EURC)).to.equal(false);
  });
});
