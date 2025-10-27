// Netlify Function (CommonJS) — proxy Binance Futures klines for BTCUSDT/ETHUSDT only
const ALLOWED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
const ALLOWED_TF = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d']);

exports.handler = async (event) => {
  try {
    const p = event.queryStringParameters || {};
    const symbol = p.symbol;
    const interval = p.interval || '15m';
    const limit = Math.min(parseInt(p.limit || '500', 10), 1000);

    if (!ALLOWED_SYMBOLS.has(symbol)) return { statusCode: 400, body: 'symbol not allowed' };
    if (!ALLOWED_TF.has(interval)) return { statusCode: 400, body: 'interval not allowed' };

    const endpoint = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await fetch(endpoint);
    if (!r.ok) return { statusCode: r.status, body: await r.text() };
    const data = await r.json();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, body: e.message || 'error' };
  }
};
