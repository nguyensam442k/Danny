import { INDICATORS, RISK } from "./config.js";

export function initUI(){
  // thêm khu vực Stats nếu chưa có
  let side = document.querySelector(".side .box");
  if(side && !document.getElementById("stats")){
    const wrap = document.createElement("div");
    wrap.id = "stats";
    wrap.innerHTML = `
      <h3>Stats (MVP)</h3>
      <div id="stats-body" style="font-size:13px;line-height:1.5">
        Chưa có dữ liệu.
      </div>
      <hr/>
      <div style="font-size:12px;color:#6b7280">
        EMA ${INDICATORS.emaFast}/${INDICATORS.emaSlow}, SMA ${INDICATORS.sma}.
        Risk: $${RISK.positionUSD} x${RISK.leverage}, TP ${RISK.tp_pct*100}% / SL ${RISK.sl_pct*100}%.
      </div>
    `;
    side.appendChild(wrap);
  }
}

export function renderStats(stats){
  const el = document.getElementById("stats-body");
  if(!el) return;
  const {
    trades, wins, losses, winrate, pnlUSD, avgRR
  } = stats;
  el.innerHTML = `
    Trades: <b>${trades}</b><br/>
    Wins / Losses: <b>${wins}</b> / <b>${losses}</b><br/>
    Win rate: <b>${(winrate*100).toFixed(1)}%</b><br/>
    PnL (USD, no fee): <b>${pnlUSD.toFixed(2)}</b><br/>
    Avg R:R: <b>${avgRR.toFixed(2)}</b>
  `;
}
