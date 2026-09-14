const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockMintableToken", function () {
  it("mints USDG at 6 decimals and WETH at 18", async function () {
    const [deployer, operator] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockMintableToken");
    const usdg = await Token.deploy("Mock USDG", "USDG", 6);
    const weth = await Token.deploy("Mock WETH", "WETH", 18);
    await usdg.waitForDeployment();
    await weth.waitForDeployment();

    expect(await usdg.symbol()).to.equal("USDG");
    expect(await usdg.decimals()).to.equal(6);
    expect(await weth.symbol()).to.equal("WETH");
    expect(await weth.decimals()).to.equal(18);

    await usdg.mint(operator.address, ethers.parseUnits("25", 6));
    await weth.mint(operator.address, ethers.parseUnits("3", 18));
    expect(await usdg.balanceOf(operator.address)).to.equal(ethers.parseUnits("25", 6));
    expect(await weth.balanceOf(operator.address)).to.equal(ethers.parseUnits("3", 18));

    await expect(usdg.connect(operator).mint(deployer.address, 1n)).to.be.reverted;
  });
});
