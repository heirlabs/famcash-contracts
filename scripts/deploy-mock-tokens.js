/**
 * Deploy mintable mock USDG (6) and WETH (18) on a published testnet.
 *
 *   EVM_DEPLOYER_KEY=0x… npx hardhat run scripts/deploy-mock-tokens.js --network robinhoodTestnet
 *
 * Mints a practice balance to the deployer, the operator wallet, and optional
 * extra recipients. Writes office-mocks-<chainId>.json. Does not touch 4663.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const EXPECTED_DEPLOYER = "0x751ff033914C2B0C89541dA1760406577E41Ef83";
const OPERATOR = "0x96706eB471f8759a9A1442F358d3B3b4a02f868B";
const LAB = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
];
const ALLOWED = new Set(["robinhoodTestnet"]);

function recipients(deployer) {
  const extra = String(process.env.MOCK_TOKEN_EXTRA_RECIPIENTS || "")
    .split(",")
    .map((row) => row.trim())
    .filter((row) => /^0x[a-fA-F0-9]{40}$/.test(row));
  return [...new Set([deployer, OPERATOR, ...LAB, ...extra].map((row) => row.toLowerCase()))];
}

async function main() {
  if (!ALLOWED.has(hre.network.name)) {
    throw new Error(`deploy-mock-tokens is for robinhoodTestnet, not ${hre.network.name}`);
  }
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 46630) throw new Error(`refusing chain ${chainId}; only 46630`);

  const [signer] = await hre.ethers.getSigners();
  if (signer.address.toLowerCase() !== EXPECTED_DEPLOYER.toLowerCase()) {
    throw new Error(`unexpected deployer ${signer.address}`);
  }

  const Token = await hre.ethers.getContractFactory("MockMintableToken");
  const usdg = await Token.deploy("Mock USDG", "USDG", 6);
  await usdg.waitForDeployment();
  const usdgTx = usdg.deploymentTransaction();
  const usdgReceipt = await usdgTx.wait();

  const weth = await Token.deploy("Mock WETH", "WETH", 18);
  await weth.waitForDeployment();
  const wethTx = weth.deploymentTransaction();
  const wethReceipt = await wethTx.wait();

  const usdgAmt = hre.ethers.parseUnits(process.env.MOCK_USDG_AMOUNT || "1000000", 6);
  const wethAmt = hre.ethers.parseUnits(process.env.MOCK_WETH_AMOUNT || "100", 18);
  const wallets = recipients(signer.address);
  const mints = [];
  for (const to of wallets) {
    const cashTx = await (await usdg.mint(to, usdgAmt)).wait();
    const stockTx = await (await weth.mint(to, wethAmt)).wait();
    mints.push({
      to,
      usdg: usdgAmt.toString(),
      weth: wethAmt.toString(),
      usdgTx: cashTx.hash,
      wethTx: stockTx.hash,
    });
  }

  const payload = {
    chainId,
    network: hre.network.name,
    rpcUrl: hre.network.config.url,
    deployer: signer.address,
    usdg: {
      address: await usdg.getAddress(),
      symbol: "USDG",
      name: "Mock USDG",
      decimals: 6,
      tx: usdgReceipt.hash,
    },
    weth: {
      address: await weth.getAddress(),
      symbol: "WETH",
      name: "Mock WETH",
      decimals: 18,
      tx: wethReceipt.hash,
    },
    officialUsdg: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    uniswapWeth: "0x7943e237c7F95DA44E0301572D358911207852Fa",
    mints,
  };

  const out = path.join(__dirname, "..", `office-mocks-${chainId}.json`);
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
