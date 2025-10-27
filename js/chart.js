import { TF_TO_BINANCE, INDICATORS, RISK } from "./config.js";
import { renderStats } from "./ui.js";

// -------- Fetch klines (Bybit) ----------
async function fetchKlines({ symbol, timeframe, limit = 500 }) {
  const interval = TF_TO_BINANCE[timeframe] || "15m"; // map 15m/1h/4h -> 15/60/240 trong function
  const url = `/.netlify/functions/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if(!res.ok){ throw new Error(await res.text()); }
  const d = await res.json();
  return d.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4]
  }));
}

// -------- Helpers: EMA/SMA ----------
function sma(values, period){
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for(let i=0;i<values.length;i++){
    sum += values[i];
    if(i>=period) sum -= values[i-period];
    if(i>=period-1) out[i] = sum/period;
  }
  return out;
}
function ema(values, period){
  const out = new Array(values.length).fill(null);
  const k = 2/(period+1);
  let prev = null, seed = 0;
  for(let i=0;i<values.length;i++){
    const v = values[i];
    if(i < period){
      seed += v;
      if(i===period-1){ prev = seed/period; out[i]=prev; }
      continue;
    }
    prev = v*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}

// -------- Generate signals: EMA cross ----------
function generateSignals(closes, emaFast, emaSlow){
  const signals = [];
  for(let i=1;i<closes.length;i++){
    if(emaFast[i-1]==null || emaSlow[i-1]==null) continue;
    const prevDiff = emaFast[i-1]-emaSlow[i-1];
    const currDiff = emaFast[i]-emaSlow[i];
    if(prevDiff<=0 && currDiff>0) signals.push({ i, dir: "long" });
    if(prevDiff>=0 && currDiff<0) signals.push({ i, dir: "short" });
  }
  return signals;
}

// -------- Backtest đơn giản (no fee) ----------
function backtest(bars, signals){
  const { positionUSD, leverage, tp_pct, sl_pct } = RISK;
  const contractsUSD = positionUSD * leverage;

  let trades=0, wins=0, losses=0, pnlUSD=0, rrSum=0;

  for(const s of signals){
    const entry = bars[s.i].close;
    const dir = s.dir;

    let tp, sl;
    if(dir==="long"){
      tp = entry*(1+tp_pct);
      sl = entry*(1-sl_pct);
    }else{
      tp = entry*(1-tp_pct);
      sl = entry*(1+sl_pct);
    }

    let outcome = null;
    for(let j=s.i+1;j<bars.length;j++){
      const b = bars[j];
      if(dir==="long"){
        if(b.low<=sl){ outcome='loss'; break; }
        if(b.high>=tp){ outcome='win'; break; }
      }else{
        if(b.high>=sl){ outcome='loss'; break; }
        if(b.low<=tp){ outcome='win'; break; }
      }
    }
    if(!outcome) continue;

    trades++;
    if(outcome==='win'){
      wins++;
      const move = tp_pct;
      pnlUSD += contractsUSD * move / entry;
      rrSum += tp_pct/sl_pct;
    }else{
      losses++;
      const move = sl_pct;
      pnlUSD -= contractsUSD * move / entry;
    }
  }

  const winrate = trades ? wins/trades : 0;
  const avgRR = trades ? rrSum / trades : 0;
  return { trades, wins, losses, winrate, pnlUSD, avgRR };
}

// -------- Main render ----------
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
  const bars = await fetchKlines({ symbol, timeframe
