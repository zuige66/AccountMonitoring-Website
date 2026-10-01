// The one-day chart uses transaction-level points and a focused Y range so
// small intraday changes remain visible instead of being flattened by zero.
renderChart = function renderAdaptiveChart() {
  const series = visible();
  const first = Number(series[0]?.pnl || 0);
  const last = Number(series.at(-1)?.pnl || 0);
  const change = last - first;
  $('#periodPnl').textContent = money(change, true);
  $('#periodPnl').className = cls(change);
  $('#periodRate').textContent = `${change >= 0 ? '↗' : '↘'} ${Math.abs(change / (Math.abs(first) || 100) * 100).toFixed(2)}%`;

  const canvas = $('#pnlChart');
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  const pad = 12;
  if (!series.length) return;

  const values = series.map(point => Number(point.pnl));
  // Tight Y range for every period so the curve always spans most of the
  // frame height instead of being flattened by a forced zero baseline.
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const yPadding = span > 0 ? span * .15 : Math.max(Math.abs(high) * .08, .5);
  const min = low - yPadding;
  const max = high + yPadding;

  const pointX = index => pad + index * (width - pad * 2) / Math.max(1, series.length - 1);
  const pointY = value => height - pad - (value - min) / (max - min || 1) * (height - pad * 2);
  ctx.strokeStyle = '#ebe8ef';
  ctx.lineWidth = 1;
  for (let index = 1; index < 5; index++) {
    const y = index * height / 5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(101,85,143,.25)');
  gradient.addColorStop(1, 'rgba(101,85,143,0)');
  ctx.beginPath();
  series.forEach((point, index) => index ? ctx.lineTo(pointX(index), pointY(point.pnl)) : ctx.moveTo(pointX(index), pointY(point.pnl)));
  ctx.lineTo(pointX(series.length - 1), height);
  ctx.lineTo(pointX(0), height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  series.forEach((point, index) => index ? ctx.lineTo(pointX(index), pointY(point.pnl)) : ctx.moveTo(pointX(index), pointY(point.pnl)));
  ctx.strokeStyle = '#65558f';
  ctx.lineWidth = days === 1 ? 3 : 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  canvas.onmousemove = event => {
    const index = Math.round((event.offsetX - pad) / (width - pad * 2) * (series.length - 1));
    const point = series[Math.max(0, Math.min(series.length - 1, index))];
    const tooltip = $('#tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(event.offsetX + 10, width - 125)}px`;
    tooltip.style.top = `${Math.max(5, event.offsetY - 35)}px`;
    const date = new Date(point.time);
    const label = days === 1
      ? date.toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false})
      : date.toLocaleDateString('zh-CN');
    tooltip.textContent = `${label} · ${money(point.pnl, true)}`;
  };
  canvas.onmouseleave = () => $('#tooltip').style.display = 'none';
};
