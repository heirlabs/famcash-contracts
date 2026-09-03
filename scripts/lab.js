/**
 * Deploy MockCashToken + OfficeFactory (registry=0) on Hardhat 31337.
 * Writes office-local.json for local lab config.
 *
 *   npx hardhat run scripts/lab.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function createdContracts(hash) {
  try {
    const trace = await hre.network.provider.send("debug_traceTransaction", [hash, { tracer: "callTracer" }]);
    const found = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "CREATE" || node.type === "CREATE2") {
        found.push({
          type: node.type,
          address: node.to || "",
          gasUsed: String(Number(node.gasUsed || 0)),
        });
      }
      for (const child of node.calls || []) walk(child);
    };
    walk(trace);
    return found;
  } catch {
    return [];
  }
}

async function recordDeploy(name, contract, constructorArgs) {
  const tx = contract.deploymentTransaction();
  const receipt = await tx.wait();
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  return {
    name,
    address: await contract.getAddress(),
    deployer: tx.from,
    tx: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: gasPrice.toString(),
    costWei: (receipt.gasUsed * gasPrice).toString(),
    constructorArgs,
    created: await createdContracts(receipt.hash),
  };
}

const ACCOUNTS = [
  {
    role: "owner",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    label: "Hardhat #0",
  },
  {
    role: "heir",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    shareBps: 6000,
    label: "Hardhat #1",
  },
  {
    role: "heir",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    shareBps: 4000,
    label: "Hardhat #2",
  },
];

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0].address;
  const deploys = [];

  const Cash = await hre.ethers.getContractFactory("MockCashToken");
  const cash = await Cash.deploy();
  await cash.waitForDeployment();
  const cashAddr = await cash.getAddress();
  deploys.push(await recordDeploy("MockCashToken", cash, []));

  const Factory = await hre.ethers.getContractFactory("OfficeFactory");
  const factory = await Factory.deploy(hre.ethers.ZeroAddress, cashAddr);
  await factory.waitForDeployment();
  const factoryDeploy = await recordDeploy("OfficeFactory", factory, [hre.ethers.ZeroAddress, cashAddr]);
  factoryDeploy.nested = {
    certificate: await factory.certificate(),
    implementation: await factory.implementation(),
  };
  deploys.push(factoryDeploy);

  const Stock = await hre.ethers.getContractFactory("MockStockToken");
  const stock = await Stock.deploy();
  await stock.waitForDeployment();
  const stockAddr = await stock.getAddress();
  deploys.push(await recordDeploy("MockStockToken", stock, []));

  const platform = process.env.OFFICE_PLATFORM_TREASURY || hre.ethers.ZeroAddress;
  const platformBps = Number(process.env.OFFICE_PLATFORM_BPS || 0);
  const Houses = await hre.ethers.getContractFactory("OfficeHouseFactory");
  const certificate = await factory.certificate();
  const houses = await Houses.deploy(platform, platformBps, certificate);
  await houses.waitForDeployment();
  deploys.push(await recordDeploy("OfficeHouseFactory", houses, [platform, platformBps, certificate]));
  const kitAddr = await houses.kit();

  const extraAdmin = process.env.OFFICE_EXTRA_ADMIN || "0x751ff033914C2B0C89541dA1760406577E41Ef83";
  const pauserRole = await factory.PAUSER_ROLE();
  await (await factory.grantRole(pauserRole, extraAdmin)).wait();
  await (await houses.grantRole(pauserRole, extraAdmin)).wait();

  const payload = {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    factory: await factory.getAddress(),
    certificate: await factory.certificate(),
    implementation: await factory.implementation(),
    registry: hre.ethers.ZeroAddress,
    cash: cashAddr,
    cashSymbol: "CASH",
    cashDecimals: 6,
    stock: stockAddr,
    stockSymbol: "STOK",
    stockDecimals: 6,
    kitFactory: kitAddr,
    houseFactory: await houses.getAddress(),
    platform,
    platformBps,
    votingPeriod: 259200,
    snipeSeconds: 60,
    curveSupply: "100000",
    graduationQuote: "10000",
    seedQuote: "1000",
    network: hre.network.name,
    deployer,
    extraAdmin,
    deploys,
    accounts: ACCOUNTS,
  };

  const out = path.join(__dirname, "..", "office-local.json");
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
