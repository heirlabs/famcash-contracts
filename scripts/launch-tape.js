/**
 * Open several published-testnet houses and print at least one book fill each.
 *
 *   PRIVATE_KEY=0x… npx hardhat run scripts/launch-tape.js --network arcTestnet
 *   PRIVATE_KEY=0x… npx hardhat run scripts/launch-tape.js --network robinhoodTestnet
 *
 * Writes gitignored office-tape-<chainId>.json. Does not mint official USDG.
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

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address,uint256) returns (bool)",
  "function deposit() payable",
];
const CURVE = [
  "function seed(uint256)",
  "function buy(uint256,uint256,uint256)",
  "function previewBuy(uint256,address) view returns (uint256,uint256,uint256,uint256)",
];
const BOOK = [
  "function postAsk(uint256,uint256) returns (uint256)",
  "function fill(uint256,uint256)",
  "function printCount() view returns (uint256)",
  "function printAt(uint256) view returns (uint256,uint256,uint64,address,uint256)",
  "function quote() view returns (address)",
];
const SHARE = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

function loadDeploy(chainId) {
  const file = path.join(__dirname, "..", `office-published-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureApprove(token, owner, spender) {
  const connected = token.connect(owner);
  const tx = await connected.approve(spender, hre.ethers.MaxUint256);
  await tx.wait();
}

async function launchOne({
  signer,
  taker,
  factory,
  houses,
  deployed,
  cash,
  stock,
  shareName,
  shareSymbol,
  graduationQuote,
  seedAmt,
  buyAmt,
  askShares,
  askPrice,
}) {
  const rules = {
    inactivityPeriod: MIN_INACTIVITY,
    gracePeriod: MIN_GRACE,
    oracleEnabled: false,
    jurisdictionId: hre.ethers.ZeroHash,
  };
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const mintTx =
    chainId === 5042002
      ? await factory.openOfficeWithCash(rules, HEIRS, cash, stock.toLowerCase() === cash.toLowerCase() ? [] : [stock])
      : await factory.openOfficeWithTokens(rules, HEIRS, stock.toLowerCase() === cash.toLowerCase() ? [] : [stock]);
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

  const houseTx = await houses.openHouse({
    certificate: deployed.certificate,
    tokenId: parsed.args.tokenId,
    pot: parsed.args.account,
    stock,
    cash,
    shareName,
    shareSymbol,
    votingPeriod: MIN_VOTING,
    curveSupply: CURVE_SHARES,
    graduationQuote,
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

  const house = await hre.ethers.getContractAt("OfficeHouse", opened.args.house);
  const curveAddr = await house.curve();
  const bookAddr = await house.book();
  const curve = new hre.ethers.Contract(curveAddr, CURVE, signer);
  const book = new hre.ethers.Contract(bookAddr, BOOK, signer);
  const share = new hre.ethers.Contract(opened.args.share, SHARE, signer);
  const cashTok = new hre.ethers.Contract(cash, ERC20, signer);

  await sleep(6500);

  const out = {
    shareName,
    shareSymbol,
    mintTx: mintReceipt.hash,
    houseTx: houseReceipt.hash,
    tokenId: parsed.args.tokenId.toString(),
    pot: parsed.args.account,
    house: opened.args.house,
    share: opened.args.share,
    curve: curveAddr,
    book: bookAddr,
    cash,
    stock,
  };

  if (seedAmt > 0n) {
    await ensureApprove(cashTok, signer, curveAddr);
    out.seedTx = (await (await curve.seed(seedAmt)).wait()).hash;
  }
  if (buyAmt > 0n) {
    await ensureApprove(cashTok, signer, curveAddr);
    const preview = await curve.previewBuy(buyAmt, signer.address);
    const minOut = preview[0] > 1n ? preview[0] / 2n : 0n;
    out.buyTx = (
      await (await curve.buy(buyAmt, minOut, BigInt(Math.floor(Date.now() / 1000) + 600))).wait()
    ).hash;
  }

  const have = await share.balanceOf(signer.address);
  const sell = have > 0n && askShares > 0n ? (have < askShares ? have : askShares) : 0n;
  if (sell > 0n && askPrice > 0n && taker) {
    await ensureApprove(share, signer, bookAddr);
    const askId = await book.postAsk.staticCall(askPrice, sell);
    out.askTx = (await (await book.postAsk(askPrice, sell)).wait()).hash;
    const cost = (sell * askPrice) / 10n ** 18n;
    if (cost > 0n) {
      const quoteTok = new hre.ethers.Contract(await book.quote(), ERC20, taker);
      await ensureApprove(quoteTok, taker, bookAddr);
      out.fillTx = (await (await book.connect(taker).fill(askId, sell)).wait()).hash;
      out.printCount = (await book.printCount()).toString();
      if (Number(out.printCount) > 0) {
        const p = await book.printAt(0);
        out.print0 = { price: p[0].toString(), shares: p[1].toString(), at: Number(p[2]) };
      }
    }
  }
  return out;
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const [signer] = await hre.ethers.getSigners();
  const taker = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const results = { chainId, deployer: signer.address, taker: taker.address, houses: [] };

  if (chainId === 5042002) {
    const deployed = loadDeploy(5042002);
    const factory = await hre.ethers.getContractAt("OfficeFactory", deployed.factory, signer);
    const houses = await hre.ethers.getContractAt("OfficeHouseFactory", deployed.houseFactory, signer);
    const usdc = new hre.ethers.Contract(USDC, ERC20, signer);
    const eurc = new hre.ethers.Contract(EURC, ERC20, signer);
    results.balances = {
      native: (await hre.ethers.provider.getBalance(signer.address)).toString(),
      usdc: (await usdc.balanceOf(signer.address)).toString(),
      eurc: (await eurc.balanceOf(signer.address)).toString(),
    };
    await (await signer.sendTransaction({ to: taker.address, value: hre.ethers.parseEther("0.15") })).wait();
    await (await usdc.transfer(taker.address, 2_000_000n)).wait();
    results.houses.push(
      await launchOne({
        signer,
        taker,
        factory,
        houses,
        deployed,
        cash: USDC,
        stock: USDC,
        shareName: "Arc USDC desk",
        shareSymbol: "AUSDC",
        graduationQuote: 15_000_000n,
        seedAmt: 1_000_000n,
        buyAmt: 500_000n,
        askShares: hre.ethers.parseEther("10"),
        askPrice: 100_000n,
      })
    );
    if ((await eurc.balanceOf(signer.address)) > 3_000_000n) {
      await (await eurc.transfer(taker.address, 1_000_000n)).wait();
      results.houses.push(
        await launchOne({
          signer,
          taker,
          factory,
          houses,
          deployed,
          cash: EURC,
          stock: EURC,
          shareName: "Arc EURC desk",
          shareSymbol: "AEURC",
          graduationQuote: 15_000_000n,
          seedAmt: 1_000_000n,
          buyAmt: 500_000n,
          askShares: hre.ethers.parseEther("10"),
          askPrice: 100_000n,
        })
      );
    }
  } else if (chainId === 46630) {
    const deployed = loadDeploy(46630);
    const factory = await hre.ethers.getContractAt("OfficeFactory", deployed.factory, signer);
    const houses = await hre.ethers.getContractAt("OfficeHouseFactory", deployed.houseFactory, signer);
    const usdg = new hre.ethers.Contract(USDG, ERC20, signer);
    const weth = new hre.ethers.Contract(WETH, ERC20, signer);
    const usdgBal = await usdg.balanceOf(signer.address);
    results.balances = {
      eth: (await hre.ethers.provider.getBalance(signer.address)).toString(),
      usdg: usdgBal.toString(),
      weth: (await weth.balanceOf(signer.address)).toString(),
    };
    results.wrapTx = (await (await weth.deposit({ value: hre.ethers.parseEther("0.012") })).wait()).hash;
    await (await signer.sendTransaction({ to: taker.address, value: hre.ethers.parseEther("0.006") })).wait();
    const takerWeth = new hre.ethers.Contract(WETH, ERC20, taker);
    await (await takerWeth.deposit({ value: hre.ethers.parseEther("0.003") })).wait();

    const cash = usdgBal > 0n ? USDG : WETH;
    results.vaultCash = cash;
    const names = [
      ["River house", "RVRH"],
      ["Oak desk", "OAKD"],
      ["Maple book", "MPLB"],
      ["Cedar key", "CDRK"],
      ["Pine letter", "PNLT"],
    ];
    const grad = cash === WETH ? hre.ethers.parseEther("0.05") : 15_000_000n;
    const seedAmt = cash === WETH ? hre.ethers.parseEther("0.0008") : 1_000_000n;
    const buyAmt = cash === WETH ? hre.ethers.parseEther("0.0004") : 500_000n;
    const askPrice = cash === WETH ? hre.ethers.parseEther("0.00001") : 100_000n;
    for (const [shareName, shareSymbol] of names) {
      results.houses.push(
        await launchOne({
          signer,
          taker,
          factory,
          houses,
          deployed,
          cash,
          stock: WETH,
          shareName,
          shareSymbol,
          graduationQuote: grad,
          seedAmt,
          buyAmt,
          askShares: hre.ethers.parseEther("5"),
          askPrice,
        })
      );
    }
  } else {
    throw new Error(`unsupported ${chainId}`);
  }

  const out = path.join(__dirname, "..", `office-tape-${chainId}.json`);
  fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
