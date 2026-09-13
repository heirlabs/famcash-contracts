/**
 * Deploy OfficeFactory + OfficeHouseFactory on a published testnet.
 *
 *   PRIVATE_KEY=0x… npx hardhat run scripts/deploy-published.js --network robinhoodTestnet
 *   PRIVATE_KEY=0x… npx hardhat run scripts/deploy-published.js --network arcTestnet
 *
 * Cash tokens are official published addresses only. Do not invent 0x values.
 * Writes office-published-<chainId>.json (gitignored).
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const OFFICIAL_CASH = {
  46630: "0x7E955252E15c84f5768B83c41a71F9eba181802F", // Robinhood testnet USDG
  5042002: "0x3600000000000000000000000000000000000000", // Arc testnet USDC predeploy
};

const OFFICIAL_STOCK = {
  46630: "0x7943e237c7F95DA44E0301572D358911207852Fa", // Robinhood testnet WETH
  5042002: "0x3600000000000000000000000000000000000000",
};

const ALLOWED = new Set(["robinhoodTestnet", "arcTestnet"]);

async function main() {
  if (!ALLOWED.has(hre.network.name)) {
    throw new Error(`deploy-published is for robinhoodTestnet or arcTestnet, not ${hre.network.name}`);
  }
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const cash = process.env.OFFICE_CASH_TOKEN || OFFICIAL_CASH[chainId];
  if (!cash) throw new Error(`no official cash for chain ${chainId}`);
  const registry = process.env.OFFICE_TOKENBOUND_REGISTRY || hre.ethers.ZeroAddress;
  const platform = process.env.OFFICE_PLATFORM_TREASURY || hre.ethers.ZeroAddress;
  const platformBps = Number(process.env.OFFICE_PLATFORM_BPS || 0);
  const extraAdmin = process.env.OFFICE_EXTRA_ADMIN || "0x751ff033914C2B0C89541dA1760406577E41Ef83";

  const [deployer] = await hre.ethers.getSigners();
  const Factory = await hre.ethers.getContractFactory("OfficeFactory");
  const factory = await Factory.deploy(registry, cash);
  await factory.waitForDeployment();
  const factoryTx = factory.deploymentTransaction();
  const factoryReceipt = await factoryTx.wait();
  const certificate = await factory.certificate();
  const implementation = await factory.implementation();

  const Houses = await hre.ethers.getContractFactory("OfficeHouseFactory");
  const houses = await Houses.deploy(platform, platformBps, certificate);
  await houses.waitForDeployment();
  const houseTx = houses.deploymentTransaction();
  const houseReceipt = await houseTx.wait();
  const kit = await houses.kit();

  const pauserRole = await factory.PAUSER_ROLE();
  if (extraAdmin && extraAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await factory.grantRole(pauserRole, extraAdmin)).wait();
    await (await houses.grantRole(pauserRole, extraAdmin)).wait();
  }

  const payload = {
    chainId,
    network: hre.network.name,
    rpcUrl: hre.network.config.url,
    deployer: deployer.address,
    factory: await factory.getAddress(),
    factoryTx: factoryReceipt.hash,
    certificate,
    implementation,
    registry,
    cash,
    stock: OFFICIAL_STOCK[chainId] || "",
    houseFactory: await houses.getAddress(),
    houseFactoryTx: houseReceipt.hash,
    kitFactory: kit,
    platform,
    platformBps,
    extraAdmin,
  };

  const out = path.join(__dirname, "..", `office-published-${chainId}.json`);
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
