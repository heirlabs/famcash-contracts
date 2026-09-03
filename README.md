# Family.Cash contracts

Isolated Solidity for [Family.Cash](https://family.cash): one estate plate, a dead-man account, and an optional family share book.

This tree is the audit surface. It was cut out of the HEIR web monorepo (`contracts/src/office`) so reviewers do not have to walk a product app to read the contracts. The product UI and API live elsewhere.

**License:** MIT — [LICENSE](LICENSE)  
**Inbound contributions:** [CLA.md](CLA.md)  
**Security:** [SECURITY.md](SECURITY.md)

The repository is private while review is underway. The license and CLA are written so the same tree can be published later without a rewrite.

## What it does

```
OfficeFactory
  ├─ mints HeirEstateCertificate (the plate)
  └─ deploys / initializes HeirAccount (the pot)

OfficeHouseFactory
  ├─ deploys OfficeHouse (the letter)
  └─ FamilyKitFactory
        ├─ FamilyShare
        ├─ FamilyShareBook
        └─ FamilyLaunchCurve
```

1. **`openOffice`** — mint the plate to the caller and initialize a `HeirAccount` with inactivity / grace rules and named heirs. The account can `checkIn`, `execute` while the holder is alive, and `claim` once the switch trips.
2. **`openHouse`** — attach one house to that plate. The house pays stock into share holders, runs a launch curve against cash, and lists leftover size on a book. The patriarch is whoever holds the plate.

Target chain is **Robinhood Chain** (`4663`). Deployed bytecode must stay at or under **24,576** bytes. The kit factory exists so `OfficeHouseFactory` fits that cap.

## Contracts

| File | Role |
| --- | --- |
| [`OfficeFactory.sol`](src/OfficeFactory.sol) | Mint plate + account. Pausable. Default admin delay 3 days. |
| [`HeirEstateCertificate.sol`](src/HeirEstateCertificate.sol) | Estate NFT. Factory-only mint. One-time `bindAccount`. Soulbind on claim. |
| [`HeirAccount.sol`](src/HeirAccount.sol) | 6551-shaped vault. Factory-gated `initialize`. Locked implementation. |
| [`OfficeHouseFactory.sol`](src/OfficeHouseFactory.sol) | One house per plate. Deploys `FamilyKitFactory` in the constructor. |
| [`FamilyKitFactory.sol`](src/FamilyKitFactory.sol) | Deploys share, book, and curve. `KIT_DEPLOYER_ROLE` is the house factory. |
| [`OfficeHouse.sol`](src/OfficeHouse.sol) | Seats, votes, dividends, grants, sync on plate transfer. |
| [`FamilyShare.sol`](src/FamilyShare.sol) | ERC-20 shares. House is the minter. |
| [`FamilyShareBook.sol`](src/FamilyShareBook.sol) | Limit book. Asks escrow shares. |
| [`FamilyLaunchCurve.sol`](src/FamilyLaunchCurve.sol) | Cash in, shares out. Deadline on buy/sell. Sniper tax to the pot. |
| [`OfficeRoles.sol`](src/OfficeRoles.sol) | `PAUSER_ROLE`, `KIT_DEPLOYER_ROLE`, `MINTER_ROLE`, `FACTORY_ROLE`, `ADMIN_DELAY`. |

Interfaces live in [`src/interfaces/`](src/interfaces/). Lab ERC-20s and a Tokenbound mock live in [`src/test-mocks/`](src/test-mocks/). Mocks are minter-gated. They are not production cash.

## Roles

Factories use OpenZeppelin `AccessControlDefaultAdminRules` with a **3-day** default-admin delay. You cannot `grantRole(DEFAULT_ADMIN_ROLE, …)`. Move admin with `beginDefaultAdminTransfer`.

| Role | Who has it at deploy | What it does |
| --- | --- | --- |
| Default admin | Deployer (`msg.sender`) | Grant / revoke other roles, start admin transfer |
| `PAUSER_ROLE` | Deployer | `pause` / `unpause` on `OfficeFactory` and `OfficeHouseFactory` |
| `FACTORY_ROLE` | Office factory (on the certificate) | Mint and bind the plate |
| `KIT_DEPLOYER_ROLE` | House factory (on the kit) | `FamilyKitFactory.deploy` |
| `MINTER_ROLE` | Deployer (lab mocks only) | `mint` on mock cash / stock |

`FamilyKitFactory` is not pausable. Do not revoke `KIT_DEPLOYER_ROLE` from the house factory.

## Trust notes (read these)

- While the plate holder is alive they can `HeirAccount.execute` the pot. The product discloses that. It is not a lockbox until `isClaimable()`.
- `Rules.oracleEnabled` is rejected. There is no oracle heartbeat in this tree.
- Minimum inactivity is **30 days**. Minimum grace is **7 days**. Minimum house vote is **3 days**.
- `openHouse` requires the official certificate, `pot == accountOf(tokenId)`, one house per plate, and `maxSupply >= curveSupply`.
- Curve leftover shares go to the pot. Seed cannot graduate. Buy / sell take a `deadline`.
- Production cash must behave like a vanilla ERC-20.

## Develop

Node 20+. OpenZeppelin Contracts is pinned to **5.4.0** so the suite compiles at Solidity `0.8.20` (later OZ releases require `^0.8.24`).

```bash
git clone git@github.com:heirlabs/famcash-contracts.git
cd famcash-contracts
npm install
npm test
```

That is the whole office suite. There is no app, no API, and no frontend package in this repository.

### Local lab

```bash
npx hardhat node
# other terminal
npm run lab          # factory, certificate, mocks, house factory, kit
npm run lab:open     # one openOffice + openHouse, prints gas
npm run lab:gas      # 24kb sizes + create estimates
```

`npm run lab` writes `office-local.json` (gitignored). Default extra pauser: `0x751ff033914C2B0C89541dA1760406577E41Ef83`.

Do not point `scripts/deploy.js` at 4663 until production cash is real and claim has been rehearsed on 46630.

### Networks

| Name | Chain ID | Config key |
| --- | ---: | --- |
| Hardhat / localhost | 31337 | `localhost` |
| Robinhood Chain | 4663 | `robinhood` |
| Robinhood testnet | 46630 | `robinhoodTestnet` |

Optional env: see [`.env.example`](.env.example).

## Layout

```
src/                 Solidity
src/interfaces/      6551 + account + house interfaces
src/test-mocks/      Lab cash, stock, Tokenbound mock
test/                Hardhat tests
scripts/             Lab deploy and gas
CLA.md               Inbound contributor license
CLA-SIGNATORIES.md   Who has signed
CONTRIBUTING.md      How to change this tree
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Sign the [CLA](CLA.md) before we merge anything. Questions about the agreement: **legal@heir.es**.

## Security

Email **security@heir.es**. Do not file a public issue for a vulnerability.

## Origin

Extracted 2026-09-03 from the HEIR web monorepo office suite (`contracts/src/office` on `feat/family-cash-mint-heirbears`) so SolAudit and later reviewers can clone one repository.
