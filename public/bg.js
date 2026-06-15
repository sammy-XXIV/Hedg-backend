(function () {
  const canvas = document.getElementById('btc-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const LINE_COLOR  = '#3B8EFF';
  const FILL_COLOR  = 'rgba(59,142,255,0.06)';
  const GRID_COLOR  = 'rgba(26,37,64,0.6)';
  const DOT_COLOR   = '#3B8EFF';

  let prices = [];
  const MAX_TICKS = 20;

  const lowEl    = document.getElementById('chart-low');
  const highEl   = document.getElementById('chart-high');
  const changeEl = document.getElementById('chart-change');

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = 120;
    draw();
  }

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (prices.length < 2) {
      ctx.font = '10px JetBrains Mono';
      ctx.fillStyle = '#3A4A6B';
      ctx.textAlign = 'center';
      ctx.fillText('AWAITING PRICE DATA', W / 2, H / 2);
      return;
    }

    const PAD = { top: 14, bottom: 14, left: 8, right: 8 };
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    // Scale price to canvas Y (inverted — higher price = lower Y)
    const scaleY = p => PAD.top + (1 - (p - min) / range) * (H - PAD.top - PAD.bottom);
    const scaleX = i => PAD.left + (i / (prices.length - 1)) * (W - PAD.left - PAD.right);

    // Draw subtle internal grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = PAD.top + (i / 4) * (H - PAD.top - PAD.bottom);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Build path
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = scaleX(i);
      const y = scaleY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    // Fill under line
    const fillPath = new Path2D(ctx.currentPath);
    ctx.save();
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = scaleX(i);
      const y = scaleY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(scaleX(prices.length - 1), H);
    ctx.lineTo(scaleX(0), H);
    ctx.closePath();
    ctx.fillStyle = FILL_COLOR;
    ctx.fill();
    ctx.restore();

    // Draw line
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = scaleX(i);
      const y = scaleY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw latest price dot
    const lastX = scaleX(prices.length - 1);
    const lastY = scaleY(prices[prices.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = DOT_COLOR;
    ctx.fill();

    // Outer glow ring on dot
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59,142,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Update stats
    const first = prices[0];
    const last  = prices[prices.length - 1];
    const chg   = ((last - first) / first * 100).toFixed(2);
    const sign  = chg >= 0 ? '+' : '';
    if (lowEl)    lowEl.textContent    = `LOW $${min.toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}`;
    if (highEl)   highEl.textContent   = `HIGH $${max.toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}`;
    if (changeEl) {
      changeEl.textContent = `CHANGE ${sign}${chg}%`;
      changeEl.style.color = chg >= 0 ? '#00C48C' : '#FF4D4D';
    }
  }

  async function fetchPrice() {
    try {
      const r = await fetch('/api/price');
      const d = await r.json();
      if (d.spot && d.spot > 0) {
        prices.push(d.spot);
        if (prices.length > MAX_TICKS) prices.shift();
        draw();
      }
    } catch {}
  }

  window.addEventListener('resize', resize);
  resize();
  fetchPrice();
  setInterval(fetchPrice, 15_000);
})();
