/**
 * After office-lab.js: open one office + house on 31337 with Hardhat #3
 * so #0 can still mint in the UI. Prints per-tx gas for the pair flow.
 *
 *   npx hardhat run scripts/lab-open-gas.js --network localhost
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

function parseLog(iface, log) {
  try {
    return iface.parseLog(log);
  } catch {
    return null;
  }
}

async function recordTx(name, tx) {
  const receipt = await tx.wait();
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  return {
    name,
    tx: receipt.hash,
    from: receipt.from,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: gasPrice.toString(),
    costWei: (receipt.gasUsed * gasPrice).toString(),
    created: await createdContracts(receipt.hash),
    receipt,
  };
}

async function main() {
  const out = path.join(__dirname, "..", "office-local.json");
  if (!fs.existsSync(out)) throw new Error("office-local.json missing. Run office-lab.js first.");
  const local = JSON.parse(fs.readFileSync(out, "utf8"));
  const [head, heir, cousin, opener] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractAt("OfficeFactory", local.factory);
  const houses = await hre.ethers.getContractAt("OfficeHouseFactory", local.houseFactory);

  const openedTx = await factory.connect(opener).openOffice(
    { inactivityPeriod: 30 * 24 * 60 * 60, gracePeriod: 7 * 24 * 60 * 60, oracleEnabled: false, jurisdictionId: hre.ethers.ZeroHash },
    [
      { wallet: heir.address, shareBps: 6000, emailHash: hre.ethers.ZeroHash },
      { wallet: cousin.address, shareBps: 4000, emailHash: hre.ethers.ZeroHash },
    ]
  );
  const openedRec = await recordTx("openOffice", openedTx);
  const opened = openedRec.receipt.logs.map((l) => parseLog(factory.interface, l)).find((p) => p && p.name === "OfficeOpened");
  if (!opened) throw new Error("OfficeOpened missing");

  const houseTx = await houses.connect(opener).openHouse({
    certificate: local.certificate,
    tokenId: opened.args.tokenId,
    pot: opened.args.account,
    stock: local.stock,
    cash: local.cash,
    shareName: "Practice Shares",
    shareSymbol: "PRAC",
    votingPeriod: 259200,
    curveSupply: hre.ethers.parseEther("100000"),
    graduationQuote: 10_000_000_000n,
    snipeSeconds: 60,
    maxSupply: hre.ethers.parseEther("200000"),
  });
  const houseRec = await recordTx("openHouse", houseTx);
  const houseLog = houseRec.receipt.logs.map((l) => parseLog(houses.interface, l)).find((p) => p && p.name === "HouseOpened");
  if (!houseLog) throw new Error("HouseOpened missing");

  const house = await hre.ethers.getContractAt("OfficeHouse", houseLog.args.house);
  const payload = {
    opener: opener.address,
    unusedMinter: head.address,
    office: {
      tokenId: opened.args.tokenId.toString(),
      account: opened.args.account,
      owner: opened.args.owner,
    },
    house: houseLog.args.house,
    share: houseLog.args.share,
    curve: houseLog.args.curve,
    book: await house.book(),
    txs: [
      {
        name: openedRec.name,
        tx: openedRec.tx,
        from: openedRec.from,
        gasUsed: openedRec.gasUsed,
        gasPrice: openedRec.gasPrice,
        costWei: openedRec.costWei,
        created: openedRec.created,
      },
      {
        name: houseRec.name,
        tx: houseRec.tx,
        from: houseRec.from,
        gasUsed: houseRec.gasUsed,
        gasPrice: houseRec.gasPrice,
        costWei: houseRec.costWei,
        created: houseRec.created,
      },
    ],
  };
  delete openedRec.receipt;
  delete houseRec.receipt;
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
