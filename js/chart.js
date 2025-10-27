import { TF_TO_BINANCE } from './config.js';

async function fetchKlines({ symbol, timeframe, limit = 500 }) {
  const interval = TF_TO_BINANCE[timeframe] || '15m';
  const url = `/.netlify/functions/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if(!res.ok){ throw new Error(await res.text()); }
  const data = await res.json();
  return data.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4],
  }));
}

export async function loadAndRenderChart({ symbol, timeframe }) {
  const container = document.getElementById('chart');
  container.innerHTML = '';
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#222' },
    grid: { vertLines: { color: '#eee' }, horzLines: { color: '#eee' } },
    timeScale: { borderColor: '#d1d5db' },
    rightPriceScale: { borderColor: '#d1d5db' },
  });
  const candleSeries = chart.addCandlestickSeries();
  const bars = await fetchKlines({ symbol, timeframe, limit: 1000 });
  candleSeries.setData(bars);

  const note = document.createElement('div');
  note.style.position='absolute'; note.style.top='8px'; note.style.left='16px';
  note.style.padding='4px 8px'; note.style.background='rgba(0,0,0,0.6)';
  note.style.color='#fff'; note.style.borderRadius='6px'; note.style.fontSize='12px';
  note.textContent = `${symbol} • ${timeframe} • Binance Futures`;
  container.appendChild(note);
}
