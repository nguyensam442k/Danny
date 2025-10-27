import { RISK } from "./config.js";

/* ========== CONFIG ========== */
const SYMS = ["BTCUSDT","ETHUSDT"];
const CC = "https://min-api.cryptocompare.com/data/v2";
const POSITION_USD = (RISK?.positionUSD ?? 100);
const LEVER = (RISK?.leverage ?? 25);

/* ========== UTILS ========== */
const fmt = (x, d=2) => (typeof x === "number" ? x.toFixed(d) : x);
const pct = (p) => (p>0?`+${(p*100).toFixed(2)}%`:`${(p*100).toFixed(2)}%`);

async function fetchM15(symbol, limit=500){
  const fsym = symbol.startsWith("BTC") ? "BTC" : "ETH";
  const url = `${CC}/histominute?fsym=${fsym}&tsym=USDT&limit=${limit}&aggregate=15&e=Binance`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (j.Response !== "Success") throw new Error(j.Message || "cc error");
  return j.Data.Data.map(b=>({t:b.time,o:b.open,h:b.high,l:b.low,c:b.close}));
}

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
  const mac=vals.map((_,i)=> (ef[i]&&es[i]) ? (ef[i]-es[i]) : null);
  const signal=ema(mac.map(v=>v??0), sig); const hist=mac.map((v,i)=> (v!=null && signal[i]!=null) ? v - signal[i] : null);
  return { macd: mac, signal, histo: hist }; }

/* ---------- detect last cross ---------- */
function lastCross(closes){
  const e9=ema(closes,9), e21=ema(closes,21);
  for(let i=closes.length-1;i>=closes.length-30;i--){
    if(i<=0||e9[i-1]==null||e21[i-1]==null) continue;
    const prev=e9[i-1]-e21[i-1], now=e9[i]-e21[i];
    if(prev<=0 && now>0) return {dir:"BUY", idx:i};
    if(prev>=0 && now<0) return {dir:"SELL",idx:i};
  }
  return null;
}

/* ---------- confidence scoring (y như trước) ---------- */
function confidence(bars, closes){
  const e50=ema(closes,50), e200=ema(closes,200);
  const m=macd(closes), r=rsi(closes), bbands=bb(closes), s=stoch(bars);
  const last=closes.length-1;

  let score=0, total=7;
  if (closes[last]>e50[last]) score++; else score--;
  if (closes[last]>e200[last]) score++; else score--;
  if ((m.histo[last]||0) > 0) score++; else score--;
  if (r[last]>=55) score++; else if (r[last]<=45) score--;
  if ((s.k[last]||0) > (s.d[last]||0)) score++; else score--;
  if (bbands[last] && closes[last] >= bbands[last].mid) score++; else score--;
  const ranges = bars.map(b => b.h - b.l), rngSma = sma(ranges, 20), ratio = (ranges[last]||0)/((rngSma[last]||1));
  if (ratio >= 1) score++;

  const conf = Math.max(0, Math.min(1, (score + total) / (2*total))) * 100;
  return { conf: Math.round(conf), volRatio: ratio, e50:e50[last], e200:e200[last], rsi:r[last],
           macd: m, bb: bbands[last], stoch:{k:s.k[last], d:s.d[last]} };
}

/* ---------- build UI card ---------- */
function buildCard(sym, data){
  const el = document.createElement('div');
  el.className = 'card';

  const signCls = data.dir==="BUY" ? "buy" : "sell";
  const pnlPct = (data.current - data.entry) / data.entry * (data.dir==="BUY"?1:-1);
  const pnlUSD = (POSITION_USD * LEVER) * pnlPct;

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
      <div class="box"><small>ENTRY</small><div>$${fmt(data.entry,2)}</div></div>
      <div class="box"><small>CURRENT</small><div>$${fmt(data.current,2)}</div></div>
      <div class="box"><small>TIME</small><div>15m</div></div>
      <div class="box ${pnlPct>=0?'buy':'sell'}"><small>P&L %</small><div>${pct(pnlPct)}</div></div>
      <div class="box ${pnlPct>=0?'buy':'sell'}"><small>PROFIT (25x)</small><div>$${fmt(pnlUSD,2)}</div></div>
      <div class="box"><small>STATUS</small><div class="chip" style="background:#1d4ed8;border-color:#60a5fa">ACTIVE</div></div>
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

/* ---------- backtest: thống kê thắng/thua ---------- */
function firstHit(dir, bars, entry, sl, tp, startIdx, maxSteps){
  // trả về "win" | "loss" | "flat"
  for(let k=1; k<=maxSteps && startIdx+k < bars.length; k++){
    const b = bars[startIdx+k];
    if(dir==="BUY"){
      // nếu nến có cả chạm SL lẫn TP, ưu tiên SL trước (bảo thủ)
      if(b.l <= sl) return "loss";
      if(b.h >= tp) return "win";
    } else {
      if(b.h >= sl) return "loss";
      if(b.l <= tp) return "win";
    }
  }
  return "flat";
}

function backtestSymbol(sym, bars){
  const closes = bars.map(b=>b.c);
  const e9 = ema(closes,9), e21 = ema(closes,21);
  const atr14 = atr(bars,14);
  const out = { sym, trades:0, win:0, loss:0, flat:0, pnlUSD:0 };

  // quét toàn bộ cross, bỏ vùng seed
  for(let i=30; i<bars.length-20; i++){
    if(e9[i-1]==null || e21[i-1]==null) continue;
    const prev = e9[i-1]-e21[i-1], now = e9[i]-e21[i];
    let dir = null;
    if(prev<=0 && now>0) dir="BUY";
    if(prev>=0 && now<0) dir="SELL";
    if(!dir) continue;

    const entry = bars[i].c;
    const atr = atr14[i] ?? 0;
    const sl = dir==="BUY" ? entry - atr : entry + atr;
    const tp = dir==="BUY" ? entry*(1+0.010) : entry*(1-0.010); // TP2 1.0%
    const res = firstHit(dir, bars, entry, sl, tp, i, 16); // 16 nến = 4h

    const notional = POSITION_USD * LEVER;
    if(res==="win"){
      out.win++; out.trades++;
      out.pnlUSD += notional * (Math.abs(tp-entry)/entry);
    }else if(res==="loss"){
      out.loss++; out.trades++;
      out.pnlUSD -= notional * (Math.abs(entry-sl)/entry);
    }else{
      out.flat++; out.trades++;
      // flat = 0$
    }
  }
  return out;
}

function renderSummary(perSym){
  const tbl = document.getElementById('sum-table');
  const note = document.getElementById('sum-note');

  const total = perSym.reduce((a,b)=>({
    trades:a.trades+b.trades, win:a.win+b.win, loss:a.loss+b.loss, flat:a.flat+b.flat, pnlUSD:a.pnlUSD+b.pnlUSD
  }), {trades:0,win:0,loss:0,flat:0,pnlUSD:0});

  const row = (r,name)=> {
    const wr = r.trades ? (r.win/r.trades*100).toFixed(1) : "0.0";
    const pnlCls = r.pnlUSD>=0 ? "green":"red";
    return `<tr>
      <td><b>${name}</b></td>
      <td>${r.trades}</td>
      <td class="green">${r.win}</td>
      <td class="red">${r.loss}</td>
      <td>${r.flat}</td>
      <td>${wr}%</td>
      <td class="${pnlCls}">$${fmt(r.pnlUSD,2)}</td>
    </tr>`;
  };

  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Symbol</th><th>Trades</th><th>Win</th><th>Loss</th><th>Flat</th><th>Win-rate</th><th>P&amp;L ($)</th>
      </tr>
    </thead>
    <tbody>
      ${perSym.map(s=>row(s, s.sym.replace('USDT',''))).join('')}
      <tr><td colspan="7" style="border-bottom:none"></td></tr>
      ${row(total, "TOTAL")}
    </tbody>
  `;
  note.textContent = "Backtest ~500 nến m15 / mỗi cặp";
}

/* ---------- main render ---------- */
export async function renderM15(){
  const root = document.getElementById('cards');
  const status = document.getElementById('status');
  root.innerHTML = ""; status.textContent = "Loading…";

  const perSymStats = [];

  for(const sym of SYMS){
    try{
      const bars = await fetchM15(sym);
      const now = bars.at(-1).t;
      const closes = bars.map(b=>b.c);

      // ---- card hiện tại ----
      const cross = lastCross(closes);
      if(cross){
        const idx=cross.idx, dir=cross.dir;
        const entry=bars[idx].c, current=bars.at(-1).c;
        const atr14 = atr(bars,14).at(-1);
        const sl = dir==="BUY" ? entry-atr14 : entry+atr14;
        const tp1 = dir==="BUY" ? entry*(1+0.006) : entry*(1-0.006);
        const tp2 = dir==="BUY" ? entry*(1+0.010) : entry*(1-0.010);
        const tp3 = dir==="BUY" ? entry*(1+0.014) : entry*(1-0.014);

        const e12 = ema(closes,12).at(-1), e26 = ema(closes,26).at(-1);
        const e50 = ema(closes,50).at(-1), e200 = ema(closes,200).at(-1);
        const m = macd(closes);
        const r = rsi(closes).at(-1);
        const k = stoch(bars); const kLast=k.k.at(-1), dLast=k.d.at(-1);
        const bb20 = bb(closes).at(-1);
        const s20 = sma(closes,20).at(-1);

        const confObj = confidence(bars, closes);
        const risk = Math.abs(entry - sl);
        const reward = Math.abs(tp2 - entry);
        const rr = reward / (risk||1);

        const sinceSec = Math.max(0, bars.at(-1).t - bars[idx].t);
        const leftSec = Math.max(0, 4*3600 - sinceSec);
        const human = (secs)=>`${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
        const left = human(leftSec);

        const bull = dir==="BUY";
        const summary =
          `Step 1: ${bull?'Bullish':'Bearish'} EMA cross at $${fmt(entry)}. ` +
          `Step 2: ${bb20 ? `Price ${closes.at(-1) >= bb20.mid ? 'above' : 'near'} BB mid` : 'BB flat'}. ` +
          `Step 3: Trend ${current>e50?'STRONG_BULL':'MIXED'}, EMA50 ${fmt(e50)} / EMA200 ${fmt(e200)}. ` +
          `Step 4: RSI ${fmt(r)}. Step 5: MACD hist ${fmt(m.histo.at(-1),4)}. ` +
          `Step 6: Volume ratio ${fmt(confObj.volRatio,2)}.`;

        const card = buildCard(sym, {
          dir, entry, current,
          sl, tp1, tp2, tp3,
          rr,
          now,
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
      }else{
        const div=document.createElement('div');
        div.className='card';
        div.innerHTML=`<div class="muted">${sym}: No recent EMA(9/21) cross found.</div>`;
        root.appendChild(div);
      }

      // ---- thống kê ----
      const st = backtestSymbol(sym, bars);
      perSymStats.push(st);

    }catch(e){
      const err=document.createElement('div');
      err.className='card';
      err.innerHTML=`<div class="muted">${sym}: ${e.message}</div>`;
      root.appendChild(err);
      console.error(e);
    }
  }

  renderSummary(perSymStats);
  status.textContent = "Done • Data: CryptoCompare • m15 only";
}
