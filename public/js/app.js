// B20 Society frontend — fetches live metadata from API
// No build step, no framework. Vanilla JS that just calls /api/*
// Add ?test=1 to URL to use test endpoints (mock data, no real contracts needed).

const REFRESH_MS = 30_000; // refresh every 30 seconds

const SAMPLE_NFTS = [1, 42, 100, 256, 500, 777, 999];

const TEST = new URLSearchParams(window.location.search).get("test") === "1";
// In test mode, only IDs listed in TEST_MINTED count as "minted".
// Default: empty list = TRUE fresh launch (0 NFTs minted, $0 mcap).
// Opt-in: add &minted=1,42,100 to URL to simulate minted state.
const TEST_MINTED = (new URLSearchParams(window.location.search).get("minted") ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => !Number.isNaN(n) && n >= 1);
const API = {
  health: TEST ? "/api/healthtest" : "/api/health",
  token: TEST ? "/api/metadata-test" : "/api/metadata",
  nft: (id) =>
    TEST
      ? `/api/nfttest/${id}?minted=${TEST_MINTED.join(",")}`
      : `/api/nft/${id}`,
};

const state = {
  env: null,
  token: null,
  nfts: {},
  lastUpdate: null,
};

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

function attr(data, name) {
  if (!data?.attributes) return null;
  return data.attributes.find((a) => a.trait_type === name)?.value;
}

function fmtNumber(n, decimals = 0) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return "—";
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

function elapsed(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// --- Render functions ---

function renderToken() {
  const data = state.token;
  if (!data) return;

  const tier = attr(data, "Tier");
  const marketcap = attr(data, "Market Cap (USD)");
  const nvdaPrice = attr(data, "NVDA Price (USD)");
  const stubMode = attr(data, "Stub Mode");
  const priceStale = attr(data, "Price Feed Stale") === "Yes";

  // Image (token section + hero)
  const img = document.getElementById("token-image");
  if (img && data.image) {
    if (img.src !== data.image) {
      img.style.opacity = "0";
      img.onload = () => (img.style.opacity = "1");
      img.src = data.image;
    }
  }
  const heroImg = document.getElementById("hero-token-image");
  if (heroImg && data.image) {
    if (heroImg.src !== data.image) {
      heroImg.style.opacity = "0";
      heroImg.onload = () => (heroImg.style.opacity = "1");
      heroImg.src = data.image;
    }
  }

  // Progress (percentage toward $1M)
  // Tier range is 0..90, so percentage = (tier / 90) * 100
  const TIER_MAX = 90;
  const progressEl = document.getElementById("progress-value");
  const progressBar = document.getElementById("progress-bar");
  if (tier != null) {
    const pct = Math.min(100, Math.max(0, (Number(tier) / TIER_MAX) * 100));
    if (progressEl) progressEl.textContent = `${pct.toFixed(1)}%`;
    if (progressBar) progressBar.style.width = `${pct}%`;
  } else {
    if (progressEl) progressEl.textContent = "—";
    if (progressBar) progressBar.style.width = "0%";
  }

  // Marketcap
  const mcEl = document.getElementById("marketcap-value");
  if (mcEl) mcEl.textContent = fmtUsd(Number(marketcap));

  // NVDA price
  const nvdaEl = document.getElementById("nvda-value");
  if (nvdaEl) nvdaEl.textContent = `$${fmtNumber(Number(nvdaPrice), 2)}`;

  // Stale indicator
  const staleEl = document.getElementById("stale-value");
  if (staleEl) {
    staleEl.textContent = priceStale ? "Yes" : "No";
    staleEl.className = priceStale ? "value stale" : "value";
  }

  // Total supply (from totalSupply or attribute)
  const totalSupplyEl = document.getElementById("supply-value");
  if (totalSupplyEl) {
    const supply = attr(data, "Total Supply");
    if (supply) {
      const human = Number(supply) / 1e18;
      totalSupplyEl.textContent = `${fmtNumber(human)} SOCIETY`;
    } else {
      totalSupplyEl.textContent = "1,000,000,000 SOCIETY";
    }
  }

  // Stub warning
  const stubEl = document.getElementById("stub-warning");
  if (stubEl) {
    if (stubMode) {
      stubEl.textContent = `⚠ Stub mode: ${stubMode}. Set env vars in Vercel.`;
      stubEl.style.display = "block";
    } else {
      stubEl.style.display = "none";
    }
  }

  // Last update
  const updEl = document.getElementById("last-update");
  if (updEl) {
    updEl.textContent = elapsed(state.lastUpdate);
    updEl.classList.add("pulse");
    setTimeout(() => updEl.classList.remove("pulse"), 2000);
  }
}

function renderNfts() {
  const grid = document.getElementById("nft-grid");
  if (!grid) return;

  grid.innerHTML = "";

  // Fresh launch: 0 NFTs minted. Show empty state instead of cards.
  if (TEST && TEST_MINTED.length === 0) {
    grid.innerHTML = `
      <div class="nft-empty-state">
        <p><strong>No NFTs minted yet.</strong></p>
        <p class="muted">Test mode: 0 / 1000 minted. Add <code>&amp;minted=1,42,100,256,500,777,999</code> to URL to see sample NFTs.</p>
      </div>
    `;
    return;
  }

  SAMPLE_NFTS.forEach((id) => {
    const data = state.nfts[id];
    const phase = data ? attr(data, "Phase") : null;
    const card = document.createElement("div");
    card.className = "nft-card";
    card.onclick = () => {
      window.open(`https://b20society.com/api/nft/${id}`, "_blank");
    };
    card.innerHTML = `
      <img src="${data?.image || (phase === 1 ? '/images/Soc1.jpg' : `/images/nft/phase-${phase || 1}.gif`)}" alt="NFT #${id}" loading="lazy">
      <div class="nft-card-info">
        <span class="id">#${id}</span>
        <span class="phase">P${phase || "—"}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPhaseLadder() {
  const wrap = document.getElementById("phase-ladder");
  if (!wrap) return;
  // Find which phase is most common
  const phases = Object.values(state.nfts)
    .filter(Boolean)
    .map((d) => attr(d, "Phase"))
    .filter((p) => p != null);
  const current = phases.length > 0 ? phases[0] : 1;

  const costs = [20, 30, 40, 50, 60, 70, 80, 90, 100];
  const cells = [];
  for (let p = 1; p <= 10; p++) {
    const isCurrent = p === current;
    const cost = p === 10 ? "MAX" : `${costs[p - 1]}K`;
    cells.push(
      `<div class="phase-bar ${isCurrent ? "current" : "cost"}" title="Phase ${p}">${cost}</div>`,
    );
  }
  wrap.innerHTML = `
    <h3>Phase Evolution</h3>
    <p style="color:var(--text-dim);margin-bottom:16px;">Each advance burns $SOCIETY. Linear cost: 20K → 100K per tier.</p>
    <div class="phases">${cells.join("")}</div>
  `;
}

function renderContracts() {
  const wrap = document.getElementById("contracts");
  if (!wrap) return;
  const e = state.env || {};
  const items = [];
  items.push({
    label: "SOCIETY Token",
    addr: e.SOCIETY_ADDRESS,
    href: e.SOCIETY_ADDRESS ? `https://basescan.org/address/${e.SOCIETY_ADDRESS}` : null,
  });
  items.push({
    label: "NFT Contract",
    addr: e.NFT_CONTRACT_ADDRESS,
    href: e.NFT_CONTRACT_ADDRESS ? `https://basescan.org/address/${e.NFT_CONTRACT_ADDRESS}` : null,
  });
  items.push({
    label: "V4 Pool ID",
    addr: e.V4_POOL_ID,
    href: null,
  });
  items.push({
    label: "V4 Pool (PoolManager)",
    addr: "0x498581fF718922c3f8e6a244956aF099B2652b2b",
    href: "https://basescan.org/address/0x498581fF718922c3f8e6a244956aF099B2652b2b",
  });
  items.push({
    label: "RWA Stock Factory",
    addr: "0xFf70918eF17A2D74d683A8297813B177BaFaD1f4",
    href: "https://basescan.org/address/0xFf70918eF17A2D74d683A8297813B177BaFaD1f4",
  });
  items.push({
    label: "NVDA Paired Token",
    addr: "0xb20000000000000000000078Ee7Ce2Fe4908108C",
    href: "https://basescan.org/address/0xb20000000000000000000078Ee7Ce2Fe4908108C",
  });
  items.push({
    label: "Launch TX",
    addr: "0xfa88dab61bf5ef3f572dc3d9d6c5941b012af184e39e4a05a34236df7c838910",
    href: "https://basescan.org/tx/0xfa88dab61bf5ef3f572dc3d9d6c5941b012af184e39e4a05a34236df7c838910",
  });

  wrap.innerHTML = items
    .map(
      (it) => `
      <div class="contract-row">
        <span class="label">${it.label}</span>
        ${
          it.addr && it.addr !== "<not set>"
            ? `<a class="address" href="${it.href || "#"}" target="_blank" rel="noopener">${it.addr}<span class="ext">↗</span></a>`
            : `<span class="address" style="color:var(--text-faint)">Pending deploy</span>`
        }
      </div>
    `,
    )
    .join("");
}

// --- Data fetching ---

async function refreshAll() {
  try {
    const [health, token, ...nfts] = await Promise.all([
      fetchJson(API.health),
      fetchJson(API.token),
      ...SAMPLE_NFTS.map((id) => fetchJson(API.nft(id)).catch(() => null)),
    ]);
    state.env = health.env;
    state.token = token;
    SAMPLE_NFTS.forEach((id, i) => {
      state.nfts[id] = nfts[i];
    });
    state.lastUpdate = Date.now();
    renderAll();
  } catch (err) {
    console.error("Refresh failed:", err);
  }
}

function renderAll() {
  renderToken();
  renderNfts();
  renderPhaseLadder();
  renderContracts();
}

// --- Boot ---

document.addEventListener("DOMContentLoaded", () => {
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
});
// Vercel redeploy trigger Fri Aug 28 07:53:15 UTC 2026
// Vercel redeploy trigger Fri Aug 28 08:47:41 UTC 2026
// Vercel redeploy trigger Fri Aug 28 08:48:02 UTC 2026
