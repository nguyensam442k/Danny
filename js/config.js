// ====== CONFIG ======
export const SYMBOLS = ["BTCUSDT","ETHUSDT"];
export const TIMEFRAMES = ["15m","1h","4h"];
export const TF_TO_BINANCE = { "15m": "15m", "1h": "1h", "4h": "4h" };

// Tham số backtest cơ bản (không tính phí)
export const RISK = {
  positionUSD: 100,   // mỗi lệnh 100u
  leverage: 25,       // x25
  tp_pct: 0.01,       // TP 1%
  sl_pct: 0.005,      // SL 0.5%
};

// EMA/SMA
export const INDICATORS = {
  emaFast: 9,
  emaSlow: 21,
  sma: 50,
};
