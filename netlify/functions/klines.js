// Bybit v5 Market Kline (linear perpetual) — BTCUSDT / ETHUSDT
const ALLOWED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
// app dùng 15m, 1h, 4h
const MAP_INTERVAL = { '15m': '15', '1h': '60', '4h': '240' };

exports.handler = async (event) => {
  try {
    const p = event.queryStringParameters || {};
    const symbol = p.symbol;
    const tf = p.interval || '15m';
    const limit = Math.min(parseInt(p.limit || '500', 10), 1000);

    if (!ALLOWED_SYMBOLS.has(symbol)) return { statusCode: 400, body: 'symbol not allowed' };
    if (!MAP_INTERVAL[tf]) return { statusCode: 400, body: 'interval not allowed' };

    // Bybit returns newest-first; we'll reverse to oldest-first
    const interval = MAP_INTERVAL[tf];
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const r = await fetch(url);
    if (!r.ok) return { statusCode: r.status, body: await r.text() };

    const j = await r.json();
    if (j.retCode !== 0) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) };
    }

    // j.result.list: [["start","open","high","low","close","volume","turnover"], ...] newest first
    const list = (j.result?.list || []).slice().reverse();

    // Trả về cùng format với Binance (để frontend không cần đổi):
    // [ openTime(ms), open, high, low, close, ... ]
    const out = list.map(row => [
      Number(row[0]),        // open time ms
      row[1],                // open
      row[2],                // high
      row[3],                // low
      row[4],                // close
    ]);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, body: e.message || 'error' };
  }
};
