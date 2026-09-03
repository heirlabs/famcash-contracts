/**
 * Head-of-household dry run on 31337: open house, grant, drop, trade, print the books.
 */
const hre = require("hardhat");

async function main() {
  const [head, heir, cousin] = await hre.ethers.getSigners();
  const Cash = await hre.ethers.getContractFactory("MockCashToken");
  const cash = await Cash.deploy();
  await cash.waitForDeployment();
  const Factory = await hre.ethers.getContractFactory("OfficeFactory");
  const factory = await Factory.deploy(hre.ethers.ZeroAddress, await cash.getAddress());
  await factory.waitForDeployment();
  const openedTx = await factory.connect(head).openOffice(
    { inactivityPeriod: 30 * 24 * 60 * 60, gracePeriod: 7 * 24 * 60 * 60, oracleEnabled: false, jurisdictionId: hre.ethers.ZeroHash },
    [
      { wallet: heir.address, shareBps: 6000, emailHash: hre.ethers.ZeroHash },
      { wallet: cousin.address, shareBps: 4000, emailHash: hre.ethers.ZeroHash },
    ]
  );
  const opened = (await openedTx.wait()).logs
    .map((l) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "OfficeOpened").args;

  await cash.mint(head.address, 50_000_000n);
  await cash.connect(head).transfer(opened.account, 50_000_000n);

  const Stock = await hre.ethers.getContractFactory("MockStockToken");
  const stock = await Stock.deploy();
  await stock.waitForDeployment();
  const Houses = await hre.ethers.getContractFactory("OfficeHouseFactory");
  const houses = await Houses.deploy(hre.ethers.ZeroAddress, 0, await factory.certificate());
  await houses.waitForDeployment();
  const houseTx = await houses.connect(head).openHouse({
    certificate: await factory.certificate(),
    tokenId: opened.tokenId,
    pot: opened.account,
    stock: await stock.getAddress(),
    cash: await cash.getAddress(),
    shareName: "Logan Shares",
    shareSymbol: "LOGN",
    votingPeriod: 259200,
    curveSupply: hre.ethers.parseEther("100000"),
    graduationQuote: 10_000_000_000n,
    snipeSeconds: 60,
    maxSupply: hre.ethers.parseEther("200000"),
  });
  const houseLog = (await houseTx.wait()).logs
    .map((l) => {
      try {
        return houses.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "HouseOpened");
  const house = await hre.ethers.getContractAt("OfficeHouse", houseLog.args.house);
  const share = await hre.ethers.getContractAt("FamilyShare", houseLog.args.share);
  const book = await hre.ethers.getContractAt("FamilyShareBook", await house.book());

  await house.connect(head).grant(heir.address, hre.ethers.parseEther("60"));
  await house.connect(head).grant(cousin.address, hre.ethers.parseEther("40"));
  await stock.mint(head.address, 1_000_000n);
  await stock.connect(head).approve(await house.getAddress(), 1_000_000n);
  await house.connect(head).deposit(1_000_000n);

  const askShares = hre.ethers.parseEther("10");
  const price = 2_000_000n;
  await share.connect(heir).approve(await book.getAddress(), askShares);
  await book.connect(heir).postAsk(price, askShares);
  const cost = await book.quoteFor(askShares, price);
  await stock.mint(cousin.address, cost);
  await stock.connect(cousin).approve(await book.getAddress(), cost);
  await book.connect(cousin).fill(0, askShares);

  const cashPot = await cash.balanceOf(opened.account);
  const stockPot = await stock.balanceOf(opened.account);
  const reserved = await house.holderReserve();
  const aum = cashPot + stockPot + reserved;
  const payload = {
    pot: opened.account,
    house: await house.getAddress(),
    book: await book.getAddress(),
    aumPractice: aum.toString(),
    sheet: {
      cashInPot: cashPot.toString(),
      stockInPot: stockPot.toString(),
      reserved: reserved.toString(),
    },
    letter: {
      holderBps: Number(await house.holderBps()),
      potBps: Number(await house.potBps()),
    },
    accounts: [
      {
        who: "heir",
        shares: (await share.balanceOf(heir.address)).toString(),
        owed: (await house.owed(heir.address)).toString(),
        seat: await house.isSeat(heir.address),
      },
      {
        who: "cousin",
        shares: (await share.balanceOf(cousin.address)).toString(),
        owed: (await house.owed(cousin.address)).toString(),
        seat: await house.isSeat(cousin.address),
      },
    ],
    lastPrint: {
      price: (await book.printAt(0)).price.toString(),
      shares: (await book.printAt(0)).shares.toString(),
    },
    openAsks: Number(await book.openCount()),
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
