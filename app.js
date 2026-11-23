// Rowan Trade on HSK — frontend app
// Paper trading only, on HSK Chain testnet (chain 133). No real funds.
// Every number on screen comes from a live source (HSKSwap pool slot0 or
// the RowanTrade contract). If a feed fails, the UI says so — it never
// invents a price, a position or a P&L.

const Q192 = 2n ** 192n;
let provider = null; // read-only JsonRpcProvider to the public HSK testnet RPC
let signer = null;
let account = null;
let livePrice = null; // { priceUsd, priceUsd8: bigint, tick, liquidity, blockNumber }
let tradeContract = null; // read-only contract (or null while undeployed)

const $ = (id) => document.getElementById(id);
const fmtUsd = (n, d = 4) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBps = (b) => (b >= 0 ? "+" : "") + (b / 100).toFixed(2) + "%";

// ---- live price feed (HSKSwap WHSK/USDT pool slot0) -------------------------
function priceFromSqrtPriceX96(sqrtPriceX96) {
  const x = BigInt(sqrtPriceX96);
  if (x === 0n) throw new Error("sqrtPriceX96 is zero");
  // Both tokens are 18 decimals: USDT per WHSK = 2^192 / sqrtPriceX96^2.
  const priceUsd8 = (Q192 * 100000000n) / (x * x);
  return { priceUsd8, priceUsd: Number(priceUsd8) / 1e8 };
}

async function fetchBoardPrice() {
  if (!provider) provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  const primary = CONFIG.pools.find((p) => p.reliable);
  const pool = new ethers.Contract(primary.pool, POOL_ABI, provider);
  const [slot0, liquidity] = await Promise.all([pool.slot0(), pool.liquidity()]);
  const { priceUsd8, priceUsd } = priceFromSqrtPriceX96(slot0.sqrtPriceX96);
  const blockNumber = await provider.getBlockNumber();
  return {
    pair: primary.pair,
    pool: primary.pool,
    priceUsd,
    priceUsd8,
    tick: Number(slot0.tick),
    liquidity: liquidity.toString(),
    blockNumber,
  };
}

function renderPrice() {
  const el = $("board");
  if (!livePrice) {
    el.innerHTML = `<div class="err">Live prices could not be loaded. The HSK testnet RPC did not answer — no prices are shown, nothing is invented. <button onclick="refreshAll()">Try again</button></div>`;
    return;
  }
  const p = livePrice;
  el.innerHTML = `
    <div class="price-card">
      <div class="sym">WHSK / USDT <span class="tag">HSKSwap · fee 0.05%</span></div>
      <div class="big">${fmtUsd(p.priceUsd, 4)}</div>
      <div class="meta">tick ${p.tick} · liquidity ${Number(p.liquidity).toExponential(2)} · block #${p.blockNumber}</div>
      <div class="meta dim">Pool ${p.pool.slice(0, 10)}… · <a href="${CONFIG.explorer}/address/${p.pool}" target="_blank" rel="noopener">explorer</a></div>
    </div>
    <div class="note">Testnet pool price — play tokens, not the mainnet HSK price. The WHSK/USDC pool is too thin to quote (tick implies ~$0) and is not shown as a price.</div>`;
}

function renderBriefing() {
  const el = $("briefing");
  if (!livePrice) {
    el.innerHTML = `<div class="err">Briefing paused — the live price feed is down, so Rowan will not guess.</div>`;
    return;
  }
  const p = livePrice;
  el.innerHTML = `
    <p><b>Rowan's take (from live numbers only):</b> WHSK trades at <b>${fmtUsd(p.priceUsd, 4)}</b> on the HSKSwap testnet pool (tick ${p.tick}, block #${p.blockNumber}). The agent watches this pool and opens paper positions only inside Haqi's rules — stop-loss −20%, take-profit +50%, max 25% of paper capital per position, max 10 open at once. No position is real money; every open and close is logged on-chain for the demo.</p>
    <p class="dim">This is a paper-trading demo on testnet, not financial advice.</p>`;
}

// ---- Ask Rowan (Q&A from live data, on demand) -------------------------------
async function askRowan() {
  const q = $("askInput").value.trim();
  const out = $("askOut");
  if (!q) {
    out.innerHTML = `<div class="err">Type a question first — e.g. "what is WHSK trading at?"</div>`;
    return;
  }
  out.innerHTML = `<div class="loading">Rowan is fetching live data for “${escapeHtml(q)}”…</div>`;
  try {
    const price = await fetchBoardPrice();
    livePrice = price;
    renderPrice();
    renderBriefing();
    const lower = q.toLowerCase();
    let answer;
    if (lower.includes("price") || lower.includes("trading at") || lower.includes("harga")) {
      answer = `WHSK is trading at <b>${fmtUsd(price.priceUsd, 4)}</b> on the HSKSwap testnet pool (tick ${price.tick}, block #${price.blockNumber}). That is the testnet pool's own price — play tokens, not the mainnet HSK price.`;
    } else if (lower.includes("stop") || lower.includes("loss") || lower.includes("risk")) {
      answer = `Haqi's risk rules: every paper position closes automatically at <b>−20% (stop-loss)</b> or <b>+50% (take-profit)</b>, max <b>25%</b> of paper capital per position, max <b>10</b> open positions. The contract enforces the caps; the agent enforces the exits against the live pool price.`;
    } else if (lower.includes("position") || lower.includes("p&l") || lower.includes("pnl")) {
      answer = account
        ? `Connect state aside — open the Positions board below for your live P&L. Without a wallet connected I cannot read your positions.`
        : `Connect your wallet to see your open positions and live P&L on the board below.`;
    } else {
      answer = `Rowan Trade is a paper-trading agent on HSKSwap (HSK Chain testnet). It watches the WHSK/USDT pool live — currently <b>${fmtUsd(price.priceUsd, 4)}</b> — and trades only inside Haqi's rules: stop-loss −20%, take-profit +50%, max 25% per position. Ask me about the price, the risk rules, or your positions.`;
    }
    out.innerHTML = `<div class="answer">${answer}</div>`;
  } catch (err) {
    out.innerHTML = `<div class="err">Live data has not loaded, so Rowan cannot answer honestly right now. (${escapeHtml(err.message)}) <button onclick="askRowan()">Try again</button></div>`;
  }
}

// ---- wallet + contract -------------------------------------------------------
function contractAddress() {
  return CONFIG.contractAddress || "";
}

function readContract() {
  if (!provider) provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  if (!contractAddress()) return null;
  if (!tradeContract) tradeContract = new ethers.Contract(contractAddress(), ROWAN_TRADE_ABI, provider);
  return tradeContract;
}

async function connectWallet() {
  if (!window.ethereum) {
    $("walletState").innerHTML = `<div class="err">No injected wallet found. Open this page in a wallet browser (e.g. MetaMask / Binance Wallet) to trade.</div>`;
    return;
  }
  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const network = await browserProvider.getNetwork();
    if (Number(network.chainId) !== CONFIG.chainId) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CONFIG.chainHex,
            chainName: CONFIG.chainName,
            nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
            rpcUrls: [CONFIG.rpcUrl],
            blockExplorerUrls: [CONFIG.explorer],
          },
        ],
      });
    }
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    $("walletState").innerHTML = `Connected: <b>${account.slice(0, 6)}…${account.slice(-4)}</b> · HSK Chain testnet`;
    $("connectBtn").textContent = "Connected";
    await refreshPositions();
    await refreshCheckIn();
  } catch (err) {
    $("walletState").innerHTML = `<div class="err">Wallet connection failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshCheckIn() {
  const el = $("checkinState");
  const c = readContract();
  if (!c) {
    el.innerHTML = `Check-in lives on-chain — it unlocks once the RowanTrade contract is deployed on HSK testnet.`;
    return;
  }
  if (!account) {
    el.innerHTML = `Connect your wallet to check in.`;
    return;
  }
  const [streak, total] = await Promise.all([c.checkInStreak(account), c.totalCheckIns(account)]);
  el.innerHTML = `Streak: <b>${streak}</b> day(s) · total check-ins: <b>${total}</b> <button onclick="doCheckIn()">Check in today (free, gas only)</button>`;
}

async function doCheckIn() {
  const c = readContract();
  if (!c || !signer) return;
  try {
    const tx = await c.connect(signer).checkIn();
    $("checkinState").innerHTML = `Check-in sent: ${tx.hash.slice(0, 18)}… — waiting for confirmation.`;
    await tx.wait();
    await refreshCheckIn();
  } catch (err) {
    $("checkinState").innerHTML = `<div class="err">Check-in failed: ${escapeHtml(err.message)}</div>`;
  }
}

// ---- positions + P&L ---------------------------------------------------------
function pnlBps(entryPrice, exitPrice) {
  return Number(((BigInt(exitPrice) - BigInt(entryPrice)) * 10000n) / BigInt(entryPrice));
}

async function refreshPositions() {
  const el = $("positions");
  const c = readContract();
  if (!c) {
    el.innerHTML = `<div class="note">Positions live on-chain — the board unlocks once the RowanTrade contract is deployed on HSK testnet. The paper engine (rules + P&L math) already runs below against the live price.</div>`;
    return;
  }
  if (!account) {
    el.innerHTML = `<div class="note">Connect your wallet to see your open positions and live P&L.</div>`;
    return;
  }
  try {
    const ids = await c.getOpenPositions(account);
    if (ids.length === 0) {
      el.innerHTML = `<div class="note">No open positions. Open your first paper position below — entry is always the live pool price.</div>`;
      return;
    }
    let rows = "";
    let totalPnlUsd = 0;
    for (const id of ids) {
      const p = await c.getPosition(id);
      const pnl = livePrice ? pnlBps(p.entryPrice, livePrice.priceUsd8) : 0;
      const sizeUsd = (CONFIG.paperCapitalUsd * Number(p.sizeBps)) / 10000;
      const pnlUsd = (sizeUsd * pnl) / 10000;
      totalPnlUsd += pnlUsd;
      rows += `<tr>
        <td>#${p.id}</td><td>${escapeHtml(p.symbol)}</td>
        <td>${fmtUsd(Number(p.entryPrice) / 1e8, 4)}</td>
        <td>${livePrice ? fmtUsd(livePrice.priceUsd, 4) : "—"}</td>
        <td class="${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${(pnl / 100).toFixed(2)}%</td>
        <td class="${pnlUsd >= 0 ? "up" : "down"}">${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)}</td>
        <td>SL −${Number(p.stopLossBps) / 100}% / TP +${Number(p.takeProfitBps) / 100}%</td>
        <td><button onclick="closePosition(${p.id}, 0)">Close</button></td>
      </tr>`;
    }
    el.innerHTML = `
      <table><thead><tr><th>#</th><th>Pair</th><th>Entry</th><th>Live</th><th>P&L</th><th>P&L $</th><th>Rules</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="meta">Paper capital $${CONFIG.paperCapitalUsd} · open P&L total: <b class="${totalPnlUsd >= 0 ? "up" : "down"}">${totalPnlUsd >= 0 ? "+" : ""}$${totalPnlUsd.toFixed(2)}</b></div>`;
  } catch (err) {
    el.innerHTML = `<div class="err">Could not read positions: ${escapeHtml(err.message)}</div>`;
  }
}

async function openPosition() {
  const c = readContract();
  if (!c || !signer || !livePrice) {
    $("tradeState").innerHTML = `<div class="err">Need a wallet, the deployed contract and a live price first.</div>`;
    return;
  }
  const sizeBps = parseInt($("sizeInput").value, 10) * 100;
  const sl = CONFIG.rules.stopLossBps;
  const tp = CONFIG.rules.takeProfitBps;
  if (sizeBps < CONFIG.rules.minPositionBps || sizeBps > CONFIG.rules.maxPositionBps) {
    $("tradeState").innerHTML = `<div class="err">Size must be ${CONFIG.rules.minPositionBps / 100}%–${CONFIG.rules.maxPositionBps / 100}% of paper capital.</div>`;
    return;
  }
  try {
    const tx = await c
      .connect(signer)
      .openPosition("WHSK/USDT", livePrice.priceUsd8, sizeBps, sl, tp);
    $("tradeState").innerHTML = `Opening… tx ${tx.hash.slice(0, 18)}…`;
    await tx.wait();
    $("tradeState").innerHTML = `Position opened at ${fmtUsd(livePrice.priceUsd, 4)} (SL −20% / TP +50%).`;
    await refreshPositions();
  } catch (err) {
    $("tradeState").innerHTML = `<div class="err">Open failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function closePosition(id, reason) {
  const c = readContract();
  if (!c || !signer || !livePrice) return;
  try {
    const tx = await c.connect(signer).closePosition(id, livePrice.priceUsd8, reason);
    $("tradeState").innerHTML = `Closing #${id}… tx ${tx.hash.slice(0, 18)}…`;
    await tx.wait();
    $("tradeState").innerHTML = `Position #${id} closed at ${fmtUsd(livePrice.priceUsd, 4)}.`;
    await refreshPositions();
  } catch (err) {
    $("tradeState").innerHTML = `<div class="err">Close failed: ${escapeHtml(err.message)}</div>`;
  }
}

// The agent check: evaluate every open position against the live price and
// close the ones that hit Haqi's stop-loss or take-profit, recording the
// reason on-chain. One click = one agent run.
async function runAgentCheck() {
  const c = readContract();
  if (!c || !signer || !livePrice) {
    $("tradeState").innerHTML = `<div class="err">Need a wallet, the deployed contract and a live price first.</div>`;
    return;
  }
  try {
    const ids = await c.getOpenPositions(account);
    let closed = 0;
    const notes = [];
    for (const id of ids) {
      const p = await c.getPosition(id);
      const pnl = pnlBps(p.entryPrice, livePrice.priceUsd8);
      if (pnl <= -Number(p.stopLossBps)) {
        await (await c.connect(signer).closePosition(id, livePrice.priceUsd8, 1)).wait();
        notes.push(`#${id} stop-loss at ${(pnl / 100).toFixed(2)}%`);
        closed++;
      } else if (pnl >= Number(p.takeProfitBps)) {
        await (await c.connect(signer).closePosition(id, livePrice.priceUsd8, 2)).wait();
        notes.push(`#${id} take-profit at +${(pnl / 100).toFixed(2)}%`);
        closed++;
      }
    }
    $("tradeState").innerHTML =
      closed === 0
        ? `Agent check done at ${fmtUsd(livePrice.priceUsd, 4)} — no position hit its stop-loss or take-profit.`
        : `Agent check done: ${notes.join("; ")}.`;
    await refreshPositions();
  } catch (err) {
    $("tradeState").innerHTML = `<div class="err">Agent check failed: ${escapeHtml(err.message)}</div>`;
  }
}

// ---- boot --------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function refreshAll() {
  try {
    livePrice = await fetchBoardPrice();
    renderPrice();
    renderBriefing();
    if (account) await refreshPositions();
  } catch (err) {
    livePrice = null;
    renderPrice();
    renderBriefing();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("askBtn").addEventListener("click", askRowan);
  $("askInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") askRowan();
  });
  $("connectBtn").addEventListener("click", connectWallet);
  $("openBtn").addEventListener("click", openPosition);
  $("agentBtn").addEventListener("click", runAgentCheck);
  $("refreshBtn").addEventListener("click", refreshAll);
  refreshAll();
  setInterval(refreshAll, 60000);
  if (!contractAddress()) {
    $("deployState").innerHTML = `RowanTrade is not deployed on HSK testnet yet — the deployer is waiting for testnet HSK from the faucet. The live price board, briefing and Ask Rowan work now; positions and check-in unlock after deploy.`;
  } else {
    $("deployState").innerHTML = `Contract: <a href="${CONFIG.explorer}/address/${contractAddress()}" target="_blank" rel="noopener">${contractAddress()}</a>`;
  }
});
