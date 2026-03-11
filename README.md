# MetaYoshi Wallet

MetaYoshi Wallet is the public browser-extension wallet for the MetaYoshi project. It is built for non-custodial, multi-chain access: users keep control of their keys, approve their own actions, and work through one consistent wallet flow across configured networks.

**Control beats trust.**

This repository is the source for MetaYoshi Wallet `0.1.8`.

## Why MetaYoshi

- Non-custodial by default. Private keys and seed phrases stay with the user.
- One wallet flow across UTXO and account-based chains.
- Real network integrations instead of a mock-only demo experience.
- Open source code that the community can inspect, test, and improve.

MetaYoshi is aimed at practical daily usage: connect, review, approve, and manage assets through a familiar browser extension interface while keeping custody in your own hands.

## Current focus

MetaYoshi `0.1.8` is focused on:

- browser-extension wallet UX
- multi-chain runtime support
- bridge-backed network access where required
- packaging for Chrome, Brave, Chromium, and Firefox
- safer public startup defaults for open-source distribution

The public startup flow now prefers a bridge-free network when possible, so open-source builds no longer depend on the legacy RTM-first boot path.

## Configured network coverage

The project metadata for `0.1.8` currently includes these configured networks:

- Raptoreum
- Bitcoin
- Ethereum
- Arbitrum
- Optimism
- Base
- Polygon
- Avalanche C-Chain
- Cronos
- Cronos POS
- Cosmos Hub
- Solana
- Sui
- Dogecoin
- Firo
- Dash
- BitcoinZ
- zkSync Era

Available networks in a given deployment can still depend on environment configuration and backend availability.

## Local setup

Requirements:

- Node.js `20+`
- npm `10+`

Install dependencies:

```bash
npm install
```

Start local development:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Build browser packages:

```bash
npm run build:browsers
```

To use local environment values, copy `.env.example` to `.env.local` and fill in your own settings.

Important:

- this public repo does not include live server credentials
- some backend-connected flows require your own server configuration
- if `VITE_DEFAULT_NETWORK` is not set, the wallet prefers an enabled public-friendly startup network automatically

## Available scripts

- `npm run dev`
- `npm run build`
- `npm run build:browsers`
- `npm run build:chrome`
- `npm run build:brave`
- `npm run build:firefox`
- `npm run zip:browsers`
- `npm run lint`
- `npm run test:api:firo-eth`

## Using the public repo

This repository is intended for users, testers, and contributors who want to run the wallet locally, inspect how it works, or build their own test setup.

What to expect:

- the source code is public and reviewable
- live production credentials are not bundled here
- some wallet flows need your own backend or bridge configuration
- available networks can vary based on your environment settings

## Generic token support plan

The long-term goal is a generic asset layer that makes token support feel consistent across different blockchain models instead of treating every network as a one-off integration.

Direction of implementation:

- EVM assets: keep improving ERC-20 token discovery, balance reads, transfer flows, and contract-based asset identification
- Solana assets: continue SPL token and NFT handling with better metadata, mint recognition, and transfer clarity
- Cardano assets: expand policy-token support through clearer asset identification and transfer tooling
- Cosmos-style assets: improve denom-based asset presentation and chain-specific metadata handling
- Shared asset UX: keep one consistent flow for logo resolution, balances, send confirmation, and transaction review
- Safety first: token transfers should only be exposed where signing, validation, and fee handling are explicit and reviewable

That means the wallet is moving toward broader generic token support, but actual availability still depends on the network, runtime support, and backend configuration in a given deployment.

## Support the project

MetaYoshi can be supported in three ways:

- by using the wallet, testing it, and reporting reproducible issues
- by contributing code, documentation, and UX improvements
- by sending a direct donation to one of the project support addresses below

Direct donation addresses:

- Ethereum: `0x39904aB90441b7A2C6E5674E0Ce19Ac41607c576`
- Base: `0x39904aB90441b7A2C6E5674E0Ce19Ac41607c576`
- BNB: `0x39904aB90441b7A2C6E5674E0Ce19Ac41607c576`
- Raptoreum: `RFfwc9vv7W6hq3y6H2ZiYsb4PXZZ4Vi83m`
- Cosmos: `cosmos1dutpffteuk2euly728lg7kkn5lpqn9m9c3d56h`
- Dash: `Xt1U9CuRRHEwi5pjjNEVbVah3fbwcy2K4Xm`

These are direct support addresses for the project. Availability of any donation prompt inside the wallet can still depend on network, runtime, and backend configuration.

## Website and contact

- Website: `https://metayoshi.app`
- Support: `support@metayoshi.app`

For broader project direction, see the public website, FAQ, and whitepaper pages.

## Configuration notes

For local use, create a `.env.local` file from `.env.example` and provide your own values.

The public repository does not include:

- live server credentials
- private bridge secrets
- internal deployment configuration

If a backend-connected feature does not work in your setup, check your environment values first.

## License

Source code is released under the MIT License. See [LICENSE](./LICENSE).

Brand names, logos, icons, and other MetaYoshi / GLab branding are covered separately. See [NOTICE.md](./NOTICE.md).
