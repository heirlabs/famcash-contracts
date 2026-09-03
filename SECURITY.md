# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |

These contracts are not a public mainnet deployment yet. Treat `main` as the review target.

## Reporting a vulnerability

**Do not** open a public GitHub issue for a security vulnerability.

Email **security@heir.es** with:

- Description and impact
- Affected contract and function
- Reproduction (Hardhat test or script preferred)
- Suggested fix, if you have one

We aim to acknowledge reports within **3 business days**.

## Assumptions reviewers should not skip

- Lab mocks (`MockCashToken`, `MockStockToken`) mint only through `MINTER_ROLE`. They are not production cash or stock.
- Production cash must be a standard ERC-20 (no rebase, no fee-on-transfer) unless the suite is changed to measure `balanceOf` around every transfer.
- `OfficeFactory` with a Tokenbound `registry` is a different trust model than `registry = address(0)` (standalone lab account).
- While the estate NFT holder is alive they can `HeirAccount.execute` the pot. That is disclosed, not locked.
- `Rules.oracleEnabled` is rejected. There is no oracle dead-man switch in this tree.
- Default admin on the factories uses OpenZeppelin `AccessControlDefaultAdminRules` with a **3-day** delay.
