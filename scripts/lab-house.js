/**
 * Deploy practice stock + OfficeHouseFactory onto an existing 31337 node.
 * Merges into contracts/office-local.json without replacing the office factory.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const out = path.join(__dirname, "..", "office-local.json");
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};

  const Stock = await hre.ethers.getContractFactory("MockStockToken");
  const stock = await Stock.deploy();
  await stock.waitForDeployment();

  const platform = process.env.OFFICE_PLATFORM_TREASURY || hre.ethers.ZeroAddress;
  const platformBps = Number(process.env.OFFICE_PLATFORM_BPS || 0);
  const certificate = prev.certificate;
  if (!certificate || certificate === hre.ethers.ZeroAddress) {
    throw new Error("office-local.json missing certificate. Run office-lab.js first.");
  }
  const Houses = await hre.ethers.getContractFactory("OfficeHouseFactory");
  const houses = await Houses.deploy(platform, platformBps, certificate);
  await houses.waitForDeployment();

  const payload = {
    ...prev,
    stock: await stock.getAddress(),
    stockSymbol: "STOK",
    stockDecimals: 6,
    kitFactory: await houses.kit(),
    houseFactory: await houses.getAddress(),
    platform,
    platformBps,
    votingPeriod: 259200,
    snipeSeconds: 60,
    curveSupply: "100000",
    graduationQuote: "10000",
    seedQuote: "1000",
  };
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
