import { RISK } from "./config.js";

/* ---------- helpers ---------- */
const SYMS = ["BTCUSDT","ETHUSDT"];
const CC = "https://min-api.cryptocompare.com/data/v2";
const fmt = (x, d=2) => (typeof x === "number" ? x.toFixed(d) : x);
const pct = (p) => (p>0?`+${(p*100).toFixed(2)}%`:`${(p*100).toFixed(2)}%`);

async function fetchM15(symbol, limit=400){
  const fsym = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const url = `${CC}/histominute?fsym=${fsym}&tsym=USDT&limit=${limit}&aggregate=15&e=Binance`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (j.Response !== "Success") throw new Error(j.Message || "cc error");
  return j.Data.Data.map(b=>({t:b.time,o:b.open,h:b.high,l:b.low,c:b.close}));
}

/* ---------- indicators ---------- */
function sma(vals,p){ const out=Array(vals.length).fill(null); let s=0;
  for(let i=0;i<vals.length;i++){ s+=vals[i]; if(i>=p) s-=vals[i-p]; if(i>=p-1) out[i]=s/p; } return out; }
function ema(vals,p){ const out=Array(vals.length).fill(null); const k=2/(p+1); let prev=null,seed=0;
  for(let i=0;i<vals.length;i++){ const v=vals[i]; if(i<p){ seed+=v; if(i===p-1){ prev=seed/p; out[i]=prev; } continue; }
    prev=v*k+prev*(1-k); out[i]=prev; } return out; }
function atr(bars, p=14){ const out=Array(bars.length).fill(null); let s=0;
  for(let i=0;i<bars.length;i++){ if(i===0) continue;
    const tr=Math.max(bars[i].h-bars[i].l, Math.abs(bars[i].h-bars[i-1].c), Math.abs(bars[i].l-bars[i-1].c));
    if(i<=p){ s+=tr; if(i===p){ out[i]=s/p; } }
    else { const prev=out[i-1]; out[i]=(prev*(p-1)+tr)/p; } }
  return out; }
function bb(vals, p=20, k=2){ const m=sma(vals,p); const out=Array(vals.length).fill(null);
  for(let i=p-1;i<vals.length;i++){ let s=0; for(let j=i-p+1;j<=i;j++) s+=(vals[j]-m[i])**2;
    const sd=Math.sqrt(s/p); out[i]={mid:m[i],up:m[i]+k*sd,low:m[i]-k*sd}; } return out; }
function rsi(vals, p=14){ const out=Array(vals.length).fill(null); let ga=0,gl=0;
  for(let i=1;i<vals.length;i++){ const ch=vals[i]-vals[i-1]; const up=Math.max(ch,0), dn=Math.max(-ch,0);
    if(i<=p){ ga+=up; gl+=dn; if(i===p){ const rs=ga/gl||0; out[i]=100-100/(1+rs); } }
    else { ga=(ga*(p-1)+up)/p; gl=(gl*(p-1)+dn)/p; const rs=ga/gl||0; out[i]=100-100/(1+rs); } } return out; }
function stoch(bars, kLen=14, dLen=3){ const kArr=Array(bars.length).fill(null);
  for(let i=kLen-1;i<bars.length;i++){ let h=-1e9,l=1e9;
    for(let j=i-kLen+1;j<=i;j++){ if(bars[j].h>h) h=bars[j].h; if(bars[j].l<l) l=bars[j].l; }
    kArr[i]=100*(bars[i].c-l)/(h-l||1); }
  const dArr=sma(kArr.map(v=>v??0), dLen); return {k:kArr,d:dArr}; }
function macd(vals, f=12, s=26, sig=9){ const ef=ema(vals,f), es=ema(vals,s);
  const hist=vals.map((_,i)=> (ef[i]&&es[i]) ? (ef[i]-es[i]) : null);
  const signal=ema(hist.map(v=>v??0), sig); return { macd: hist, signal, histo: hist.map((v,i)=> (v!=null && signal[i]!=null) ? v - signal[i] : null) }; }

/* ---------- signal logic ---------- */
function lastCross(closes){ // EMA9/EMA21 cross gần nhất trong 30 nến
  const e9=ema(closes,9), e21=ema(closes,21);
  for(let i=closes.length-1;i>=closes.length-30;i--){
    if(i<=0||e9[i-1]==null||e21[i-1]==null) continue;
    const prev=e9[i-1]-e21[i-1], now=e9[i]-e21[i];
    if(prev<=0 && now>0) return {dir:"BUY", idx:i};
    if(prev>=0 && now<0) return {dir:"SELL",idx:i};
  }
  return null;
}

/* ---------- confidence scoring ---------- */
function confidence(bars, closes){
  const e50=ema(closes,50), e200=ema(closes,200);
  const m=macd(closes), r=rsi(closes), bbands=bb(closes), s=stoch(bars);
  const last=closes.length-1;

  let score=0, total=7;

  // Trend EMA50 / EMA200 (2)
  if (closes[last]>e50[last]) score++; else score--;
  if (closes[last]>e200[last]) score++; else score--;

  // MACD histogram (1)
  if ((m.histo[last]||0) > 0) score++; else score--;

  // RSI zone (1)
  if (r[last]>=55) score++; else if (r[last]<=45) score--; // trung tính không cộng

  // Stoch (1)
  if ((s.k[last]||0) > (s.d[last]||0)) score++; else score--;

  // Bollinger vị trí (1)
  if (bbands[last] && closes[last] >= bbands[last].mid) score++; else score--;

  // Volume ratio (1) — giản lược: so sánh range nến hiện tại vs SMA(range)
  const ranges = bars.map(b => b.h - b.l), rngSma = sma(ranges, 20), ratio = (ranges[last]||0)/((rngSma[last]||1));
  if (ratio >= 1) score++; // >1 coi như hoạt động “khá”

  // convert to %
  const conf = Math.max(0, Math.min(1, (score + total) / (2*total))) * 100; // scale 0..100
  return { conf: Math.round(conf), rsi:r[last], macd:m, bb:bbands[last], stoch:{k:s.k[last], d:s.d[last]}, e50:e50[last], e200:e200[last], volRatio:ratio };
}

/* ---------- card builder ---------- */
function buildCard(sym, data){
  const el = document.createElement('div');
  el.className = 'card';

  const signCls = data.dir==="BUY" ? "buy" : "sell";
  const pnlPct = (data.current - data.entry) / data.entry * (data.dir==="BUY"?1:-1); // long dương, short dương khi có lời
  const pnlUSD = (RISK.positionUSD * RISK.leverage) * pnlPct;

  el.innerHTML = `
    <div class="row head">
      <div class="coin">
        <div class="badge">${sym.replace('USDT','')}</div>
        <div class="${signCls}" style="font-weight:800">${data.dir}</div>
        <span class="chip">m15</span>
        <span class="chip">Conf: ${data.conf}%</span>
        <span class="chip">R/R: ${fmt(data.rr,2)}</span>
        <span class="chip">100U × 25x</span>
      </div>
      <div class="muted">${new Date(data.now*1000).toLocaleString()}</div>
    </div>

    <div class="stat">
      <div class="box">
        <small>ENTRY</small>
        <div>$${fmt(data.entry,2)}</div>
      </div>
      <div class="box">
        <small>CURRENT</small>
        <div>$${fmt(data.current,2)}</div>
      </div>
      <div class="box">
        <small>TIME</small>
        <div>${data.elapsed}</div>
      </div>
      <div class="box ${pnlPct>=0?'buy':'sell'}">
        <small>P&L %</small>
        <div>${pct(pnlPct)}</div>
      </div>
      <div class="box ${pnlPct>=0?'buy':'sell'}">
        <small>PROFIT (25x)</small>
        <div>$${fmt(pnlUSD,2)}</div>
      </div>
      <div class="box">
        <small>STATUS</small>
        <div class="chip" style="background:#1d4ed8;border-color:#60a5fa">ACTIVE</div>
      </div>
    </div>

    <div class="footer">
      <div class="tps">
        <div class="tp">🔻 SL $${fmt(data.sl,2)}</div>
        <div class="tp">⏳ ${data.left} left</div>
        <div class="tp">TP1 • $${fmt(data.tp1,2)}</div>
        <div class="tp">TP2 • $${fmt(data.tp2,2)}</div>
        <div class="tp">TP3 • $${fmt(data.tp3,2)}</div>
      </div>
      <button class="btn-details">Details</button>
    </div>

    <details>
      <summary>AI Analyst — Summary</summary>
      <div class="muted" style="margin:10px 0 6px 0">${data.summary}</div>
      <table class="tbl">
        <tr><td>EMA</td><td class="right">EMA12: ${fmt(data.ema12,2)} | EMA26: ${fmt(data.ema26,2)} | EMA50: ${fmt(data.e50,2)} | EMA200: ${fmt(data.e200,2)}</td></tr>
        <tr><td>RSI</td><td class="right">${fmt(data.rsi,2)}</td></tr>
        <tr><td>MACD</td><td class="right">MACD: ${fmt(data.macd,4)} | Signal: ${fmt(data.macdSig,4)} | Histogram: ${fmt(data.macdHist,4)}</td></tr>
        <tr><td>SMA20</td><td class="right">${fmt(data.sma20,2)}</td></tr>
        <tr><td>STOCH</td><td class="right">K: ${fmt(data.stochK,2)} | D: ${fmt(data.stochD,2)}</td></tr>
        <tr><td>VOLUME</td><td class="right">Ratio: ${fmt(data.volRatio,2)} | Trend: ${data.volRatio>=1?'ACTIVE':'LOW'}</td></tr>
        <tr><td>KEYLEVELS</td><td class="right">Support: ${fmt(data.support,2)} | Resistance: ${fmt(data.resist,2)} | Breakout: ${fmt(data.breakout,2)}</td></tr>
      </table>
    </details>
  `;
  return el;
}

/* ---------- main ---------- */
export async function renderM15(){
  const root = document.getElementById('cards');
  const status = document.getElementById('status');
  root.innerHTML = ""; status.textContent = "Loading…";

  for(const sym of SYMS){
    try{
      const bars = await fetchM15(sym);
      const now = bars.at(-1).t;
      const closes = bars.map(b=>b.c);

      const cross = lastCross(closes);
      if(!cross){ // không có tín hiệu mới
        const el=document.createElement('div');
        el.className='card';
        el.innerHTML=`<div class="muted">${sym}: No recent EMA(9/21) cross found.</div>`;
        root.appendChild(el);
        continue;
      }

      const idx = cross.idx, dir=cross.dir;
      const entry = bars[idx].c;
      const current = bars.at(-1).c;
      const atr14 = atr(bars,14).at(-1);
      const sl = dir==="BUY" ? entry - atr14 : entry + atr14;

      // targets
      const tp1 = dir==="BUY" ? entry*(1+0.006) : entry*(1-0.006);
      const tp2 = dir==="BUY" ? entry*(1+0.010) : entry*(1-0.010);
      const tp3 = dir==="BUY" ? entry*(1+0.014) : entry*(1-0.014);

      // indicators for details
      const e12 = ema(closes,12).at(-1), e26 = ema(closes,26).at(-1);
      const e50 = ema(closes,50).at(-1), e200 = ema(closes,200).at(-1);
      const m = macd(closes);
      const r = rsi(closes).at(-1);
      const k = stoch(bars); const kLast=k.k.at(-1), dLast=k.d.at(-1);
      const bb20 = bb(closes).at(-1);
      const s20 = sma(closes,20).at(-1);

      // confidence
      const confObj = confidence(bars, closes);

      // RR (khoảng cách tới TP2 so với SL)
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp2 - entry);
      const rr = reward / (risk||1);

      // time info
      const sinceSec = Math.max(0, bars.at(-1).t - bars[idx].t);
      const leftSec = Math.max(0, 4*3600 - sinceSec); // 4h expiry
      const human = (secs)=>`${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m left`;
      const elapsed = `${Math.floor(sinceSec/60)}m`;
      const left = human(leftSec);

      // summary (rút gọn)
      const bull = dir==="BUY";
      const summary =
        `Step 1: ${bull?'Bullish':'Bearish'} EMA cross detected at $${fmt(entry)}. ` +
        `Step 2: ${bb20 ? `Price ${closes.at(-1) >= bb20.mid ? 'above' : 'near'} BB mid` : 'BB flat'}. ` +
        `Step 3: Trend ${current>e50?'STRONG_BULL':'MIXED'}, EMA50 ${fmt(e50)} / EMA200 ${fmt(e200)}. ` +
        `Step 4: RSI ${fmt(r)} ${r<40?'oversold':''}${r>60?' overbought':''}. ` +
        `Step 5: MACD histogram ${fmt(m.histo.at(-1),4)} ${m.histo.at(-1)>0?'bullish':'bearish'}. ` +
        `Step 6: Volume ratio ${fmt(confObj.volRatio,2)} ` +
        `→ Bias ${bull?'buy dips':'sell rallies'}.`;

      const card = buildCard(sym, {
        dir, entry, current,
        sl, tp1, tp2, tp3,
        rr,
        now,
        elapsed,
        left,
        conf: confObj.conf,
        ema12:e12, ema26:e26, e50, e200,
        rsi:r, macd:m.macd.at(-1), macdSig:m.signal.at(-1), macdHist:m.histo.at(-1),
        sma20:s20, stochK:kLast, stochD:dLast,
        support: bb20?.low, resist: bb20?.up, breakout: bb20?.mid,
        volRatio: confObj.volRatio,
        summary
      });
      root.appendChild(card);
    }catch(e){
      const err=document.createElement('div');
      err.className='card';
      err.innerHTML=`<div class="muted">${sym}: ${e.message}</div>`;
      root.appendChild(err);
      console.error(e);
    }
  }

  status.textContent = "Done • Data: CryptoCompare • m15 only";
}

/* ------------- config fallback (nếu bạn chưa có) ------------- */
if (!RISK) {
  // đề phòng thiếu config.js
  console.warn("config.js RISK missing → use default");
  // eslint-disable-next-line no-global-assign
  RISK = { positionUSD: 100, leverage: 25 };
}
