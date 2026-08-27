// B20 Society NFT — mint page logic.
// Connects wallet, reads on-chain state, calls mint() with 0.001 ETH.

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  formatEther,
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
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const CHAIN = base;

const state = {
  config: null,
  publicClient: null,
  walletClient: null,
  account: null,
  nftAddress: null,
  totalSupply: 0n,
  maxSupply: 0n,
  userMints: 0n,
  userTokenIds: [],
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

  // Fetch phases in parallel
  const phases = await Promise.all(
    state.userTokenIds.map((id) =>
      state.publicClient.readContract({
        address: state.nftAddress,
        abi: NFT_ABI,
        functionName: "phaseOf",
        args: [id],
      }),
    ),
  );

  grid.innerHTML = "";
  state.userTokenIds.forEach((id, i) => {
    const phase = phases[i];
    const card = document.createElement("div");
    card.className = "nft-card";
    card.innerHTML = `
      <img src="/images/nft/phase-${phase}.gif" alt="B20 Society NFT #${id}" loading="lazy">
      <div class="nft-card-info">
        <span class="id">#${id}</span>
        <span class="phase">P${phase}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ---------- Wallet connect + mint ----------

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
    $("connect-btn").textContent = "Connected";
    $("connect-btn").disabled = true;
    $("wallet-info").style.display = "block";
    setText("wallet-address", shortAddress(account));
    $("mint-btn").disabled = false;
    setStatus("Wallet connected. Ready to mint.", "info");

    // Load user-specific data
    await loadUserMints();
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
  const btn = $("mint-btn");
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
      await loadContractStats();
      await loadUserMints();
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

// ---------- Init ----------

async function init() {
  try {
    state.config = await loadConfig();
    state.publicClient = await makePublicClient();
    state.nftAddress = state.config.nft.contractAddress;

    if (!state.nftAddress) {
      setStatus("NFT contract not deployed yet. Set NFT_CONTRACT_ADDRESS in Vercel.", "error");
      $("mint-btn").disabled = true;
      $("connect-btn").disabled = true;
      return;
    }

    await loadContractStats();

    $("connect-btn").addEventListener("click", connectWallet);
    $("mint-btn").addEventListener("click", mint);

    // Auto-reload stats every 30s
    setInterval(loadContractStats, 30_000);
  } catch (err) {
    console.error(err);
    setStatus("Failed to initialize. Refresh the page.", "error");
  }
}

init();
