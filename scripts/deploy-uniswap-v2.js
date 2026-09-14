/**
 * Deploy canonical Uniswap V2 factory + router on a published testnet.
 *
 *   PRIVATE_KEY=0x… npx hardhat run scripts/deploy-uniswap-v2.js --network robinhoodTestnet
 *
 * Uses official MIT bytecode from @uniswap/v2-core and @uniswap/v2-periphery.
 * Does not invent an address. Writes gitignored uniswap-v2-<chainId>.json.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const WETH = {
  46630: "0x7943e237c7F95DA44E0301572D358911207852Fa",
};

function artifact(pkg, name) {
  const built = require(`${pkg}/build/${name}.json`);
  const bytecode = built.bytecode?.object || built.bytecode || built.evm?.bytecode?.object;
  if (!built.abi || !bytecode) throw new Error(`missing ${pkg} ${name} bytecode`);
  return { abi: built.abi, bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}` };
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const weth = WETH[chainId];
  if (!weth) throw new Error(`no published WETH for chain ${chainId}`);
  const wethCode = await hre.ethers.provider.getCode(weth);
  if (wethCode === "0x") throw new Error(`WETH has no code on ${chainId}: ${weth}`);

  const [signer] = await hre.ethers.getSigners();
  const outFile = path.join(__dirname, "..", `uniswap-v2-${chainId}.json`);
  if (fs.existsSync(outFile)) {
    const prior = JSON.parse(fs.readFileSync(outFile, "utf8"));
    const factoryCode = prior.factory ? await hre.ethers.provider.getCode(prior.factory) : "0x";
    const routerCode = prior.router ? await hre.ethers.provider.getCode(prior.router) : "0x";
    if (factoryCode !== "0x" && routerCode !== "0x") {
      console.log(JSON.stringify({ reused: true, ...prior }, null, 2));
      return;
    }
  }

  const factoryArt = artifact("@uniswap/v2-core", "UniswapV2Factory");
  const routerArt = artifact("@uniswap/v2-periphery", "UniswapV2Router02");
  const Factory = new hre.ethers.ContractFactory(factoryArt.abi, factoryArt.bytecode, signer);
  const factory = await Factory.deploy(signer.address);
  await factory.waitForDeployment();
  const factoryTx = factory.deploymentTransaction();
  const factoryReceipt = await factoryTx.wait();

  const Router = new hre.ethers.ContractFactory(routerArt.abi, routerArt.bytecode, signer);
  const router = await Router.deploy(await factory.getAddress(), weth);
  await router.waitForDeployment();
  const routerTx = router.deploymentTransaction();
  const routerReceipt = await routerTx.wait();

  const factoryAddr = await factory.getAddress();
  const routerAddr = await router.getAddress();
  if ((await hre.ethers.provider.getCode(factoryAddr)) === "0x") throw new Error("factory deploy left no code");
  if ((await hre.ethers.provider.getCode(routerAddr)) === "0x") throw new Error("router deploy left no code");
  if ((await router.factory()).toLowerCase() !== factoryAddr.toLowerCase()) throw new Error("router factory mismatch");
  if ((await router.WETH()).toLowerCase() !== weth.toLowerCase()) throw new Error("router WETH mismatch");

  const record = {
    chainId,
    deployer: signer.address,
    weth,
    factory: factoryAddr,
    factoryTx: factoryReceipt.hash,
    router: routerAddr,
    routerTx: routerReceipt.hash,
    source: "uniswap-v2-core@1.0.1 + uniswap-v2-periphery@1.1.0-beta.0 official bytecode",
  };
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
