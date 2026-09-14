/**
 * Create a Uniswap V2 pair for a launched family share vs WETH and add liquidity.
 *
 *   PRIVATE_KEY=0x… npx hardhat run scripts/seed-uniswap-lp.js --network robinhoodTestnet
 *
 * Reuses office-tape-<chainId>.json houses. Does not mint official USDG.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function deposit() payable",
];
const CURVE = [
  "function graduated() view returns (bool)",
  "function cash() view returns (address)",
  "function previewBuy(uint256,address) view returns (uint256,uint256,uint256,uint256)",
  "function buy(uint256,uint256,uint256)",
];
const FACTORY = [
  "function getPair(address,address) view returns (address)",
  "function createPair(address,address) returns (address)",
];
const ROUTER = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];
const PAIR = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

async function ensureApprove(token, owner, spender) {
  const current = await token.allowance(owner.address, spender);
  if (current > 0n) return;
  await (await token.connect(owner).approve(spender, hre.ethers.MaxUint256)).wait();
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const uniFile = path.join(__dirname, "..", `uniswap-v2-${chainId}.json`);
  const tapeFile = path.join(__dirname, "..", `office-tape-${chainId}.json`);
  if (!fs.existsSync(uniFile)) throw new Error(`missing ${uniFile}`);
  if (!fs.existsSync(tapeFile)) throw new Error(`missing ${tapeFile}`);
  const uni = JSON.parse(fs.readFileSync(uniFile, "utf8"));
  const tape = JSON.parse(fs.readFileSync(tapeFile, "utf8"));
  const house = (tape.houses || []).find((row) => row.share && row.curve && row.buyTx);
  if (!house) throw new Error("no launched tape house with a curve buy");

  const [signer] = await hre.ethers.getSigners();
  const weth = new hre.ethers.Contract(uni.weth, ERC20, signer);
  const share = new hre.ethers.Contract(house.share, ERC20, signer);
  const factory = new hre.ethers.Contract(uni.factory, FACTORY, signer);
  const router = new hre.ethers.Contract(uni.router, ROUTER, signer);
  const curve = new hre.ethers.Contract(house.curve, CURVE, signer);

  const wrapAmt = hre.ethers.parseEther("0.004");
  const wrapTx = await weth.deposit({ value: wrapAmt });
  const wrapReceipt = await wrapTx.wait();

  const graduated = await curve.graduated();
  const curveCash = await curve.cash();
  if (curveCash.toLowerCase() !== uni.weth.toLowerCase()) {
    throw new Error(`tape house cash is not WETH: ${curveCash}`);
  }
  if (graduated) throw new Error("curve already graduated; will not invent share inventory");

  const buyAmt = hre.ethers.parseEther("0.001");
  await ensureApprove(weth, signer, house.curve);
  const preview = await curve.previewBuy(buyAmt, signer.address);
  const sharesOut = preview[0];
  if (sharesOut === 0n) throw new Error("curve previewBuy returned 0");
  const buyTx = await curve.buy(buyAmt, sharesOut / 2n, BigInt(Math.floor(Date.now() / 1000) + 600));
  const buyReceipt = await buyTx.wait();

  const shareBal = await share.balanceOf(signer.address);
  const wethBal = await weth.balanceOf(signer.address);
  if (shareBal === 0n || wethBal === 0n) throw new Error("no inventory for addLiquidity");

  const lpShare = shareBal / 2n;
  const lpWeth = wethBal / 2n;
  if (lpShare === 0n || lpWeth === 0n) throw new Error("inventory too small for LP");

  let pair = await factory.getPair(house.share, uni.weth);
  let createTx = null;
  if (pair === hre.ethers.ZeroAddress) {
    const created = await factory.createPair(house.share, uni.weth);
    const createdReceipt = await created.wait();
    createTx = createdReceipt.hash;
    pair = await factory.getPair(house.share, uni.weth);
  }
  if (pair === hre.ethers.ZeroAddress) throw new Error("createPair left zero address");

  await ensureApprove(share, signer, uni.router);
  await ensureApprove(weth, signer, uni.router);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const addTx = await router.addLiquidity(
    house.share,
    uni.weth,
    lpShare,
    lpWeth,
    1n,
    1n,
    signer.address,
    deadline
  );
  const addReceipt = await addTx.wait();

  const pairC = new hre.ethers.Contract(pair, PAIR, signer);
  const [r0, r1] = await pairC.getReserves();
  if (r0 === 0n || r1 === 0n) throw new Error("pair reserves still zero after addLiquidity");

  const swapIn = hre.ethers.parseEther("0.0002");
  const pathBuy = [uni.weth, house.share];
  const outBuy = await router.getAmountsOut(swapIn, pathBuy);
  const buySwap = await router.swapExactTokensForTokens(
    swapIn,
    outBuy[1] / 2n,
    pathBuy,
    signer.address,
    BigInt(Math.floor(Date.now() / 1000) + 600)
  );
  const buySwapReceipt = await buySwap.wait();

  const afterBuy = await share.balanceOf(signer.address);
  const sellAmt = afterBuy / 4n;
  if (sellAmt === 0n) throw new Error("no shares to sell after swap");
  const pathSell = [house.share, uni.weth];
  const outSell = await router.getAmountsOut(sellAmt, pathSell);
  const sellSwap = await router.swapExactTokensForTokens(
    sellAmt,
    outSell[1] / 2n,
    pathSell,
    signer.address,
    BigInt(Math.floor(Date.now() / 1000) + 600)
  );
  const sellSwapReceipt = await sellSwap.wait();

  const [r0b, r1b] = await pairC.getReserves();
  const token0 = await pairC.token0();
  const record = {
    chainId,
    factory: uni.factory,
    router: uni.router,
    weth: uni.weth,
    house: house.house,
    share: house.share,
    shareSymbol: house.shareSymbol,
    pair,
    createPairTx: createTx,
    wrapTx: wrapReceipt.hash,
    curveBuyTx: buyReceipt.hash,
    addLiquidityTx: addReceipt.hash,
    buyTx: buySwapReceipt.hash,
    sellTx: sellSwapReceipt.hash,
    reserves: { token0, reserve0: r0b.toString(), reserve1: r1b.toString() },
  };
  uni.pairs = uni.pairs || [];
  uni.pairs = uni.pairs.filter((row) => row.pair.toLowerCase() !== pair.toLowerCase());
  uni.pairs.push(record);
  fs.writeFileSync(uniFile, `${JSON.stringify(uni, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
