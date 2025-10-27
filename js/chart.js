import { INDICATORS, RISK } from "./config.js";
import { renderStats } from "./ui.js";

/* ======= Fetch từ CryptoCompare (không cần API key) ======= */
/* 15m -> histominute aggregate=15; 1h -> histohour agg=1; 4h -> histohour agg=4 */
async function fetchKlines({ symbol, timeframe, limit = 500 }) {
  const CC_BASE = "https://min-api.cryptocompare.com/data/v2";
  const fsym = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const tsym = "USDT";

  let url;
  if (timeframe === "15m") {
    url = `${CC_BASE}/histominute?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=15&e=Binance`;
  } else if (timeframe === "1h") {
    url = `${CC_BASE}/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=1&e=Binance`;
  } else { // 4h
    url = `${CC_BASE}/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=4&e=Binance`;
  }

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  if (j.Response !== "Success") throw new Error(j.Message || "cryptocompare error");

  return j.Data.Data.map(b => ({
    time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
  }));
}

/* ======= Indicators ======= */
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

/* ======= Backtest đơn giản (no fee) ======= */
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
      wins++; pnlUSD += (contractsUSD * tp_pct) / entry; rrSum += tp_pct/sl_pct;
    } else {
      losses++; pnlUSD -= (contractsUSD * sl_pct) / entry;
    }
  }
  const winrate = trades ? wins/trades : 0;
  const avgRR = trades ? rrSum/trades : 0;
  return { trades, wins, losses, winrate, pnlUSD, avgRR };
}

/* ======= Render ======= */
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
  note.textContent = `${symbol} • ${timeframe} • Data: CryptoCompare • EMA(${INDICATORS.emaFast}/${INDICATORS.emaSlow}) SMA(${INDICATORS.sma})`;
  container.appendChild(note);
}
