// B20 Society NFT — mint + burn page logic.
// Connects wallet, reads on-chain state, mints NFTs, advances phases via burns.

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  formatUnits,
  maxUint256,
} from "https://esm.sh/viem@2.56.0";
import { base } from "https://esm.sh/viem@2.56.0/chains";

const NFT_ABI = parseAbi([
  "function mint() payable",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function maxPerWallet() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function burnCostFor(uint256 tokenId) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function advancePhase(uint256 tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const CHAIN = base;

const state = {
  config: null,
  publicClient: null,
  walletClient: null,
  account: null,
  nftAddress: null,
  societyAddress: null,
  totalSupply: 0n,
  maxSupply: 0n,
  userMints: 0n,
  userTokenIds: [],
  nftPhases: {}, // tokenId (string) -> phase number
  nftBurnCosts: {}, // tokenId (string) -> cost in wei
  societyBalance: 0n, // user's $SOCIETY balance in wei
  societySymbol: "SOCIETY",
  pendingBurnTokenId: null,
};

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setStatus(message, kind = "info") {
  const el = $("mint-status");
  if (!el) return;
  el.textContent = message;
  el.className = `mint-status mint-status-${kind}`;
}

function shortAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatSoc(wei) {
  // 18 decimals
  const n = Number(formatUnits(wei, 18));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

// ---------- Config + clients ----------

async function loadConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

async function makePublicClient() {
  return createPublicClient({
    chain: CHAIN,
    transport: http("https://base.drpc.org"),
  });
}

async function ensureWalletClient() {
  if (typeof window.ethereum === "undefined") {
    throw new Error("No wallet detected. Install MetaMask or another EVM wallet.");
  }
  return createWalletClient({
    chain: CHAIN,
    transport: custom(window.ethereum),
  });
}

// ---------- Data loaders ----------

async function loadContractStats() {
  if (!state.nftAddress) return;
  try {
    const [total, max] = await Promise.all([
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "totalSupply",
      }),
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "maxSupply",
      }),
    ]);
    state.totalSupply = total;
    state.maxSupply = max;

    const minted = Number(total);
    const maxN = Number(max);
    const available = Math.max(0, maxN - minted);
    const pct = maxN > 0 ? (minted / maxN) * 100 : 0;

    setText("minted-count", `${minted} / ${maxN}`);
    setText("available-count", `${available}`);
    setText("mint-pct", `${pct.toFixed(1)}% minted`);

    const bar = $("mint-progress");
    if (bar) bar.style.width = `${pct}%`;
  } catch (err) {
    console.error("Failed to read contract stats:", err);
    setText("minted-count", "—");
    setText("available-count", "—");
  }
}

async function loadSocietyBalance() {
  if (!state.societyAddress || !state.account) return;
  try {
    const balance = await state.publicClient.readContract({
      address: state.societyAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [state.account],
    });
    state.societyBalance = balance;
    setText(
      "society-balance",
      `${formatSoc(balance)} $${state.societySymbol}`,
    );
  } catch (err) {
    console.error("Failed to read $SOCIETY balance:", err);
    setText("society-balance", "—");
  }
}

async function loadUserMints() {
  if (!state.nftAddress || !state.account) return;
  try {
    const balance = await state.publicClient.readContract({
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "balanceOf",
      args: [state.account],
    });
    state.userMints = balance;
    setText("user-mints", balance.toString());

    // Fetch token IDs
    const ids = [];
    for (let i = 0n; i < balance; i++) {
      const id = await state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [state.account, i],
      });
      ids.push(id);
    }
    state.userTokenIds = ids;

    // Fetch phases + burn costs in parallel
    const phases = await Promise.all(
      ids.map((id) =>
        state.publicClient.readContract({
          address: state.nftAddress,
          abi: NFT_ABI,
          functionName: "phaseOf",
          args: [id],
        }),
      ),
    );
    const costs = await Promise.all(
      ids.map((id) =>
        state.publicClient.readContract({
          address: state.nftAddress,
          abi: NFT_ABI,
          functionName: "burnCostFor",
          args: [id],
        }),
      ),
    );
    ids.forEach((id, i) => {
      state.nftPhases[id.toString()] = phases[i];
      state.nftBurnCosts[id.toString()] = costs[i];
    });

    renderUserNfts();
  } catch (err) {
    console.error("Failed to read user mints:", err);
  }
}

async function renderUserNfts() {
  const grid = $("user-nfts");
  if (!grid) return;
  const empty = $("empty-state");
  if (state.userTokenIds.length === 0) {
    if (empty) {
      empty.textContent = state.account
        ? "You don't own any B20 Society NFTs yet. Mint one above!"
        : "Connect your wallet to see your NFTs.";
      empty.style.display = "block";
    }
    return;
  }
  if (empty) empty.style.display = "none";

  grid.innerHTML = "";
  state.userTokenIds.forEach((id) => {
    const idStr = id.toString();
    const phase = state.nftPhases[idStr] ?? 1;
    const cost = state.nftBurnCosts[idStr] ?? 0n;
    const isMax = cost === 0n;
    const costFmt = isMax ? "MAX" : formatSoc(cost);
    const hasEnough = state.societyBalance >= cost;

    const card = document.createElement("div");
    card.className = "nft-card nft-card-mint";
    card.innerHTML = `
      <img src="/images/nft/phase-${phase}.gif" alt="B20 Society NFT #${idStr}" loading="lazy">
      <div class="nft-card-info">
        <span class="id">#${idStr}</span>
        <span class="phase">P${phase}</span>
      </div>
      <div class="nft-burn-row">
        ${
          isMax
            ? `<button class="btn btn-secondary btn-sm" disabled>MAX PHASE</button>`
            : `<button class="btn btn-primary btn-sm burn-btn" data-token-id="${idStr}" data-cost="${cost}">
                 Burn ${costFmt} $${state.societySymbol} → P${phase + 1}
               </button>`
        }
        ${!isMax && !hasEnough ? `<p class="burn-warn">Insufficient $${state.societySymbol} balance</p>` : ""}
      </div>
    `;
    grid.appendChild(card);
  });

  // Wire up burn buttons
  grid.querySelectorAll(".burn-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tokenId = btn.getAttribute("data-token-id");
      const costWei = BigInt(btn.getAttribute("data-cost") || "0");
      burnAndAdvance(tokenId, costWei);
    });
  });
}

// ---------- Action button (connect / mint) ----------

function updateActionButton() {
  const btn = $("action-btn");
  if (!btn) return;
  if (state.account) {
    btn.textContent = "Mint NFT (0.001 ETH)";
    btn.disabled = false;
  } else {
    btn.textContent = "Connect Wallet";
    btn.disabled = false;
  }
}

async function handleAction() {
  if (!state.account) {
    await connectWallet();
  } else {
    await mint();
  }
}

async function connectWallet() {
  try {
    if (!state.walletClient) {
      state.walletClient = await ensureWalletClient();
    }
    const [account] = await state.walletClient.requestAddresses();
    state.account = account;

    // Switch to Base if not already
    try {
      await state.walletClient.switchChain({ id: 8453 });
    } catch (chainErr) {
      console.warn("Chain switch failed or already on Base:", chainErr);
    }

    // Update UI
    $("wallet-info").style.display = "block";
    setText("wallet-address", shortAddress(account));
    updateActionButton();
    setStatus("Wallet connected. Ready to mint.", "info");

    // Load user-specific data
    await Promise.all([loadUserMints(), loadSocietyBalance()]);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to connect wallet", "error");
  }
}

async function mint() {
  if (!state.account || !state.nftAddress) {
    setStatus("Connect wallet first.", "error");
    return;
  }
  const btn = $("action-btn");
  btn.disabled = true;
  setStatus("Sending transaction...", "info");

  try {
    const mintPrice = await state.publicClient.readContract({
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "mintPrice",
    });

    const hash = await state.walletClient.writeContract({
      account: state.account,
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "mint",
      value: mintPrice,
    });

    setStatus(`TX sent: ${hash.slice(0, 10)}... Waiting for confirmation.`, "info");

    const receipt = await state.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      setStatus("✓ Minted! Refreshing...", "success");
      await Promise.all([loadContractStats(), loadUserMints()]);
    } else {
      setStatus("Transaction reverted.", "error");
    }
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.message || "Mint failed", "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Burn (advance phase) ----------

async function burnAndAdvance(tokenId, costWei) {
  if (!state.account || !state.nftAddress || !state.societyAddress) {
    setStatus("Connect wallet first.", "error");
    return;
  }
  state.pendingBurnTokenId = tokenId;
  setStatus(`Burning ${formatSoc(costWei)} $${state.societySymbol} to advance #${tokenId}...`, "info");

  try {
    // 1. Check allowance, request approve if needed
    const allowance = await state.publicClient.readContract({
      address: state.societyAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [state.account, state.nftAddress],
    });

    if (allowance < costWei) {
      setStatus(`Approving $${state.societySymbol} spend...`, "info");
      const approveHash = await state.walletClient.writeContract({
        account: state.account,
        address: state.societyAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [state.nftAddress, maxUint256],
      });
      await state.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // 2. Call advancePhase
    setStatus(`Advancing phase for #${tokenId}...`, "info");
    const burnHash = await state.walletClient.writeContract({
      account: state.account,
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "advancePhase",
      args: [BigInt(tokenId)],
    });

    const receipt = await state.publicClient.waitForTransactionReceipt({
      hash: burnHash,
    });

    if (receipt.status === "success") {
      setStatus(`✓ Phase advanced for #${tokenId}!`, "success");
      // Refresh everything
      await Promise.all([loadUserMints(), loadSocietyBalance()]);
    } else {
      setStatus("Transaction reverted.", "error");
    }
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.message || "Burn failed", "error");
  } finally {
    state.pendingBurnTokenId = null;
  }
}

// ---------- Init ----------

async function init() {
  try {
    state.config = await loadConfig();
    state.publicClient = await makePublicClient();
    state.nftAddress = state.config.nft.contractAddress;
    state.societyAddress = state.config.token.societyAddress;

    if (!state.nftAddress) {
      setStatus("NFT contract not deployed yet. Set NFT_CONTRACT_ADDRESS in Vercel.", "error");
      $("action-btn").disabled = true;
      return;
    }

    if (!state.societyAddress) {
      console.warn("SOCIETY token address not set — burn flow will be disabled.");
    } else {
      try {
        const sym = await state.publicClient.readContract({
          address: state.societyAddress,
          abi: ERC20_ABI,
          functionName: "symbol",
        });
        state.societySymbol = sym;
      } catch (err) {
        console.warn("Could not read $SOCIETY symbol:", err);
      }
    }

    await loadContractStats();

    // Single button: Connect Wallet OR Mint (depending on connection state)
    $("action-btn").addEventListener("click", handleAction);
    updateActionButton();

    // Auto-reload stats every 30s
    setInterval(loadContractStats, 30_000);
  } catch (err) {
    console.error(err);
    setStatus("Failed to initialize. Refresh the page.", "error");
  }
}

init();
