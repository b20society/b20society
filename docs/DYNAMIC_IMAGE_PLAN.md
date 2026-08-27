# B20 Society — Self-evolving B20 Token

**Project Name:** B20 Society
**Domain:** b20society.com
**Status:** Planning

## 1. Project Overview

### Goal
Launch a token via o1 Launchpad (Base chain) — `B20 Society` (symbol `SOCIETY`) paired with NVDA stock token — whose image dynamically reflects the token's USD market cap. The project also includes a dynamic NFT collection of 1000 NFTs that evolves through 10 phases by burning $SOCIETY tokens.

### Key Concept
- **Project brand**: B20 Society — a self-evolving B20 token community
- **Token**: `B20 Society` (symbol: `SOCIETY`), 1B supply, paired with NVDA stock token via o1 Launchpad on Base (RWA market)
- **Linear marketcap progression**: $0 → $1M USD mapped to tier 0 → tier 99 (computed from V4 pool + Chainlink NVDA feed)
- **100 hand-crafted token images** supplied by the creator (style-consistent, no AI drift)
- **Vercel Edge** computes the current tier from on-chain pool + Chainlink price, serves a tier-specific metadata JSON
- **B20 token** is launched via o1 Launchpad RWA Stock Factory with `editable_metadata: true` so the contractURI can point to the Vercel endpoint
- **Dynamic NFT collection**: 1000 unique NFTs, each evolving through 10 phases by burning $SOCIETY tokens
  - Each wallet can mint up to 5 NFTs
  - Each NFT's image is dynamic based on its current phase
  - Phase progression is permanent on-chain
  - 1 design × 10 phases = 10 unique image states (1000 supply, all NFTs visually identical at same phase)
  - NFT names: `B20 Society #42` (no phase in name — phase in attribute only)

### What this is NOT
- Not a fork of existing B20 tokenized stocks (we are the issuer, not Coinbase)
- Not an AI generation pipeline (images are pre-supplied)
- Not a frontend-heavy project (Vercel Edge function is the only backend)
- Not a multi-tenant system (single token, single NFT collection, single creator)

---

## 2. Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────────┐
│  ON-CHAIN (Base)                                     │
│                                                      │
│  B20 Token SOCIETY (deployed via o1 Launchpad)       │
│    └─ contractURI() → "https://b20society.com/       │
│                         api/metadata"                │
│                                                      │
│  B20SocietyNFT (deployed separately)                 │
│    └─ tokenURI(id) → "https://b20society.com/       │
│                       api/nft/{id}"                  │
│    └─ phaseOf(id) view → 1..10                       │
│    └─ advancePhase(id) → burns SOCIETY, ++phase      │
└──────────────────────┬───────────────────────────────┘
                       │ read call
                       ↓
┌──────────────────────────────────────────────────────┐
│  VERCEL (Edge Middleware)                            │
│                                                      │
│  GET /api/metadata (token)                           │
│    1. eth_call to V4 PoolManager (getSlot0)          │
│       → SOCIETY/NVDA ratio from sqrtPriceX96         │
│    2. eth_call to Chainlink NVDA/USD feed             │
│       → latestRoundData() → NVDA price in USD        │
│    3. Compute: societyInUsd = (SOCIETY/NVDA) × NVDA  │
│    4. marketcap = totalSupply × societyInUsd         │
│    5. tier = clamp(floor(marketcap / 10_000), 0, 99)│
│    6. Return JSON with image = /images/{UUID}.webp   │ (token)
       7. NFT returns /images/nft/phase-{N}.gif            │ (animated)
│                                                      │
│  GET /api/nft/{tokenId}                              │
│    1. eth_call to NFT (phaseOf)                      │
│    2. Resolve image: /images/nft/phase-{p}.gif        │ (animated)
│    3. Return JSON with image + attributes            │
└──────────────────────┬───────────────────────────────┘
                       │ returns JSON
                       ↓
┌──────────────────────────────────────────────────────┐
│  WALLET / DEX / FRONTEND                             │
│                                                      │
│  Token:  contractURI() → metadata → tier image       │
│  NFT:    tokenURI(id) → metadata → phase image       │
│  Both: 100% OpenSea-compatible ERC-7572 metadata     │
└──────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Purpose |
|---|---|---|
| B20 Token | o1 Launchpad (factory) | ERC-20 token with mutable contractURI |
| NFT Contract | Custom Solidity (or Thirdweb/Manifold) | ERC-721 with phase + burn |
| Token Metadata Endpoint | Vercel Edge Middleware | Compute marketcap tier, return JSON |
| NFT Metadata Endpoint | Vercel Edge Middleware | Read phase, return JSON |
| Token Image Storage | Vercel /public | 100 UUID-named WebP images |
| NFT Image Storage | Vercel /public | 10 animated GIFs (1 design × 10 phases) |
| RPC | base.drpc.org (free) | Read V4 pool + NFT contract state |

---

## 3. Tech Stack

### Runtime
- **Vercel Edge Middleware** (V8 isolate, sub-30ms response)
- **TypeScript** (typed contracts, safer code)

### Dependencies
- `viem` (chain reads, ABI encoding) — preferred over `ethers` for edge support
- `@vercel/edge` (if needed for advanced config; default Next.js middleware is sufficient)

### Infrastructure
- **Domain**: `b20society.com` (custom, configured in Vercel)
- **RPC**: `https://base.drpc.org` (free, no rate limits during normal use)
- **o1 Launchpad**: standard Crypto Factory, market=standard, quote=ETH
- **NFT deployment**: custom Solidity (or Thirdweb/Manifold for faster setup)

### No Required External Services
- No database (peak marketcap memory is not in MVP)
- No Pinata (images live in Vercel /public)
- No IPFS gateway (HTTPS-only, max wallet compatibility)
- No auth layer (public read-only endpoints)

---

## 4. File Structure

```
project/
├── public/
│   └── images/
│       ├── a3f8b2c1-e4d5-4f6a-8b9c-0d1e2f3a4b5c.webp   ← tier 0  ($0)
│       ├── 7e9c0d1b-2a3f-4e5d-9c8b-7a6f5e4d3c2b.webp   ← tier 1  ($10K)
│       ├── ...
│       ├── f1e2d3c4-b5a6-9788-7766-5544332211aa.webp   ← tier 99 ($990K+)
│       └── nft/
│           ├── phase-1.gif    ← all NFTs minted at phase 1 share this image
│           ├── phase-2.gif
│           ├── ...
│           └── phase-10.gif   ← all NFTs at phase 10 (max) share this image
├── api/
│   ├── metadata.ts          ← Vercel Edge: token metadata
│   └── nft/
│       └── [tokenId].ts     ← Vercel Edge: NFT metadata
├── lib/
│   ├── tier-images.ts       ← UUID mapping (100 entries)
│   ├── marketcap.ts         ← V4 pool + Chainlink + tier computation
│   ├── nft-phase.ts         ← Phase read from NFT contract
│   └── constants.ts         ← token address, NFT address, NVDA address, feeds
├── contracts/
│   └── B20SocietyNFT.sol    ← NFT contract (custom Solidity, see Section 16)
├── package.json
├── tsconfig.json
├── next.config.js           ← if using Next.js; otherwise vercel.json
└── README.md
```

---

## 5. Component Details

### 5.1 B20 Token (via o1 Launchpad, RWA/NVDA Paired)

Launched via `POST /v1/launches/prepare` with:
- `chain_id`: 8453
- `creator`: user wallet (`0x...`)
- `market`: `rwa` (tokenized stock pair)
- `quote_address`: `0xb20000000000000000000078ee7ce2fE4908108C` (NVDA on Base)
- `token.name`: `B20 Society`
- `token.symbol`: `SOCIETY`
- `token.image_base64`: master image (the $1M state, the most populated scene)
- `token.image_type`: `image/webp` (or `image/png` if WebP not generated yet)
- `token.description`: launch description
- `token.editable_metadata`: `true` (allows future contractURI updates)
- `token.x`: optional Twitter URL
- `token.telegram`: optional Telegram URL

**Key addresses (Base mainnet)**:
- RWA Stock Factory: `0xFf70918Ef17A2D74d683a8297813B177BaFaD1f4`
- NVDA token: `0xb20000000000000000000078ee7ce2fE4908108C`
- Chainlink NVDA/USD feed: `0x04689a41629776563E6822F76f2e57D148d28513`
- V4 PoolManager: `0x498581ff718922c3f8e6a244956af099b2652b2b`

**Post-launch manual step**: call `updateContractURI("https://b20society.com/api/metadata")` on the token contract from the creator wallet (requires METADATA_ROLE, which the creator should hold after launch).

### 5.2 Vercel Edge Middleware (`/api/metadata`)

Reads V4 pool, computes tier, returns JSON.

**Key functions**:

```typescript
// Read V4 pool slot0
const slot0 = await client.readContract({
  address: POOL_MANAGER,
  abi: POOL_MANAGER_ABI,
  functionName: 'getSlot0',
  args: [poolId]
});

// sqrtPriceX96 → price in quote/token units
const sqrtPriceX96 = slot0[0];
const price = (Number(sqrtPriceX96) / 2**96) ** 2;

// Marketcap = totalSupply × price
const totalSupply = 1_000_000_000n * 10n ** 18n; // 1B with 18 decimals
const marketcap = Number(totalSupply) * price;

// Tier
const tier = Math.max(0, Math.min(99, Math.floor(marketcap / 10_000)));

// Return metadata
return {
  name: "Decode",
  description: "...",
  image: `https://b20society.com/images/${TIER_IMAGES[tier]}.jpg`,
  external_url: "https://b20society.com",
  attributes: [
    { trait_type: "Tier", value: tier },
    { trait_type: "Marketcap (USD)", value: marketcap.toFixed(0) }
  ]
};
```

**Cache headers**:
- `Cache-Control: public, max-age=10` (refresh every 10 seconds)
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *` (CORS for any frontend)

### 5.3 Image Storage (`/public/images/`)

- **100 token images** for marketcap tiers (UUID filenames, see below)
- **10 NFT images** (GIF, animated) for 1 design × 10 phases (file path encoded by phase)
- Creator supplies 1100 hand-crafted images total
- Vercel CDN serves with `Cache-Control: public, max-age=31536000, immutable`

#### Token Image Naming Convention
- **UUID filenames** (not numbered 0-99) to prevent enumeration
- Tier index 0 = UUID at position 0
- Tier index 99 = UUID at position 99
- Image at `/images/{UUID}.webp` is the file at `public/images/{UUID}.webp`

**UUID generation script** (one-time):
```typescript
import { randomUUID } from 'crypto';
const uuids = Array.from({ length: 100 }, () => randomUUID());
// Save to lib/tier-images.ts
```

#### NFT Image Naming Convention
- File path: `/images/nft/phase-{phase}.gif`
- Example: `/images/nft/phase-5.gif` (all NFTs at phase 5 use this same animated image)
- phase 1-10
- Total: 10 files (1 design × 10 phases)
- All 1000 NFTs share the same animated image at the same phase — visually identical
- Each GIF shows the dynamic "growing crowd" effect, intensified per phase, just different tokenIds

### 5.3.1 Image Format and Size

#### Recommended Formats (Token vs NFT)
- **Token images (100 tier images)**: **WebP** (static, optimized)
- **NFT images (10 phase images)**: **GIF** (animated, for self-evolving visual)

##### Token: WebP
- **Compression**: 25-35% smaller than PNG at equivalent quality
- **Quality**: supports both lossy and lossless
- **Transparency**: full alpha channel support
- **Browser/wallet support**: 95%+ of wallets and modern browsers (MetaMask, Rainbow, OpenSea, Blur)
- **Recommended quality setting**: 80-85% (visually lossless, ~80-150KB per 1024x1024 image)

##### NFT: GIF
- **Animation**: native support for self-evolving visuals (e.g., crowd growing, particles, motion)
- **Color depth**: 256 colors (suitable for stylized art, may band on gradients)
- **Browser/wallet support**: universal (OpenSea, MetaMask, Rainbow, Blur all render animated GIFs)
- **File size**: 1024x1024 GIF with 3-5 second animation ≈ 5-15MB
- **Optimization**: use gifsicle or FFmpeg to reduce frame count and palette
- **Recommended frame rate**: 12-20 fps (lower = smaller file, smoother than 8 fps)

#### Size Recommendations

| Use case | Resolution | Format | Approx size | Notes |
|---|---|---|---|---|
| Token tier image (standard) | 1024x1024 | WebP | 80-150KB | Static, good for wallets |
| Token tier image (high quality) | 1500x1500 | WebP | 150-250KB | For marketplaces, social sharing |
| Token tier image (premium) | 2048x2048 | WebP | 300-500KB | Only if art is very detailed |
| NFT phase image (optimized) | 512x512 | GIF | 2-5MB | Smaller file, smoother UX |
| NFT phase image (standard) | 1024x1024 | GIF | 5-15MB | OpenSea display, full quality |

#### Storage Math (Total Project)
- 100 token images × 150KB (1024² WebP) = 15MB
- 10 NFT images × 10MB (1024² GIF, animated) = 100MB
- **Total: ~115MB** — within Vercel free tier limits (5GB Hobby plan, 1TB+ Pro)

#### Generation Tooling
For WebP (token images):
```bash
# Single image
cwebp -q 85 input.png -o output.webp

# Batch
for f in *.png; do cwebp -q 85 "$f" -o "${f%.png}.webp"; done
```

For GIF (NFT images):
```bash
# Single GIF
gifsicle -O3 input.gif -o output.gif

# Reduce frame rate
gifsicle --delay 8 input.gif -o output.gif

# Reduce colors
gifsicle --colors 128 input.gif -o output.gif
```

#### What NOT to Use
- **SVG**: not suitable for detailed raster NFT art (no efficient support for complex scenes, no photo-like effects)
- **JPG for NFTs**: no transparency, lossy on edges, no animation
- **APNG**: better than GIF but limited wallet support
- **AVIF**: better compression than WebP but ~60% wallet support, not worth the tradeoff yet
- **MP4/WebM for NFT image field**: technically supported by some wallets but OpenSea's `image` field is a static field; animated GIF remains the universal standard for animated NFT art

#### Why WebP Wins
- 30% smaller than PNG at same quality
- 50% smaller than JPG at same quality (with transparency)
- Universal wallet support (MetaMask, Rainbow, Coinbase Wallet, Phantom, OpenSea, Blur)
- Native browser support since 2014 (Chrome, Firefox, Safari since 2020)

### 5.4 Marketcap Computation (RWA/NVDA Paired)

Since the token is paired with NVDA (not ETH), the computation requires two on-chain reads:

1. **V4 Pool read**: Get the SOCIETY/NVDA price ratio
   - Call `getSlot0(poolId)` on PoolManager
   - `sqrtPriceX96` is at index 0 of the return tuple
   - Convert: `societyPerNvda = (sqrtPriceX96 / 2^96) ^ 2`
   - This gives the price of 1 NVDA in terms of SOCIETY (or vice versa, depends on token0/token1 ordering)

2. **Chainlink NVDA/USD read**: Get the USD price of NVDA
   - Call `latestRoundData()` on the NVDA Chainlink feed (`0x04689a41629776563E6822F76f2e57D148d28513`)
   - Returns `(roundId, answer, startedAt, updatedAt, answeredInRound)`
   - `answer` is the NVDA price in USD, 8 decimals
   - Always check `updatedAt` and apply staleness bounds (NVDA market is 24/5, freezes on weekends)

3. **Compute USD marketcap**:
   ```
   nvdaInUsd = answer / 1e8                          // 8 decimals
   societyInNvda = 1 / societyPerNvda                // inverse, depending on pool orientation
   societyInUsd = societyInNvda × nvdaInUsd
   marketcap = totalSupply × societyInUsd
   ```

4. **Tier mapping**:
   ```
   tier = clamp(floor(marketcap / 10_000), 0, 99)
   ```

**Why this is needed**: NVDA-priced marketcap reflects the real USD value of the token. Without the Chainlink step, we'd only have SOCIETY/NVDA ratio which doesn't map to dollar tiers.

**Fallback**: If Chainlink returns stale data (weekend/holiday), use last known value with a clear `stale: true` flag in the response. Better stale than broken.

### 5.5 Tier Mapping

Linear: `tier = floor(marketcap / 10_000)`, clamped to `[0, 99]`.

```
$0      → tier 0
$10K    → tier 1
$50K    → tier 5
$100K   → tier 10
$500K   → tier 50
$990K   → tier 99
$1M+    → tier 99 (capped, shows full image)
```

If a token has 1B supply and price is in ETH:
- $10K marketcap at ETH = $3000/ETH → 10K/3000 = 3.33 ETH marketcap → 0.00000333 ETH/token
- $1M marketcap → 333 ETH marketcap → 0.000333 ETH/token

For accurate USD marketcap, need ETH/USD oracle. Phase 1 (MVP): use ETH-denominated marketcap. Phase 2 (optional): add Chainlink ETH/USD feed.

---

## 6. Implementation Steps

### Step 1: Project Setup
- Create new Vercel project (or use existing)
- Install `viem` and TypeScript
- Configure `package.json`, `tsconfig.json`
- Test local dev server

### Step 2: Image Preparation
- Creator finalizes 100 hand-crafted images
- Each image: 800x800 or 1024x1024, PNG or JPG
- Generate 100 UUIDs and rename images
- Upload to `public/images/{UUID}.jpg`

### Step 3: Edge Middleware Implementation
- Write `api/metadata.ts`
- Implement V4 pool reading
- Implement marketcap computation
- Implement tier selection
- Return JSON with proper headers

### Step 4: Test Locally
- Mock V4 pool reserves
- Verify tier computation
- Verify image URL selection
- Verify JSON response format

### Step 5: Deploy to Vercel
- Push to git
- Vercel auto-deploys
- Test endpoint: `https://b20society.com/api/metadata`
- Verify CORS, cache headers, response time

### Step 6: Token Launch via o1 (RWA/NVDA)
- Use `o1 RWA Stock Factory`: `0xFf70918Ef17A2D74d683a8297813B177BaFaD1f4`
- Set `market: "rwa"`, `quote_address: "0xb20000000000000000000078ee7ce2fE4908108C"` (NVDA)
- Run `POST /v1/launches/prepare` with token params
- Get the API-prepared calldata
- Broadcast transaction
- Save predicted token address and pool ID from launch event logs

### Step 7: Set contractURI
- After launch, call `updateContractURI()` on token
- Point to Vercel endpoint
- Sign with creator wallet (METADATA_ROLE required)
- Verify on Basescan

### Step 8: Verify End-to-End
- Wallet reads contractURI() → gets Vercel URL
- Fetches metadata → gets tier image URL
- Fetches image → displays correct tier
- Test by simulating marketcap change (buy/sell on Uniswap V4)

### Step 9: Optional: Submit to Indexers
- Submit token to DexScreener (form)
- Submit to DefiLlama (PR or form)
- Submit to o1 announcement if applicable

---

## 7. Configuration

### Environment Variables (Vercel)

| Variable | Value | Purpose |
|---|---|---|
| `TOKEN_ADDRESS` | `0xB200...` | B20 SOCIETY token address (after launch) |
| `NFT_CONTRACT_ADDRESS` | `0x...` | B20SocietyNFT contract address (after deployment) |
| `POOL_ID` | `0x...` | V4 pool ID for the token (SOCIETY/NVDA) |
| `NVDA_ADDRESS` | `0xb20000000000000000000078ee7ce2fE4908108C` | NVDA token on Base |
| `CHAINLINK_NVDA_FEED` | `0x04689a41629776563E6822F76f2e57D148d28513` | NVDA/USD price feed |
| `TOTAL_SUPPLY` | `1000000000000000000000000000` | 1B with 18 decimals |
| `TIER_STEP` | `10000` | USD per tier (default: $10K) |
| `PUBLIC_DOMAIN` | `https://b20society.com` | Where images and metadata are served |
| `RPC_URL` | `https://base.drpc.org` | Primary RPC |

### Vercel Project Settings
- Node version: 20+
- Edge runtime: enabled for `/api/metadata` and `/api/nft/[tokenId]`
- Build command: `next build` (if Next.js)
- Output: `.vercel/output`
- Custom domain: `b20society.com` (with DNS configured)

### RPC Configuration
- Primary: `https://base.drpc.org`
- Fallback (optional): `https://base.gateway.tenderly.co`
- Viem client: `createPublicClient({ chain: base, transport: http(rpc) })`

---

## 8. Pool ID Derivation (V4)

V4 pool ID = keccak256(abi.encode(token0, token1, fee, tickSpacing, hooks))

For a standard o1 launch on ETH:
- `token0`: B20 token address
- `token1`: WETH or ETH (depends on o1's pool initialization)
- `fee`: standard pool fee
- `tickSpacing`: matches fee
- `hooks`: o1's launch hook (e.g., `0x985c14baa2a18316ffda0aefb3a632fadfca2acc`)

**The pool ID is set at launch time** and doesn't change. Read it once from the launch event logs, hardcode it.

**Alternative**: compute pool ID at request time using V4's PoolKey struct + INitCode hash. More flexible but more complex. Hardcoding is simpler.

---

## 9. Testing Strategy

### Local Mock Testing
- Mock V4 pool slot0 returns
- Test tier computation for boundaries:
  - $0 → tier 0
  - $9,999 → tier 0
  - $10,000 → tier 1
  - $999,000 → tier 99
  - $1,000,000 → tier 99 (capped)
  - $1,500,000 → tier 99 (capped)
- Test JSON output format
- Verify image URLs are valid

### Staging Test (Vercel preview)
- Deploy to Vercel preview URL
- Test from a real wallet (MetaMask)
- Verify CORS, cache, response time

### Production Smoke Test
- After o1 launch + contractURI update
- Use `curl` to fetch metadata endpoint
- Verify image URL is reachable
- Use a wallet to view token

### Marketcap Simulation
- After launch, do small buy/sell on V4
- Observe tier change in metadata
- Verify image updates after cache TTL (10s)

---

## 10. Deployment

### Initial Deploy
1. Code ready locally
2. `git push` to GitHub
3. Vercel auto-detects, builds, deploys
4. Test endpoint at Vercel URL
5. (Optional) configure custom domain

### o1 Launch
1. Call `POST /v1/launches/prepare` with launch params
2. Save the response (predicted address, calldata, salt, metadata URI)
3. Sign and broadcast the launch transaction
4. Wait for confirmation
5. Verify on Basescan

### contractURI Update
1. Read current contractURI (should be IPFS from launch)
2. Call `updateContractURI("https://b20society.com/api/metadata")` from creator wallet
3. Sign transaction, broadcast
4. Verify new contractURI on Basescan

### Post-Deploy Verification
- `curl https://b20society.com/api/metadata` → valid JSON
- `curl https://b20society.com/images/{any-uuid}.jpg` → 200 OK image
- Wallet displays token with current tier image

---

## 11. Cost Analysis

### One-Time Costs
- **o1 launch fee**: 0.001 ETH (one-time, on Base)
- **Token images (100)**: free (creator supplies, Vercel serves)
- **NFT images (1000)**: free (creator supplies, Vercel serves)
- **NFT contract deployment**: ~0.005 ETH (gas for custom Solidity, or free with Thirdweb/Manifold)
- **Custom domain `b20society.com`**: ~$12/year (registrar)

### Recurring Costs (Free Tier)
- **Vercel Edge requests**: 500K/month free (more than enough for metadata)
- **Vercel bandwidth**: 100GB/month free
- **Vercel /public images**: included (1100 images ≈ 165MB storage)
- **base.drpc.org**: free, public RPC

### Total: ~$1/month equivalent for typical traffic (just domain amortization)

### If Scaling (out of free tier)
- Vercel Pro: $20/month
- Custom domain: ~$12/year
- Still negligible

### NFT Phase Advance Costs
- Each phase advance burns $SOCIETY tokens (TBD by creator)
- 100 NFTs × 9 advances max = 900 potential burns
- Burns increase demand for $SOCIETY (positive flywheel)

---

## 12. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vercel outage | Low | High | `editable_metadata: true` allows switching to backup; cache headers help during brief outages |
| RPC outage | Low | High | Add fallback RPC URL in viem client config |
| Image enumeration (UUIDs) | Very low | Low | UUIDs prevent easy enumeration; current tier is publicly known anyway |
| Wallet cache shows stale image | Medium | Low | Document expected refresh behavior; users will see updates on next page load |
| Creator wallet compromised | Low | Critical | Use hardware wallet for creator; consider multisig for admin operations |
| o1 launch fails | Low | High | Test on testnet first; have backup launch script |
| ETH price not accounted for | Low | Medium | Phase 2: add Chainlink ETH/USD feed for USD marketcap |
| NFT contract bug | Low | High | Use audited standard (ERC-721), comprehensive test suite, deploy on testnet first |
| NFT phase advance griefing | Medium | Low | Add cooldown per NFT to prevent rapid phase spamming |
| NFT mint bot attack | Medium | Medium | Add allowlist or signature-based mint, or just accept first-come-first-served |
| Burn cost imbalance | Medium | Medium | Test burn curve economics; adjust if needed via upgradeable proxy (if applicable) |

---

## 13. Phase Boundaries

### Phase 1 (MVP) — What we build
- Vercel Edge middleware
- 100 image storage with UUID names
- B20 token launch via o1
- contractURI pointing to Vercel
- Linear tier computation
- ETH-denominated marketcap (no USD conversion)

### Phase 2 (Future, Not in scope) — What we skip for now
- USD marketcap via Chainlink ETH/USD feed
- `extraMetadata` onchain tier tracking
- `announce` events for milestones
- Multi-token support
- Peak marketcap memory
- Custom domain
- Analytics/monitoring
- Backup domain for redundancy

---

## 14. Open Questions (to resolve before/during build)

1. **Token name and symbol** — ✅ confirmed: `B20 Society` / `SOCIETY`
2. **Domain** — ✅ confirmed: `b20society.com` (custom domain, not Vercel subdomain)
3. **Image format** — ✅ confirmed: WebP for token (static), GIF for NFT (animated)
4. **Token images** — 100 images TBD by creator
5. **NFT supply** — ✅ confirmed: 1000 NFTs
6. **NFT images** — need 10 total (1 design × 10 phases)
7. **Burn cost curve** — ✅ confirmed: linear, 20K / 30K / 40K / 50K / 60K / 70K / 80K / 90K / 100K SOCIETY per phase
8. **NFT mint price** — ✅ confirmed: 0.001 ETH per NFT
9. **Mint schedule** — ✅ confirmed: open immediately from launch
10. **Royalty** — ✅ confirmed: 5% on secondary sales (ERC-2981)
11. **Cooldown** — ✅ confirmed: no cooldown, instant phase advance on call
12. **NFT naming** — ✅ confirmed: `B20 Society #42` (no phase suffix); phase in attribute only
13. **Token pair** — ✅ confirmed: NVDA-paired (RWA market via o1 RWA Stock Factory)
14. **Marketcap computation** — ✅ confirmed: V4 pool + Chainlink NVDA/USD feed → USD marketcap
15. **o1 launch params** — description, X URL, telegram, etc.
16. **Creator wallet** — new wallet for B20 Society launch, separate from test launches

---

## 15. Success Criteria

### Token (SOCIETY)
- [ ] Vercel Edge endpoint returns valid ERC-7572 metadata JSON
- [ ] Metadata `image` field reflects current marketcap tier
- [ ] Image at `image` URL is reachable and loads quickly
- [ ] Wallet (MetaMask, Rainbow) shows the current tier image
- [ ] o1 token page shows the current tier image
- [ ] Buying the token (raising marketcap) updates the image after cache TTL
- [ ] Selling the token (lowering marketcap) updates the image after cache TTL
- [ ] Response time under 500ms p95
- [ ] No on-chain errors during normal operation

### NFT Collection
- [ ] NFT contract deployed on Base (verified on Basescan)
- [ ] `mint()` enforces 5-per-wallet cap
- [ ] `advancePhase()` correctly burns $SOCIETY and increments phase
- [ ] `phaseOf()` returns correct current phase
- [ ] `tokenURI(id)` returns valid metadata JSON
- [ ] NFT image reflects current phase (0-9)
- [ ] Visible on OpenSea with correct phase image
- [ ] Per-wallet mint cap test passes (try to mint 6, expect revert)
- [ ] Phase advance test passes (mint, advance, verify new image)

---

## 16. NFT Integration

### Concept
A self-evolving NFT collection of 1000 unique pieces. Each NFT starts at phase 1 (initial) and can be advanced to phase 10 (max) by burning $SOCIETY tokens. Each phase advance permanently changes the NFT's image. Maximum 5 NFTs per wallet. Total supply: 1000 NFTs. Open mint from launch at fixed price with 5% royalty on secondary sales.

### Mechanics
- **Supply**: 1000 unique NFTs (token IDs 1-1000)
- **Phases per NFT**: 10 (phase 1 through phase 10, all NFTs minted at phase 1)
- **Phase progression**: irreversible, on-chain, controlled by `advancePhase(uint256 tokenId)` — no cooldown, no daily limit
- **Burn cost curve**: linear, `cost = 10_000 + 10_000 * currentPhase` (in $SOCIETY token units, before 18-decimal scaling)
  - Phase 1 → 2: burn 20,000 SOCIETY
  - Phase 2 → 3: burn 30,000 SOCIETY
  - Phase 3 → 4: burn 40,000 SOCIETY
  - Phase 4 → 5: burn 50,000 SOCIETY
  - Phase 5 → 6: burn 60,000 SOCIETY
  - Phase 6 → 7: burn 70,000 SOCIETY
  - Phase 7 → 8: burn 80,000 SOCIETY
  - Phase 8 → 9: burn 90,000 SOCIETY
  - Phase 9 → 10: burn 100,000 SOCIETY
  - **Total to max phase 10**: 540,000 SOCIETY per NFT
  - **Total burns to max**: 9 advances
- **Initial mint price**: 0.001 ETH (paid once per NFT at mint)
- **Mint schedule**: open immediately from launch (no marketcap gating)
- **Per-wallet cap**: 5 NFTs maximum
- **Royalty**: 5% on secondary sales (ERC-2981, paid to creator wallet)
- **Total unique image states**: 1 design × 10 phases = 10 images (1 base + 9 evolution variants)

### Burn Cost Economics
- **Per NFT to max phase**: 540,000 SOCIETY (cumulative burn across 9 advances)
- **All 1000 NFTs maxed**: 540,000,000 SOCIETY burned total
- **% of total supply (1B)**: 54% burned if all NFTs reach phase 10
- **Deflationary pressure**: extreme — 54% supply removal is mathematically significant
- **Realistic scenario**: most NFTs stay at phase 1-4, so actual burn likely 5-15% of supply
- **Minting revenue**: 1000 × 0.001 ETH = 1 ETH to creator at full sell-out

### NFT Contract (ERC-721 + ERC-2981)
- Standard ERC-721 with custom extensions:
  - `mint() payable returns (uint256)` — public mint at 0.001 ETH, enforces 5-per-wallet cap
  - `phaseOf(uint256 tokenId) view returns (uint8)` — current phase read (1-10)
  - `advancePhase(uint256 tokenId)` — burns $SOCIETY, increments phase
  - `tokenURI(uint256 tokenId) view returns (string)` — returns metadata URL
  - `royaltyInfo(uint256, uint256) view returns (address, uint256)` — ERC-2981, 5% to creator
- Built on Base (deploy via Thirdweb, Manifold, or custom Solidity)
- $SOCIETY token approval: user must `approve(NFT_CONTRACT, currentBurnAmount)` before each `advancePhase()`

### Burn Mechanism (No Cooldown, Simple)
```
User flow to advance NFT phase:
  1. User owns NFT (tokenId) at phase N (initially N=1, max N=10)
  2. Read burn cost: cost = (10_000 + 10_000 * N) * 10^18
     (e.g., at phase 1: cost = 20,000 SOCIETY; at phase 9: cost = 100,000 SOCIETY)
  3. User calls: society.approve(NFT_CONTRACT, cost)
  4. User calls: nft.advancePhase(tokenId)
       - NFT contract: require(phase[tokenId] < 10, "Max phase reached")
       - NFT contract: society.burnFrom(user, cost)
       - NFT contract: phase[tokenId] += 1
       - NFT contract: emit PhaseAdvanced(tokenId, N, N+1)
  5. (Optional) Repeat until phase 10

No cooldown, no daily limit, no rate limiter. User can advance as fast as
they have $SOCIETY balance and gas to pay. The burn cost naturally throttles
farming attempts. Cannot advance past phase 10.
```

### Dynamic Metadata Flow
```
Wallet/Frontend:
  1. Reads tokenURI(tokenId) from NFT contract
  2. Returns: "https://b20society.com/api/nft/{tokenId}"
  3. Vercel Edge function reads:
     - phaseOf(tokenId) from NFT contract
     - Image path: /images/nft/phase-{phase}.gif
       (all 1000 NFTs at same phase share same animated image)
  4. Returns metadata JSON:
     {
       "name": "B20 Society #42",
       "description": "...",
       "image": "https://b20society.com/images/nft/phase-5.gif",
       "attributes": [
         { "trait_type": "Phase", "value": 5 },
         { "trait_type": "Token ID", "value": 42 },
         { "trait_type": "Burn Total", "value": "270000" }
       ]
     }

Note: NFT name is just "B20 Society #42" — phase is exposed only as an
attribute, not in the name string. This keeps names clean and stable
across phase changes.
```

### Image Naming Convention
For 1 design × 10 phases = 10 images (all 1000 NFTs visually identical at same phase):
- File path: `/images/nft/phase-{phase}.gif`
- Example: `/images/nft/phase-5.gif` (all NFTs at phase 5 use this same animated image)
- phase range: 1-10 (all NFTs minted at phase 1, max is phase 10)
- Total files: 10 × ~10MB (1024² GIF animated) = ~100MB total
- All 1000 NFTs share the same animated image at the same phase — visually identical
- Each GIF animates the "growing crowd" effect, with phase 10 being the most dynamic (full movement)

This means a single NFT's appearance depends only on its current phase, not on its tokenId. Two NFTs at phase 5 look exactly the same. The visual difference between NFTs is only which phase they've reached.

### Open Sub-Questions
- **Royalty receiver**: single creator wallet, or split with treasury?
- **Mint recipient**: ETH goes to creator, or split?
- **NFT owner transfer**: should `phase` persist across transfers? (Yes, recommended — evolution is permanent)
- **Storage size**: ~100MB for 10 animated GIFs. Within Vercel free tier (5GB Hobby plan).

### Status
**Design complete** — all burn/mint/royalty economics finalized. Ready to start NFT contract development.
