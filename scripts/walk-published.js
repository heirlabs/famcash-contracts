/**
 * Mint a key and open a house on a published testnet using the last deploy file.
 *
 *   PRIVATE_KEY=0x… npx hardhat run scripts/walk-published.js --network robinhoodTestnet
 *   PRIVATE_KEY=0x… npx hardhat run scripts/walk-published.js --network arcTestnet
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const MIN_INACTIVITY = 30n * 24n * 60n * 60n;
const MIN_GRACE = 7n * 24n * 60n * 60n;
const MIN_VOTING = 3n * 24n * 60n * 60n;
const CURVE_SHARES = hre.ethers.parseEther("100000");

const HEIRS = [
  { wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", shareBps: 6000, emailHash: hre.ethers.ZeroHash },
  { wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", shareBps: 4000, emailHash: hre.ethers.ZeroHash },
];

function loadDeploy(chainId) {
  const named = process.env.OFFICE_PUBLISHED_JSON;
  const file = named || path.join(__dirname, "..", `office-published-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — run deploy-published first`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const deployed = loadDeploy(chainId);
  const [signer] = await hre.ethers.getSigners();
  const cash = process.env.WALK_CASH || deployed.cash;
  const stock = process.env.WALK_STOCK || deployed.stock || cash;

  const factory = await hre.ethers.getContractAt("OfficeFactory", deployed.factory, signer);
  const houses = await hre.ethers.getContractAt("OfficeHouseFactory", deployed.houseFactory, signer);
  const rules = {
    inactivityPeriod: MIN_INACTIVITY,
    gracePeriod: MIN_GRACE,
    oracleEnabled: false,
    jurisdictionId: hre.ethers.ZeroHash,
  };

  let mintTx;
  if (chainId === 5042002) {
    mintTx = await factory.openOfficeWithCash(rules, HEIRS, cash, stock.toLowerCase() === cash.toLowerCase() ? [] : [stock]);
  } else {
    mintTx = await factory.openOfficeWithTokens(rules, HEIRS, [stock]);
  }
  const mintReceipt = await mintTx.wait();
  const parsed = mintReceipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((row) => row && row.name === "OfficeOpened");
  if (!parsed) throw new Error("OfficeOpened missing");

  const tokenId = parsed.args.tokenId;
  const pot = parsed.args.account;
  const houseTx = await houses.openHouse({
    certificate: deployed.certificate,
    tokenId,
    pot,
    stock,
    cash,
    shareName: "Walk shares",
    shareSymbol: "WALK",
    votingPeriod: MIN_VOTING,
    curveSupply: CURVE_SHARES,
    graduationQuote: 10_000_000_000n,
    snipeSeconds: 5n,
    maxSupply: CURVE_SHARES * 2n,
  });
  const houseReceipt = await houseTx.wait();
  const opened = houseReceipt.logs
    .map((log) => {
      try {
        return houses.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((row) => row && row.name === "HouseOpened");
  if (!opened) throw new Error("HouseOpened missing");

  const result = {
    chainId,
    deployer: signer.address,
    factory: deployed.factory,
    houseFactory: deployed.houseFactory,
    cash,
    stock,
    mintTx: mintReceipt.hash,
    tokenId: tokenId.toString(),
    pot,
    certificate: deployed.certificate,
    houseTx: houseReceipt.hash,
    house: opened.args.house,
    share: opened.args.share,
    curve: opened.args.curve,
  };
  const out = path.join(__dirname, "..", `office-walk-${chainId}.json`);
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
