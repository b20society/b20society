# B20 Society

A self-evolving B20 token with dynamic NFT collection on Base.

## Overview

- **Token**: `B20 Society` (symbol: `SOCIETY`), 1B supply, paired with NVDA stock token
- **Launch**: via o1 Launchpad (RWA market)
- **Domain**: https://b20society.com
- **Network**: Base (chainId 8453)

## Features

- **Dynamic token image**: 100 hand-crafted images reflecting marketcap tier (0-99)
- **Dynamic NFT collection**: 1000 NFTs, each evolving through 10 phases by burning $SOCIETY
- **Animated NFT art**: GIF format for self-evolving visual effect
- **Vercel Edge backend**: sub-30ms metadata serving

## Project Structure

```
b20society/
├── api/                 ← Vercel Edge functions
│   ├── metadata.ts      ← Token metadata endpoint
│   └── nft/
│       └── [tokenId].ts ← NFT metadata endpoint
├── lib/                 ← Shared utilities
│   ├── tier-images.ts   ← Token tier UUID mapping
│   ├── marketcap.ts     ← V4 pool + Chainlink price reads
│   ├── nft-phase.ts     ← NFT phase read
│   └── constants.ts     ← Contract addresses, chain config
├── contracts/           ← Solidity smart contracts
│   └── B20SocietyNFT.sol
├── public/              ← Static assets
│   └── images/
│       ├── {uuid}.webp  ← 100 token tier images
│       └── nft/
│           └── phase-{1-10}.gif  ← 10 NFT phase images
├── docs/                ← Project documentation
│   └── DYNAMIC_IMAGE_PLAN.md
├── package.json
├── tsconfig.json
└── vercel.json
```

## Key Contracts (Base)

- RWA Stock Factory: `0xFf70918Ef17A2D74d683a8297813B177BaFaD1f4`
- NVDA token: `0xb20000000000000000000078ee7ce2fE4908108C`
- Chainlink NVDA/USD: `0x04689a41629776563E6822F76f2e57D148d28513`
- V4 PoolManager: `0x498581ff718922c3f8e6a244956af099b2652b2b`

## NFT Mechanics

- **Supply**: 1000 unique NFTs (all visually identical at same phase)
- **Phases**: 1-10 (minted at phase 1, max is phase 10)
- **Phase advance**: burn $SOCIETY tokens
- **Burn cost curve**: linear, 20K, 30K, 40K, ..., 100K per advance
- **Max burn per NFT**: 540,000 SOCIETY
- **Mint price**: 0.001 ETH
- **Per-wallet cap**: 5 NFTs
- **Royalty**: 5% (ERC-2981)

## Development

```bash
# Install
npm install

# Local dev
npm run dev

# Build
npm run build

# Deploy (via Vercel)
vercel deploy --prod
```

## License

UNLICENSED — Private project
