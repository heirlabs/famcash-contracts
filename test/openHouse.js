const { ethers } = require("hardhat");

const CURVE_SHARES = ethers.parseEther("100000");
const GRADUATION_CASH = 10_000_000_000n;
const SNIPE_SECONDS = 5n;
const MIN_INACTIVITY = 30n * 24n * 60n * 60n;
const MIN_GRACE = 7n * 24n * 60n * 60n;
const MIN_VOTING = 3n * 24n * 60n * 60n;
const DEADLINE = ethers.MaxUint256;

function officeRules(over = {}) {
  return {
    inactivityPeriod: MIN_INACTIVITY,
    gracePeriod: MIN_GRACE,
    oracleEnabled: false,
    jurisdictionId: ethers.ZeroHash,
    ...over,
  };
}

async function deployHouseFactory(certificate, platform = ethers.ZeroAddress, platformBps = 0) {
  const HouseFactory = await ethers.getContractFactory("OfficeHouseFactory");
  const houses = await HouseFactory.deploy(platform, platformBps, certificate);
  await houses.waitForDeployment();
  return houses;
}

function houseOpenArgs({ certificate, tokenId, pot, stock, cash, ...over }) {
  return {
    certificate,
    tokenId,
    pot,
    stock,
    cash,
    shareName: "Logan Shares",
    shareSymbol: "LOGN",
    votingPeriod: MIN_VOTING,
    curveSupply: CURVE_SHARES,
    graduationQuote: GRADUATION_CASH,
    snipeSeconds: SNIPE_SECONDS,
    maxSupply: CURVE_SHARES * 2n,
    ...over,
  };
}

module.exports = {
  CURVE_SHARES,
  GRADUATION_CASH,
  SNIPE_SECONDS,
  MIN_INACTIVITY,
  MIN_GRACE,
  MIN_VOTING,
  DEADLINE,
  officeRules,
  houseOpenArgs,
  deployHouseFactory,
};
