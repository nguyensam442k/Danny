import { TF_TO_BINANCE as TF_MAP_UI, INDICATORS, RISK } from "./config.js";
import { renderStats } from "./ui.js";

/** ==================== DATA FETCH ==================== */
// Ưu tiên gọi Netlify Function; nếu lỗi (403/404/5xx) thì fallback Bybit trực tiếp.
async function fetchKlines({ symbol, timeframe, limit = 500 }) {
  // 1) Thử Netlify Function (dùng tham số 15m/1h/4h)
  try {
    const urlFn = `/.netlify/functions/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
    const r = await fetch(urlFn);
    if (r.ok) {
      const d = await r.json();
      return d.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      }));
    }
  } catch (_) { /* bỏ qua, fallback phía dưới */ }

  // 2) Fallback: Bybit v5 (linear USDT perp) — gọi trực tiếp, không cần proxy
  const MAP_BYBIT = { "15m": "15", "1h": "60", "4h": "240" };
  const iv = MAP_BYBIT[timeframe] || "15";
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  const j = await res.json();
  if (j.retCode !== 0) throw new Error(j.retMsg || "bybit error");

  // Bybit trả newest-first -> đảo lại oldest-first
  const list = (j.result?.list || []).slice().reverse();
  return list.map(row => ({
    time: Math.floor(Number(row[0]) / 1000),
    open: +row[1], high: +row[2], low: +row[3], close: +row[4],
  }));
}

/** ==================== INDICATORS ==================== */
function sma(values, period){
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i=0;i<values.length;i++){
    sum += values[i];
    if (i>=period) sum -= values[i-period];
    if (i>=period-1) out[i] = sum/period;
  }
  return out;
}
function ema(values, period){
  const out = new Array(values.length).fill(null);
  const k = 2/(period+1);
  let prev = null, seed = 0;
  for (let i=0;i<values.length;i++){
    const v = values[i];
    if (i < period){
      seed += v;
      if (i===period-1){ prev = seed/period; out[i]=prev; }
      continue;
    }
    prev = v*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}
function generateSignals(closes, emaFast, emaSlow){
  const signals = [];
  for (let i=1;i<closes.length;i++){
    if (emaFast[i-1]==null || emaSlow[i-1]==null) continue;
    const prevDiff = emaFast[i-1]-emaSlow[i-1];
    const currDiff = emaFast[i]-emaSlow[i];
    if (prevDiff<=0 && currDiff>0) signals.push({ i, dir: "long" });
    if (prevDiff>=0 && currDiff<0) signals.push({ i, dir: "short" });
  }
  return signals;
}

/** ==================== SIMPLE BACKTEST ==================== */
function backtest(bars, signals){
  const { positionUSD, leverage, tp_pct, sl_pct } = RISK;
  const contractsUSD = positionUSD * leverage;

  let trades=0, wins=0, losses=0, pnlUSD=0, rrSum=0;

  for (const s of signals){
    const entry = bars[s.i].close;
    const dir = s.dir;

    const tp = dir==="long" ? entry*(1+tp_pct) : entry*(1-tp_pct);
    const sl = dir==="long" ? entry*(1-sl_pct) : entry*(1+sl_pct);

    let outcome = null;
    for (let j=s.i+1;j<bars.length;j++){
      const b = bars[j];
      if (dir==="long"){
        if (b.low<=sl){ outcome='loss'; break; }
        if (b.high>=tp){ outcome='win'; break; }
      } else {
        if (b.high>=sl){ outcome='loss'; break; }
        if (b.low<=tp){ outcome='win'; break; }
      }
    }
    if (!outcome) continue;

    trades++;
    if (outcome==='win'){
      wins++;
      pnlUSD += (contractsUSD * tp_pct) / entry;
      rrSum += tp_pct/sl_pct;
    } else {
      losses++;
      pnlUSD -= (contractsUSD * sl_pct) / entry;
    }
  }

  const winrate = trades ? wins/trades : 0;
  const avgRR = trades ? rrSum/trades : 0;
  return { trades, wins, losses, winrate, pnlUSD, avgRR };
}

/** ==================== RENDER ==================== */
export async function loadAndRenderChart({ symbol, timeframe }) {
  const container = document.getElementById("chart");
  container.innerHTML = "";

  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: { background: { type: "solid", color: "#ffffff" }, textColor: "#222" },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
    timeScale: { borderColor: "#d1d5db" },
    rightPriceScale: { borderColor: "#d1d5db" },
  });

  const candleSeries = chart.addCandlestickSeries();
  const bars = await fetchKlines({ symbol, timeframe, limit: 1000 });
  candleSeries.setData(bars);

  const closes = bars.map(b => b.close);
  const emaF = ema(closes, INDICATORS.emaFast);
  const emaS = ema(closes, INDICATORS.emaSlow);
  const sma50 = sma(closes, INDICATORS.sma);

  const emaFastLine = chart.addLineSeries({ lineWidth: 2 });
  const emaSlowLine = chart.addLineSeries({ lineWidth: 2 });
  const smaLine     = chart.addLineSeries({ lineWidth: 1 });

  emaFastLine.setData(bars.map((b, i) => ({ time: b.time, value: emaF[i] ?? null })));
  emaSlowLine.setData(bars.map((b, i) => ({ time: b.time, value: emaS[i] ?? null })));
  smaLine.setData(bars.map((b, i) => ({ time: b.time, value: sma50[i] ?? null })));

  const signals = generateSignals(closes, emaF, emaS);
  candleSeries.setMarkers(signals.map(s => ({
    time: bars[s.i].time,
    position: s.dir==="long" ? "belowBar" : "aboveBar",
    color: s.dir==="long" ? "#16a34a" : "#dc2626",
    shape: s.dir==="long" ? "arrowUp" : "arrowDown",
    text: s.dir==="long" ? "EMA Cross ↑" : "EMA Cross ↓",
  })));

  const stats = backtest(bars, signals);
  renderStats(stats);

  const note = document.createElement("div");
  note.style.position='absolute'; note.style.top='8px'; note.style.left='16px';
  note.style.padding='4px 8px'; note.style.background='rgba(0,0,0,0.6)';
  note.style.color='#fff'; note.style.borderRadius='6px'; note.style.fontSize='12px';
  note.textContent = `${symbol} • ${timeframe} • Bybit Perp • EMA(${INDICATORS.emaFast}/${INDICATORS.emaSlow}) SMA(${INDICATORS.sma})`;
  container.appendChild(note);
}
