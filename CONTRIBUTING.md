# Contributing

This repository is the isolated Family.Cash contract suite. It will be opened to public contribution later. The rules below apply now so an audit tree and a later public tree stay the same.

## Before you write code

1. Open an issue describing the change, unless you are fixing a typo.
2. Read the existing contract and its tests. Do not refactor unrelated files.
3. Do not add a second pattern for something that already works.

## Contributor License Agreement

We cannot merge a pull request until the author has signed the [CLA](CLA.md).

**Individuals**

1. Read [CLA.md](CLA.md#individual-contributor-license-agreement).
2. Open a pull request that adds one row to [CLA-SIGNATORIES.md](CLA-SIGNATORIES.md) (or include that row in the same PR as your code).
3. In the PR body, write: `I have read and agree to the Contributor License Agreement.`

**Entities**

1. Read [CLA.md](CLA.md#entity-contributor-license-agreement).
2. An authorized officer adds a row with entity name and title.
3. Email **legal@heir.es** if you need a countersigned PDF.

The first commit from an unsigned author will be blocked. Signing once covers later contributions.

You keep copyright in your work. You license it to HEIR Labs Pte. Ltd. and to users of this repository under MIT, and you allow HEIR Labs to publish the project under MIT or a later OSI-approved license.

## Development

```bash
npm install
npm test
```

Lab node (separate terminal), then deploy:

```bash
npx hardhat node
npm run lab
npm run lab:open
npm run lab:gas
```

Robinhood Chain (4663) rejects contracts over **24,576** deployed bytes. `FamilyKitFactory` is split from `OfficeHouseFactory` so both fit. `npm run lab:gas` prints sizes.

## Pull requests

- One concern per PR.
- Tests for the new behavior and the failure case.
- No secrets, private keys, or `.env` files.
- No generated `artifacts/` or `cache/`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Do not add AI attribution to commit messages.

Use the pull request template. Check the CLA box.

## Security

Do not file a public issue for a vulnerability. Email **security@heir.es**. See [SECURITY.md](SECURITY.md).
