/* js/journal.js
   Lưu/đọc journal lệnh (localStorage), đóng lệnh theo TP/SL/EXP, thống kê.
   Không phụ thuộc phần còn lại của app – chỉ cần truyền vào giá & tín hiệu.
*/
const JKEY = 'journal_v1';

// ---------- Storage ----------
export function loadJournal() {
  try { return JSON.parse(localStorage.getItem(JKEY) || '[]'); }
  catch { return []; }
}
export function saveJournal(arr) {
  localStorage.setItem(JKEY, JSON.stringify(arr));
}

// ---------- Helpers ----------
export function makeTradeId(sym, barISO) {
  // dùng sym + timestamp cây nến/tín hiệu để không bị trùng khi refresh
  return `${sym}-${barISO}`;
}

export function calcPnlUSD({ dir, entry, exitPx, sizeU, lev }) {
  const chg = (exitPx - entry) / entry;     // tỉ lệ
  const gross = sizeU * lev * chg;          // USD
  return dir === 'BUY' ? gross : -gross;    // SELL ngược dấu
}

/** Cập nhật trạng thái 1 lệnh sau khi có lastPrice */
export function tryCloseTrade(t, lastPrice) {
  if (t.status !== 'ACTIVE') return t;
  const now = Date.now();

  if (t.dir === 'BUY') {
    if (lastPrice >= t.tp) {
      const pnl = calcPnlUSD({ dir:t.dir, entry:t.entry, exitPx:t.tp, sizeU:t.sizeU, lev:t.lev });
      return { ...t, status:'TP', exitPx:t.tp, exitAt:now, reason:'TP', pnl };
    }
    if (lastPrice <= t.sl) {
      const pnl = calcPnlUSD({ dir:t.dir, entry:t.entry, exitPx:t.sl, sizeU:t.sizeU, lev:t.lev });
      return { ...t, status:'SL', exitPx:t.sl, exitAt:now, reason:'SL', pnl };
    }
  } else { // SELL
    if (lastPrice <= t.tp) {
      const pnl = calcPnlUSD({ dir:t.dir, entry:t.entry, exitPx:t.tp, sizeU:t.sizeU, lev:t.lev });
      return { ...t, status:'TP', exitPx:t.tp, exitAt:now, reason:'TP', pnl };
    }
    if (lastPrice >= t.sl) {
      const pnl = calcPnlUSD({ dir:t.dir, entry:t.entry, exitPx:t.sl, sizeU:t.sizeU, lev:t.lev });
      return { ...t, status:'SL', exitPx:t.sl, exitAt:now, reason:'SL', pnl };
    }
  }

  if (now >= t.expireAt) {
    return { ...t, status:'EXP', exitPx:lastPrice, exitAt:now, reason:'EXP', pnl:0 };
  }
  return t;
}

// ---------- Public API để UI gọi ----------

/** Ghi 1 lệnh mới (nếu chưa tồn tại id) */
export function addTrade(t) {
  const j = loadJournal();
  if (!j.some(x => x.id === t.id)) {
    j.push(t);
    saveJournal(j);
  }
}

/** Truyền toàn bộ giá hiện tại { BTC: 115xxx, ETH: 41xx } để auto đóng lệnh */
export function updateLiveTrades(prices) {
  const j = loadJournal().map(t => {
    const p = prices[t.sym];
    return p ? tryCloseTrade(t, p) : t;
  });
  saveJournal(j);
}

/** Tổng hợp thống kê từ các lệnh đã kết thúc */
export function summaryFromJournal(journal) {
  const SYMS = ['BTC','ETH'];
  const perSym = SYMS.map(sym => {
    const arr = journal.filter(x => x.sym === sym && ['TP','SL','EXP','CANCELLED'].includes(x.status));
    const win = arr.filter(x => x.status === 'TP').length;
    const loss = arr.filter(x => x.status === 'SL').length;
    const flat = arr.filter(x => x.status === 'EXP' || x.status === 'CANCELLED').length;
    const pnl  = arr.reduce((s,x) => s + (x.pnl || 0), 0);
    const trades = arr.length;
    const wr = trades ? win / trades : 0;
    return { sym, trades, win, loss, flat, wr, pnl };
  });

  const total = perSym.reduce((t,c) => ({
    sym: 'TOTAL',
    trades: t.trades + c.trades,
    win: t.win + c.win,
    loss: t.loss + c.loss,
    flat: t.flat + c.flat,
    pnl: t.pnl + c.pnl,
    wr: 0
  }), { sym:'TOTAL', trades:0, win:0, loss:0, flat:0, pnl:0, wr:0 });
  total.wr = total.trades ? total.win/total.trades : 0;

  return { perSym, total };
}

/** Tiện ích render bảng Summary & History (nếu bạn muốn gọi thẳng ở UI) */
export function renderSummaryTable(rootSel = '#summary-live') {
  const root = document.querySelector(rootSel);
  if (!root) return;
  const j = loadJournal();
  const { perSym, total } = summaryFromJournal(j);
  const rows = [...perSym, total];

  root.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Symbol</th><th>Trades</th><th>Win</th><th>Loss</th><th>Flat</th>
          <th>Win-rate</th><th>P&amp;L ($)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.sym}</td>
            <td>${r.trades}</td>
            <td class="${r.win>0?'green':''}">${r.win}</td>
            <td class="${r.loss>0?'red':''}">${r.loss}</td>
            <td>${r.flat}</td>
            <td>${(r.wr*100).toFixed(1)}%</td>
            <td class="${r.pnl>=0?'green':'red'}">${fmtUSD(r.pnl)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

export function renderHistoryTable(rootSel = '#hist-table') {
  const tb = document.querySelector(rootSel + ' tbody');
  if (!tb) return;
  const j = loadJournal()
    .filter(x => x.status !== 'ACTIVE')
    .sort((a,b) => (b.exitAt||0) - (a.exitAt||0));

  tb.innerHTML = j.map(x => `
    <tr>
      <td>${x.exitAt ? new Date(x.exitAt).toLocaleString() : ''}</td>
      <td>${x.sym}</td>
      <td>${x.dir}</td>
      <td>${fmt(x.entry)}</td>
      <td>${fmt(x.tp)}</td>
      <td>${fmt(x.sl)}</td>
      <td>${fmt(x.exitPx)}</td>
      <td>${x.reason||''}</td>
      <td>${x.status}</td>
      <td class="${x.pnl>=0?'green':'red'}">${fmtUSD(x.pnl)}</td>
    </tr>
  `).join('');
}

export function clearFinishedTrades() {
  const keep = loadJournal().filter(x => x.status === 'ACTIVE');
  saveJournal(keep);
}

function fmt(n){ return n==null?'':Number(n).toLocaleString(); }
function fmtUSD(n){ return (n>=0?'+':'-') + '$' + Math.abs(n).toFixed(2); }
