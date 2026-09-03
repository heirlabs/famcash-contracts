/**
 * Lab deploy only. Do not point this at 4663 until the cash token is real,
 * the house factory is under 24kb (kit + house split), and HeirAccount.claim
 * has been rehearsed on 46630.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 */
const hre = require("hardhat");

async function main() {
  const registry = process.env.OFFICE_TOKENBOUND_REGISTRY || hre.ethers.ZeroAddress;
  const cash = process.env.OFFICE_CASH_TOKEN || hre.ethers.ZeroAddress;
  const Factory = await hre.ethers.getContractFactory("OfficeFactory");
  const factory = await Factory.deploy(registry, cash);
  await factory.waitForDeployment();
  const certificate = await factory.certificate();
  const implementation = await factory.implementation();
  console.log(
    JSON.stringify(
      {
        factory: await factory.getAddress(),
        certificate,
        implementation,
        registry,
        cash,
        network: hre.network.name,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
