// B20 Society NFT — Upgrade page
// Lists the user's NFTs, shows live phase + cost, exposes a "Burn to advance" button per NFT.
// Pulls from the same on-chain source as /mint, but with a focused single-purpose UX.

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
  "function MAX_SUPPLY() view returns (uint256)",
  "function MAX_PER_WALLET() view returns (uint256)",
  "function MINT_PRICE() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function burnCostFor(uint256 tokenId) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function advancePhase(uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function royaltyReceiver() view returns (address)",
  "function society() view returns (address)",
  "function exists(uint256 tokenId) view returns (bool)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const CHAIN = base;

// Phase cost curve: PHASE_DENOM * (currentPhase + 1) * 10^18
// 20K -> 30K -> 40K -> ... -> 100K
const PHASE_COSTS = [20_000n, 30_000n, 40_000n, 50_000n, 60_000n, 70_000n, 80_000n, 90_000n, 100_000n];

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
  nftPhases: {},
  nftBurnCosts: {},
  nftOwners: {},
  societyBalance: 0n,
  societySymbol: "SOCIETY",
  allowance: 0n,
  pendingBurnTokenId: null,
};

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setStatus(message, kind = "info") {
  const el = $("upgrade-status");
  if (!el) return;
  el.textContent = message;
  el.className = `mint-status mint-status-${kind}`;
}

function shortAddress(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatSoc(wei) {
  const n = Number(formatUnits(wei, 18));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

// ---------- Clients ----------

async function loadConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

function makePublicClient() {
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
    state.totalSupply = (await state.publicClient.readContract({
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "totalSupply",
    }));
    state.maxSupply = (await state.publicClient.readContract({
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "MAX_SUPPLY",
    }));
  } catch (err) {
    console.warn("Failed to read contract stats:", err);
  }
}

async function loadSocietyBalance() {
  if (!state.societyAddress || !state.account) return;
  try {
    state.societyBalance = (await state.publicClient.readContract({
      address: state.societyAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [state.account],
    }));
    setText("society-balance", `${formatSoc(state.societyBalance)} $${state.societySymbol}`);
  } catch (err) {
    console.warn("Failed to read $SOCIETY balance:", err);
  }
}

async function loadAllowance() {
  if (!state.societyAddress || !state.account || !state.nftAddress) return;
  try {
    state.allowance = await state.publicClient.readContract({
      address: state.societyAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [state.account, state.nftAddress],
    });
    const el = $("allowance-value");
    if (state.allowance === 0n) {
      if (el) {
        el.textContent = "0 (need approve)";
        el.className = "meta-value warn";
      }
    } else {
      if (el) {
        el.textContent = `${formatSoc(state.allowance)} $${state.societySymbol}`;
        el.className = "meta-value";
      }
    }
  } catch (err) {
    console.warn("Failed to read allowance:", err);
  }
}

async function loadUserNfts() {
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

    // Fetch phases + burn costs + owners in parallel
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
    const owners = await Promise.all(
      ids.map((id) =>
        state.publicClient.readContract({
          address: state.nftAddress,
          abi: NFT_ABI,
          functionName: "ownerOf",
          args: [id],
        }),
      ),
    );
    ids.forEach((id, i) => {
      state.nftPhases[id.toString()] = phases[i];
      state.nftBurnCosts[id.toString()] = costs[i];
      state.nftOwners[id.toString()] = owners[i];
    });

    renderUserNfts();
  } catch (err) {
    console.error("Failed to read user mints:", err);
    setStatus(`Failed to load your NFTs: ${err.message || "unknown"}`, "error");
    throw err;
  }
}

function renderPhaseTable() {
  const tbody = $("phase-table-body");
  if (!tbody) return;
  let cumulative = 0n;
  let rows = "";
  for (let p = 1; p <= 9; p++) {
    const cost = PHASE_COSTS[p - 1] * 10n ** 18n;
    cumulative += cost;
    rows += `
      <tr>
        <td class="mono">P${p} → P${p + 1}</td>
        <td class="mono">${formatSoc(cost)} $${state.societySymbol}</td>
        <td class="mono">${formatSoc(cumulative)} $${state.societySymbol}</td>
      </tr>
    `;
  }
  tbody.innerHTML = rows;
}

function renderUserNfts() {
  const grid = $("user-nfts");
  if (!grid) return;
  const empty = $("empty-state");
  if (state.userTokenIds.length === 0) {
    if (empty) {
      empty.textContent = state.account
        ? "You don't own any B20 Society NFTs yet. Visit /mint to get one."
        : "Connect your wallet to see your NFTs.";
      empty.style.display = "block";
    }
    return;
  }
  if (empty) empty.style.display = "none";

  grid.innerHTML = "";
  state.userTokenIds.forEach((id) => {
    const idStr = id.toString();
    const phase = Number(state.nftPhases[idStr] ?? 1);
    const cost = state.nftBurnCosts[idStr] ?? 0n;
    const owner = state.nftOwners[idStr] ?? "";
    const isMax = cost === 0n;
    const costFmt = isMax ? "MAX" : formatSoc(cost);
    const hasEnough = state.societyBalance >= cost;
    const needsApproval = !isMax && state.allowance < cost;
    const isOwner = state.account && owner && state.account.toLowerCase() === owner.toLowerCase();

    const card = document.createElement("div");
    card.className = "nft-card nft-card-mint";
    card.innerHTML = `
      <a class="nft-card-image-link" href="/nft?id=${idStr}">
        <img src="${phase === 1 ? `/images/Soc1.jpg` : `/images/nft/phase-${phase}.gif`}" alt="B20 Society NFT #${idStr}" loading="lazy">
      </a>
      <div class="nft-card-info">
        <span class="id">#${idStr}</span>
        <span class="phase">P${phase}${isMax ? " (MAX)" : ""}</span>
      </div>
      <div class="nft-burn-row">
        <div class="burn-info">
          <span class="burn-cost-label">Burn to advance:</span>
          <span class="burn-cost-value">${isMax ? "—" : costFmt + " $" + state.societySymbol}</span>
        </div>
        ${
          isMax
            ? `<button class="btn btn-secondary btn-full" disabled>MAX PHASE</button>`
            : !isOwner
            ? `<button class="btn btn-secondary btn-full" disabled>Not your NFT</button>`
            : `<button class="btn btn-primary btn-full burn-btn" data-token-id="${idStr}" data-cost="${cost}">
                 Burn ${costFmt} $${state.societySymbol} → P${phase + 1}
               </button>`
        }
        ${!isMax && !hasEnough ? `<p class="burn-warn">Insufficient $${state.societySymbol} balance</p>` : ""}
        ${!isMax && hasEnough && needsApproval ? `<p class="burn-warn">Need $SOCIETY approval first</p>` : ""}
        <a href="/nft?id=${idStr}" class="nft-detail-link">View on-chain details →</a>
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

// ---------- Action button (connect / disconnect) ----------

function updateActionButton() {
  const btn = $("action-btn");
  if (!btn) return;
  if (state.account) {
    btn.textContent = "Disconnect";
    btn.disabled = false;
  } else {
    btn.textContent = "Connect Wallet";
    btn.disabled = false;
  }
}

async function handleAction() {
  if (state.account) {
    // Disconnect (just clear local state)
    state.account = null;
    state.userTokenIds = [];
    state.nftPhases = {};
    state.nftBurnCosts = {};
    state.nftOwners = {};
    state.societyBalance = 0n;
    state.allowance = 0n;
    $("wallet-info").style.display = "none";
    setText("society-balance", "—");
    setText("allowance-value", "—");
    setText("user-mints", "0");
    setStatus("Disconnected.", "info");
    updateActionButton();
    renderUserNfts();
    return;
  }
  await connectWallet();
}

async function connectWallet() {
  try {
    if (!state.walletClient) {
      state.walletClient = await ensureWalletClient();
    }
    const [account] = await state.walletClient.requestAddresses();
    state.account = account;

    try {
      await state.walletClient.switchChain({ id: 8453 });
    } catch (err) {
      console.warn("Chain switch failed or already on Base:", err);
    }

    $("wallet-info").style.display = "block";
    setText("wallet-address", shortAddress(account));
    updateActionButton();
    setStatus("Wallet connected. Loading your NFTs...", "info");

    await Promise.all([loadUserNfts(), loadSocietyBalance(), loadAllowance()]);
    setStatus("Ready. Click a burn button below to advance phase.", "info");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to connect wallet", "error");
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
      setStatus(`Approving $${state.societySymbol} spend (one-time)...`, "info");
      const approveHash = await state.walletClient.writeContract({
        account: state.account,
        address: state.societyAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [state.nftAddress, maxUint256],
      });
      setStatus(`Approval sent: ${approveHash.slice(0, 10)}... waiting...`, "info");
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
    setStatus(`Burn sent: ${burnHash.slice(0, 10)}... waiting for confirmation.`, "info");

    const receipt = await state.publicClient.waitForTransactionReceipt({
      hash: burnHash,
    });

    if (receipt.status === "success") {
      setStatus(`✓ Phase advanced for #${tokenId}! Refreshing...`, "success");
      await Promise.all([loadUserNfts(), loadSocietyBalance(), loadAllowance()]);
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

// ---------- Auto-reconnect on page load ----------

async function trySilentReconnect() {
  if (typeof window === "undefined" || !window.ethereum) return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts && accounts.length > 0) {
      console.log("Auto-reconnecting to:", accounts[0]);
      state.account = accounts[0];
      state.walletClient = await ensureWalletClient();
      try {
        await state.walletClient.switchChain({ id: 8453 });
      } catch (e) {
        /* ignore */
      }
      $("wallet-info").style.display = "block";
      setText("wallet-address", shortAddress(state.account));
      updateActionButton();
      setStatus("Wallet reconnected. Loading your NFTs...", "info");
      await Promise.all([loadUserNfts(), loadSocietyBalance(), loadAllowance()]);
      setStatus("Ready. Click a burn button below to advance phase.", "info");
    }
  } catch (err) {
    console.warn("Silent reconnect failed:", err);
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
      setStatus("NFT contract not deployed yet.", "error");
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

    renderPhaseTable();
    await loadContractStats();

    $("action-btn").addEventListener("click", handleAction);
    updateActionButton();

    // Auto-refresh every 15s
    setInterval(async () => {
      if (state.account) {
        try {
          await Promise.all([loadUserNfts(), loadSocietyBalance(), loadAllowance()]);
        } catch (e) {
          /* swallow */
        }
      }
    }, 15_000);

    await trySilentReconnect();
  } catch (err) {
    console.error(err);
    setStatus("Failed to initialize. Refresh the page.", "error");
  }
}

init();
