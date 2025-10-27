// js/ui.js — MVP signal board (m15, BTC/ETH)
// Data: CryptoCompare (Binance spot), EMA(9/21) cross, SL=1*ATR(14), TP=0.6/1.0/1.4%
// Journal hooks: addTrade / updateLiveTrades / renderSummaryTable / renderHistoryTable

import {
  addTrade,
  makeTradeId,
  updateLiveTrades,
  renderSummaryTable,
  renderHistoryTable,
} from "./journal.js";

// -------------------- Config --------------------
const PAIRS = ["BTC", "ETH"];
const TSYM = "USDT";
const EXCHANGE = "Binance";          // theo CryptoCompare
const LIMIT = 250;                    // số nến tải cho m15
const TF_MINUTES = 15;
const SIZE_U = 100;                   // 100u
const LEV = 25;                       // x25
const EXP_HOURS = 4;                  // hết hạn 4h
const TP_STEPS = [0.006, 0.010, 0.014]; // 0.6% / 1.0% / 1.4%

// -------------------- Utils --------------------
function q(sel) { return document.querySelector(sel); }
function fmtNum(n) { return Number(n).toLocaleString(); }
function pct(n) { return (n * 100).toFixed(2) + "%"; }

function ema(series, period) {
  const k = 2 / (period + 1);
  let emaPrev = series[0];
  const out = [emaPrev];
  for (let i = 1; i < series.length; i++) {
    emaPrev = series[i] * k + emaPrev * (1 - k);
    out.push(emaPrev);
  }
  return out;
}

function atr(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trs.push(tr);
  }
  // EMA ATR
  const k = 2 / (period + 1);
  let prev = trs[0];
  const out = [prev];
  for (let i = 1; i < trs.length; i++) {
    prev = trs[i] * k + prev * (1 - k);
    out.push(prev);
  }
  // align với candles cuối: out.length == candles.length-1 → lấy cuối
  return out[out.length - 1];
}

function rrRatio(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  return risk > 0 ? (reward / risk).toFixed(2) : "—";
}

// -------------------- Data fetch --------------------
async function fetchHistMinute(sym) {
  // CryptoCompare histominute
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=${TSYM}&e=${EXCHANGE}&limit=${LIMIT}`;
  const r = await fetch(url);
  const js = await r.json();
  if (!js || !js.Data || !js.Data.Data) throw new Error("No data");
  return js.Data.Data.map(x => ({
    time: x.time * 1000,
    open: x.open,
    high: x.high,
    low: x.low,
    close: x.close,
    volumefrom: x.volumefrom,
    volumeto: x.volumeto,
  }));
}

// -------------------- Signal build --------------------
function buildSignal(sym, candles) {
  // Lấy close mảng để tính EMA
  const closes = candles.map(c => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);

  const n = closes.length;
  if (n < 22) return null;

  // kiểm tra cross ở cây cuối (so với cây trước)
  const prevCrossUp = e9[n - 2] <= e21[n - 2] && e9[n - 1] > e21[n - 1];
  const prevCrossDown = e9[n - 2] >= e21[n - 2] && e9[n - 1] < e21[n - 1];

  if (!prevCrossUp && !prevCrossDown) {
    return null; // không có tín hiệu mới
  }

  const last = candles[n - 1];
  const entry = last.close;
  const atr14 = atr(candles.slice(-60), 14); // lấy 60 nến gần nhất để ATR mượt
  const barISO = new Date(last.time).toISOString();

  const direction = prevCrossUp ? "BUY" : "SELL";

  // TP/SL:
  const tp1 = direction === "BUY" ? entry * (1 + TP_STEPS[0]) : entry * (1 - TP_STEPS[0]);
  const tp2 = direction === "BUY" ? entry * (1 + TP_STEPS[1]) : entry * (1 - TP_STEPS[1]);
  const tp3 = direction === "BUY" ? entry * (1 + TP_STEPS[2]) : entry * (1 - TP_STEPS[2]);
  const sl = direction === "BUY" ? entry - atr14 : entry + atr14;

  return {
    sym: sym,
    dir: direction,         // BUY | SELL
    entry,
    sl,
    tp1, tp2, tp3,          // hiển thị
    chosenTp: tp2,          // dùng TP2 để ghi journal
    barTimeISO: barISO,
    rr: rrRatio(entry, sl, tp2),
    conf: Math.max(10, 60 - Math.abs(e9[n - 1] - e21[n - 1]) / entry * 100 | 0) // “độ tự tin” giả lập
  };
}

// -------------------- Render card --------------------
function cardHTML(sym, sig, currentPrice) {
  if (!sig) {
    return `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:10px;align-items:center">
            <div class="tag">${sym}</div>
            <div class="tag">m15</div>
            <div class="tag">No trade</div>
          </div>
          <div class="tag">Last: $${fmtNum(currentPrice)}</div>
        </div>
        <div style="margin-top:8px;color:#9fb3c8">Không có tín hiệu mới ở nến vừa đóng.</div>
      </div>
    `;
  }

  const pnlPct = sig.dir === 'BUY'
    ? (currentPrice - sig.entry) / sig.entry
    : (sig.entry - currentPrice) / sig.entry;

  const pnlUSD = SIZE_U * LEV * pnlPct;
  const pnlClass = pnlUSD >= 0 ? 'green' : 'red';

  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="tag">${sym}</div>
          <div class="tag">${sig.dir}</div>
          <div class="tag">m15</div>
          <div class="tag">Conf: ${sig.conf}%</div>
          <div class="tag">R/R: ${sig.rr}</div>
          <div class="tag">100U × 25x</div>
        </div>
        <div class="tag">Last: $${fmtNum(currentPrice)}</div>
      </div>

      <div style="display:grid;grid-template-columns: repeat(6,1fr);gap:12px;margin-top:14px">
        <div>
          <div class="small">ENTRY</div>
          <div>$${fmtNum(sig.entry)}</div>
        </div>
        <div>
          <div class="small">CURRENT</div>
          <div>$${fmtNum(currentPrice)}</div>
        </div>
        <div>
          <div class="small">TIME</div>
          <div>15m</div>
        </div>
        <div>
          <div class="small">P&amp;L %</div>
          <div class="${pnlClass}">${pct(pnlPct)}</div>
        </div>
        <div>
          <div class="small">PROFIT (25x)</div>
          <div class="${pnlClass}">${pnlUSD>=0?'+':'-'}$${Math.abs(pnlUSD).toFixed(2)}</div>
        </div>
        <div>
          <div class="small">STATUS</div>
          <div class="tag">ACTIVE</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        <div class="tag">SL $${fmtNum(sig.sl)}</div>
        <div class="tag">TP1 $${fmtNum(sig.tp1)}</div>
        <div class="tag">TP2 $${fmtNum(sig.tp2)}</div>
        <div class="tag">TP3 $${fmtNum(sig.tp3)}</div>
      </div>
    </div>
  `;
}

function ensureTagCSS() {
  if (document.getElementById('ui-tags-css')) return;
  const style = document.createElement('style');
  style.id = 'ui-tags-css';
  style.textContent = `
    .tag{background:#1f2633;border:1px solid #2a3447;border-radius:8px;padding:6px 10px;color:#c8d6e5;font-size:12px}
    .small{color:#9fb3c8;font-size:12px;margin-bottom:4px}
  `;
  document.head.appendChild(style);
}

// -------------------- Journal hooks --------------------
function onNewSignal(signal) {
  // tạo id duy nhất theo sym + barTimeISO
  const id = makeTradeId(signal.sym, signal.barTimeISO);
  addTrade({
    id,
    sym: signal.sym,
    tf: '15m',
    dir: signal.dir,                // BUY | SELL
    entry: signal.entry,
    sl: signal.sl,
    tp: signal.chosenTp,            // dùng TP2
    sizeU: SIZE_U,
    lev: LEV,
    createdAt: Date.now(),
    expireAt: Date.now() + EXP_HOURS * 60 * 60 * 1000,
    status: 'ACTIVE',
    exitPx: null,
    exitAt: null,
    reason: null,
    pnl: 0
  });
}

// được gọi sau mỗi lần cập nhật xong giá 2 cặp
function afterPricesUpdated(latest) {
  updateLiveTrades(latest);
  renderSummaryTable();
  renderHistoryTable();
}

// -------------------- Main refresh flow --------------------
async function refreshOnce() {
  ensureTagCSS();

  const cardsRoot = q("#cards-root");
  if (!cardsRoot) return;

  const latestPrices = {};
  const htmlCards = [];

  for (const sym of PAIRS) {
    try {
      const candles = await fetchHistMinute(sym);
      const lastClose = candles[candles.length - 1].close;
      latestPrices[sym] = lastClose;

      // Build tín hiệu
      const sig = buildSignal(sym, candles);

      // Nếu có tín hiệu mới thì GHI JOURNAL (1 lần theo id)
      if (sig) onNewSignal(sig);

      // render card
      htmlCards.push(cardHTML(sym, sig, lastClose));
    } catch (e) {
      htmlCards.push(`
        <div class="panel">
          <div style="display:flex;gap:10px;align-items:center">
            <div class="tag">${sym}</div>
            <div class="tag red">Error</div>
          </div>
          <div style="margin-top:6px;color:#ff9f9f">${e.message || e}</div>
        </div>
      `);
    }
  }

  cardsRoot.innerHTML = htmlCards.join("");

  // cập nhật journal sau khi có đủ giá
  afterPricesUpdated(latestPrices);
}

// auto refresh mỗi 60s
let timer = null;
function startAuto() {
  if (timer) clearInterval(timer);
  timer = setInterval(refreshOnce, 60_000);
}

// listen nút Refresh từ index.html
window.addEventListener("app:refresh", refreshOnce);

// khởi động
refreshOnce();
startAuto();
