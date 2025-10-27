import { SYMBOLS, TIMEFRAMES, INDICATORS } from "./config.js";

/* ====== Fetch nến từ CryptoCompare ======
   15m -> histominute aggregate=15; 1h -> histohour agg=1; 4h -> histohour agg=4 */
async function fetchBars(symbol, tf, limit = 500) {
  const CC = "https://min-api.cryptocompare.com/data/v2";
  const fsym = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const tsym = "USDT";
  let url;
  if (tf === "15m") {
    url = `${CC}/histominute?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=15&e=Binance`;
  } else if (tf === "1h") {
    url = `${CC}/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=1&e=Binance`;
  } else { // 4h
    url = `${CC}/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=4&e=Binance`;
  }
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  if (j.Response !== "Success") throw new Error(j.Message || "cc error");
  return j.Data.Data.map(b => ({ time: b.time, open:b.open, high:b.high, low:b.low, close:b.close }));
}

/* ====== SMA/EMA ====== */
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
    if(i<period){
      seed += v;
      if(i===period-1){ prev = seed/period; out[i]=prev; }
      continue;
    }
    prev = v*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}

/* ====== Tạo tín hiệu (EMA 9/21 cross) ======
   BUY  : EMA9 vừa cắt lên EMA21
   SELL : EMA9 vừa cắt xuống EMA21
   NEUT : còn lại */
function lastSignal(closes, emaF, emaS){
  for(let i=closes.length-1; i>=1; i--){
    if(emaF[i-1]==null || emaS[i-1]==null) continue;
    const prevDiff = emaF[i-1] - emaS[i-1];
    const currDiff = emaF[i]   - emaS[i];
    if(prevDiff<=0 && currDiff>0) return "BUY";
    if(prevDiff>=0 && currDiff<0) return "SELL";
  }
  return "NEUTRAL";
}

/* ====== Render ====== */
function paint(cell, signal){
  cell.textContent = signal;
  cell.className = signal === "BUY" ? "buy"
               : signal === "SELL" ? "sell" : "neutral";
}

export async function buildAndRun(){
  const table = document.querySelector('#sig-table tbody');
  const status = document.getElementById('statusLine');
  table.innerHTML = '';
  status.textContent = 'Loading…';

  for(const sym of SYMBOLS){
    // tạo row
    const tr = document.createElement('tr');
    const cSymbol = document.createElement('td'); cSymbol.textContent = sym; cSymbol.style.fontWeight='700';
    const c15m = document.createElement('td');
    const c1h  = document.createElement('td');
    const c4h  = document.createElement('td');
    const cLast= document.createElement('td');
    const cTime= document.createElement('td');
    tr.append(cSymbol,c15m,c1h,c4h,cLast,cTime);
    table.appendChild(tr);

    try {
      // lấy nến lớn nhất (4h) để có đủ dữ liệu, sau đó reuse cho 1h/15m
      const [b15,b1,b4] = await Promise.all([
        fetchBars(sym, '15m', 400),
        fetchBars(sym, '1h',  400),
        fetchBars(sym, '4h',  400),
      ]);

      const last = b15.at(-1)?.close ?? b1.at(-1)?.close ?? b4.at(-1)?.close ?? '-';
      const upd  = b15.at(-1)?.time || b1.at(-1)?.time || b4.at(-1)?.time || null;
      if(upd) cTime.textContent = new Date(upd*1000).toLocaleString();
      cLast.textContent = typeof last==='number' ? last.toFixed(2) : '-';

      const mk = (bars) => {
        const closes = bars.map(b=>b.close);
        const emaF = ema(closes, INDICATORS.emaFast);   // 9
        const emaS = ema(closes, INDICATORS.emaSlow);   // 21
        return lastSignal(closes, emaF, emaS);
      };

      paint(c15m, mk(b15));
      paint(c1h , mk(b1));
      paint(c4h , mk(b4));
    } catch (e){
      c15m.textContent = c1h.textContent = c4h.textContent = 'ERR';
      c15m.className = c1h.className = c4h.className = 'neutral';
      console.error(sym, e);
    }
  }

  status.textContent = 'Done. EMA(9/21) cross • Data: CryptoCompare (Binance spot).';
}
