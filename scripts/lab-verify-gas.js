/**
 * Local-only: bytecode sizes against Robinhood Chain's 24kb cap, plus create estimates.
 *
 *   npx hardhat run scripts/lab-verify-gas.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const MAX_RH = 24576;

async function estimateDeploy(name, factory, args = []) {
  const tx = await factory.getDeployTransaction(...args);
  const gas = await hre.ethers.provider.estimateGas({
    from: tx.from || (await hre.ethers.getSigners())[0].address,
    data: tx.data,
  });
  return {
    name,
    estimateGas: gas.toString(),
    constructorArgs: args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
  };
}

async function main() {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "office-local.json"), "utf8"));
  const names = [
    "MockCashToken",
    "MockStockToken",
    "OfficeFactory",
    "HeirAccount",
    "HeirEstateCertificate",
    "FamilyKitFactory",
    "OfficeHouseFactory",
    "OfficeHouse",
    "FamilyShare",
    "FamilyShareBook",
    "FamilyLaunchCurve",
  ];
  const sizes = [];
  for (const name of names) {
    const art = await hre.artifacts.readArtifact(name);
    const bytes = (art.deployedBytecode.length - 2) / 2;
    sizes.push({
      name,
      deployedBytes: bytes,
      under24kb: bytes <= MAX_RH,
      overBy: bytes > MAX_RH ? bytes - MAX_RH : 0,
    });
  }

  const [deployer, , , , dummyHouse] = await hre.ethers.getSigners();
  const Acc = await hre.ethers.getContractFactory("HeirAccount");
  const Cert = await hre.ethers.getContractFactory("HeirEstateCertificate");
  const House = await hre.ethers.getContractFactory("OfficeHouse");
  const Share = await hre.ethers.getContractFactory("FamilyShare");
  const Book = await hre.ethers.getContractFactory("FamilyShareBook");
  const Curve = await hre.ethers.getContractFactory("FamilyLaunchCurve");
  const estimates = [
    await estimateDeploy("HeirAccount", Acc, [local.factory, false]),
    await estimateDeploy("HeirEstateCertificate", Cert, [local.factory]),
    await estimateDeploy("OfficeHouse", House, [
      local.certificate,
      1n,
      dummyHouse.address,
      local.stock,
      local.cash,
      259200n,
      local.platform,
      local.platformBps,
      hre.ethers.parseEther("200000"),
    ]),
    await estimateDeploy("FamilyShare", Share, ["Practice Shares", "PRAC", dummyHouse.address]),
    await estimateDeploy("FamilyShareBook", Book, [dummyHouse.address, dummyHouse.address, local.stock]),
    await estimateDeploy("FamilyLaunchCurve", Curve, [
      dummyHouse.address,
      dummyHouse.address,
      local.cash,
      dummyHouse.address,
      hre.ethers.parseEther("100000"),
      10_000_000_000n,
      60n,
      local.platform,
    ]),
  ];

  const code = {};
  for (const [key, addr] of Object.entries({
    factory: local.factory,
    certificate: local.certificate,
    implementation: local.implementation,
    cash: local.cash,
    stock: local.stock,
    kitFactory: local.kitFactory,
    houseFactory: local.houseFactory,
  })) {
    const hex = await hre.ethers.provider.getCode(addr);
    code[key] = { address: addr, hasCode: hex !== "0x", bytes: (hex.length - 2) / 2 };
  }

  console.log(JSON.stringify({ deployer: deployer.address, sizes, estimates, code }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
