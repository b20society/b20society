// B20 Society NFT — detail page (/nft/[tokenId])
// Parses tokenId from window.location.pathname, fetches /api/nft/[tokenId],
// displays metadata. Wallet connect + burn button for owners.

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
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function burnCostFor(uint256 tokenId) view returns (uint256)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function advancePhase(uint256 tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
]);

const CHAIN = base;
const MAX_SUPPLY = 1000;

const state = {
  tokenId: null,
  metadata: null,
  config: null,
  publicClient: null,
  walletClient: null,
  account: null,
  nftAddress: null,
  societyAddress: null,
  owner: null,
  phase: 1,
  burnCost: 0n,
  isOwner: false,
  societyBalance: 0n,
  societySymbol: "SOCIETY",
};

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

function show(id) {
  const el = $(id);
  if (el) el.style.display = "block";
}
function hide(id) {
  const el = $(id);
  if (el) el.style.display = "none";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setStatus(message, kind = "info") {
  const el = $("action-status");
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

// ---------- TokenId parsing ----------

function parseTokenId() {
  // Path 1: /nft?id=42 (cleanUrls)
  // Path 2: /nft.html?id=42
  // Path 3: /nft/42 (rewrite support)
  const params = new URLSearchParams(window.location.search);
  let idStr = params.get("id");
  if (!idStr) {
    const pathMatch = window.location.pathname.match(/^\/nft\/(\d+)\/?$/);
    if (pathMatch) idStr = pathMatch[1];
  }
  if (!idStr) return null;
  const id = Number(idStr);
  if (id < 1 || id > MAX_SUPPLY) return null;
  return id;
}

// ---------- Data loaders ----------

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
    throw new Error("No wallet detected. Install MetaMask.");
  }
  return createWalletClient({
    chain: CHAIN,
    transport: custom(window.ethereum),
  });
}

async function fetchMetadata() {
  const res = await fetch(`/api/nft/${state.tokenId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadOnchainData() {
  if (!state.nftAddress) return;
  try {
    const exists = (await state.publicClient.readContract({
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "exists",
      args: [BigInt(state.tokenId)],
    })) as boolean;
    if (!exists) return false;

    const [owner, phase, cost, totalSupply] = await Promise.all([
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "ownerOf",
        args: [BigInt(state.tokenId)],
      }),
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "phaseOf",
        args: [BigInt(state.tokenId)],
      }),
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "burnCostFor",
        args: [BigInt(state.tokenId)],
      }),
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "totalSupply",
      }),
    ]);

    state.owner = owner as string;
    state.phase = phase as number;
    state.burnCost = cost as bigint;

    if (state.account) {
      state.isOwner = state.account.toLowerCase() === (owner as string).toLowerCase();
    }

    setText("nft-owner", shortAddress(state.owner));
    const costDisplay = state.burnCost === 0n
      ? "MAX PHASE"
      : `${formatSoc(state.burnCost)} $${state.societySymbol}`;
    setText("nft-burn-cost", costDisplay);
    setText("nft-mint-position", `#${state.tokenId} of ${totalSupply}`);

    return true;
  } catch (err) {
    console.error("loadOnchainData error:", err);
    return false;
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
    })) as bigint;
  } catch (err) {
    console.error("Failed to read $SOCIETY balance:", err);
  }
}

// ---------- Render ----------

function updateActionButton() {
  const btn = $("action-btn");
  if (!btn) return;
  if (!state.account) {
    btn.textContent = "Connect Wallet";
    btn.disabled = false;
    return;
  }
  if (state.phase >= 10) {
    btn.textContent = "MAX PHASE";
    btn.disabled = true;
    return;
  }
  if (!state.isOwner) {
    btn.textContent = "Not Owner";
    btn.disabled = true;
    return;
  }
  const costFmt = formatSoc(state.burnCost);
  btn.textContent = `Burn ${costFmt} $${state.societySymbol} → P${state.phase + 1}`;
  btn.disabled = false;
}

function renderMetadata() {
  if (!state.metadata) return;
  // Use phase from on-chain if available, fallback to image URL
  const phase = state.phase || 1;
  const image = phase === 1
    ? `https://b20society.com/images/Soc1.jpg`
    : `https://b20society.com/images/nft/phase-${phase}.gif`;

  setText("nft-title", `B20 Society #${state.tokenId}`);
  const img = $("nft-image");
  if (img) img.src = image;
  setText("nft-phase-badge", `Phase ${phase}`);
  document.title = `B20 Society #${state.tokenId}`;
}

function showState(stateName) {
  ["loading-state", "error-state", "invalid-state", "nft-state"].forEach((s) => {
    if (s === stateName) show(s);
    else hide(s);
  });
}

// ---------- Actions ----------

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
      console.warn("Chain switch failed:", err);
    }

    setStatus("Wallet connected.", "info");
    await loadSocietyBalance();
    if (state.nftAddress) {
      const owner = await state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "ownerOf",
        args: [BigInt(state.tokenId)],
      });
      state.owner = owner as string;
      state.isOwner = state.account.toLowerCase() === (owner as string).toLowerCase();
      setText("nft-owner", shortAddress(state.owner));
    }
    updateActionButton();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to connect wallet", "error");
  }
}

async function burnAndAdvance() {
  if (!state.account) {
    await connectWallet();
    return;
  }
  if (!state.isOwner) {
    setStatus("Only the owner can burn this NFT.", "error");
    return;
  }
  if (state.phase >= 10) {
    setStatus("Already at MAX phase.", "error");
    return;
  }
  if (!state.societyAddress) {
    setStatus("SOCIETY token not configured.", "error");
    return;
  }
  if (state.societyBalance < state.burnCost) {
    setStatus(
      `Insufficient $${state.societySymbol}. Need ${formatSoc(state.burnCost)}, have ${formatSoc(state.societyBalance)}.`,
      "error",
    );
    return;
  }

  const btn = $("action-btn");
  btn.disabled = true;
  setStatus(`Burning ${formatSoc(state.burnCost)} $${state.societySymbol}...`, "info");

  try {
    const allowance = (await state.publicClient.readContract({
      address: state.societyAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [state.account, state.nftAddress],
    })) as bigint;

    if (allowance < state.burnCost) {
      setStatus(`Approving $${state.societySymbol}...`, "info");
      const approveHash = await state.walletClient.writeContract({
        account: state.account,
        address: state.societyAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [state.nftAddress, maxUint256],
      });
      await state.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    setStatus(`Advancing phase for #${state.tokenId}...`, "info");
    const burnHash = await state.walletClient.writeContract({
      account: state.account,
      address: state.nftAddress,
      abi: NFT_ABI,
      functionName: "advancePhase",
      args: [BigInt(state.tokenId)],
    });

    const receipt = await state.publicClient.waitForTransactionReceipt({ hash: burnHash });
    if (receipt.status === "success") {
      setStatus(`✓ Phase advanced!`, "success");
      // Refresh on-chain data
      await loadOnchainData();
      await loadSocietyBalance();
      renderMetadata();
      updateActionButton();
    } else {
      setStatus("Transaction reverted.", "error");
    }
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.message || "Burn failed", "error");
  } finally {
    btn.disabled = false;
    updateActionButton();
  }
}

async function handleAction() {
  if (!state.account) {
    await connectWallet();
  } else {
    await burnAndAdvance();
  }
}

// ---------- Init ----------

async function init() {
  // 1. Parse tokenId from URL
  const tokenId = parseTokenId();
  if (!tokenId) {
    showState("invalid-state");
    return;
  }
  state.tokenId = tokenId;

  // 2. Load config + clients
  try {
    state.config = await loadConfig();
    state.publicClient = makePublicClient();
    state.nftAddress = state.config.nft.contractAddress;
    state.societyAddress = state.config.token.societyAddress;

    if (state.societyAddress) {
      try {
        state.societySymbol = (await state.publicClient.readContract({
          address: state.societyAddress,
          abi: ERC20_ABI,
          functionName: "symbol",
        })) as string;
      } catch (err) {
        console.warn("Could not read $SOCIETY symbol:", err);
      }
    }
  } catch (err) {
    console.error("Init error:", err);
    showState("error-state");
    setText("error-title", "Loading Error");
    setText("error-text", err.message || "Failed to initialize.");
    return;
  }

  // 3. Fetch metadata from API
  let metadata;
  try {
    metadata = await fetchMetadata();
  } catch (err) {
    console.error("Metadata fetch error:", err);
    showState("error-state");
    setText("error-title", "Loading Error");
    setText("error-text", err.message || "Failed to load NFT metadata.");
    return;
  }

  if (!metadata) {
    showState("error-state");
    setText("error-title", "Token Not Minted");
    setText("error-text", `B20 Society #${tokenId} doesn't exist yet. It hasn't been minted.`);
    return;
  }

  state.metadata = metadata;

  // 4. Load on-chain data (owner, phase, cost) if contract deployed
  if (state.nftAddress) {
    const exists = await loadOnchainData();
    if (!exists) {
      showState("error-state");
      setText("error-title", "Token Not Minted");
      setText("error-text", `B20 Society #${tokenId} doesn't exist on chain yet.`);
      return;
    }
  } else {
    // Stub mode: use phase from image URL
    const phaseMatch = metadata.image.match(/phase-(\d+)/);
    if (phaseMatch) state.phase = Number(phaseMatch[1]);
    setText("nft-burn-cost", "Connect contract to see cost");
    setText("nft-mint-position", `#${tokenId} of ${MAX_SUPPLY}`);
  }

  // 5. Render
  renderMetadata();
  showState("nft-state");

  // 6. Wire button
  $("action-btn").addEventListener("click", handleAction);
  updateActionButton();
}

init();
