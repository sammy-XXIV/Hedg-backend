(function () {
  const canvas = document.getElementById('btc-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const LINE_COLOR   = '#3B8EFF';
  const FILL_TOP     = 'rgba(59,142,255,0.14)';
  const FILL_BTM     = 'rgba(59,142,255,0)';
  const GRID_COLOR   = 'rgba(26,37,64,0.7)';
  const AXIS_COLOR   = '#3A4A6B';
  const LABEL_COLOR  = '#6B7FA3';
  const PRICE_COLOR  = '#F0F4FF';
  const CROSS_COLOR  = 'rgba(59,142,255,0.5)';

  const MAX_TICKS  = 60;
  const PAD        = { top: 16, bottom: 28, left: 8, right: 72 };

  let prices     = [];
  let timestamps = [];
  let mouseX     = null;
  let mouseY     = null;

  const lowEl    = document.getElementById('chart-low');
  const highEl   = document.getElementById('chart-high');
  const changeEl = document.getElementById('chart-change');

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = 200;
    draw();
  }

  function fmt(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;

    if (prices.length < 2) {
      ctx.font = '500 11px JetBrains Mono';
      ctx.fillStyle = AXIS_COLOR;
      ctx.textAlign = 'center';
      ctx.fillText('AWAITING PRICE DATA...', W / 2, H / 2);
      return;
    }

    const min   = Math.min(...prices);
    const max   = Math.max(...prices);
    const range = (max - min) || (min * 0.001);
    const pad   = range * 0.08;
    const lo    = min - pad;
    const hi    = max + pad;

    const scaleY = p  => PAD.top + (1 - (p - lo) / (hi - lo)) * chartH;
    const scaleX = i  => PAD.left + (i / (prices.length - 1)) * chartW;

    // ── Grid lines (horizontal) ──────────────────────────────
    const gridCount = 5;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([]);
    for (let i = 0; i <= gridCount; i++) {
      const y = PAD.top + (i / gridCount) * chartH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();

      // Y-axis price label
      const price = hi - (i / gridCount) * (hi - lo);
      ctx.font      = '400 9px JetBrains Mono';
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText('$' + fmt(price), W - PAD.right + 6, y + 3);
    }

    // ── Vertical grid lines ──────────────────────────────────
    const vCount = 6;
    for (let i = 0; i <= vCount; i++) {
      const x = PAD.left + (i / vCount) * chartW;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + chartH);
      ctx.stroke();
    }

    // ── Fill under curve ─────────────────────────────────────
    const gradient = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
    gradient.addColorStop(0, FILL_TOP);
    gradient.addColorStop(1, FILL_BTM);

    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = scaleX(i);
      const y = scaleY(p);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        // Smooth bezier through points
        const px = scaleX(i - 1);
        const py = scaleY(prices[i - 1]);
        const cpx = (px + x) / 2;
        ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
      }
    });
    ctx.lineTo(scaleX(prices.length - 1), PAD.top + chartH);
    ctx.lineTo(PAD.left, PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // ── Price line ───────────────────────────────────────────
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = scaleX(i);
      const y = scaleY(p);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const px = scaleX(i - 1);
        const py = scaleY(prices[i - 1]);
        const cpx = (px + x) / 2;
        ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
      }
    });
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);
    ctx.stroke();

    // ── Current price dashed reference line ──────────────────
    const lastPrice = prices[prices.length - 1];
    const lastY     = scaleY(lastPrice);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(59,142,255,0.3)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, lastY);
    ctx.lineTo(W - PAD.right, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Current price label (right side) ─────────────────────
    ctx.fillStyle = LINE_COLOR;
    ctx.fillRect(W - PAD.right + 1, lastY - 9, PAD.right - 2, 18);
    ctx.font      = '600 9px JetBrains Mono';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('$' + fmt(lastPrice), W - PAD.right + (PAD.right - 2) / 2 + 1, lastY + 3);

    // ── Endpoint dot ─────────────────────────────────────────
    const lastX = scaleX(prices.length - 1);
    // Glow ring
    ctx.beginPath();
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59,142,255,0.2)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    // Dot
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = LINE_COLOR;
    ctx.fill();

    // ── X-axis time labels ───────────────────────────────────
    const tStep = Math.max(1, Math.floor(timestamps.length / 6));
    ctx.font      = '400 8px JetBrains Mono';
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    timestamps.forEach((ts, i) => {
      if (i % tStep !== 0 && i !== timestamps.length - 1) return;
      const x = scaleX(i);
      const t = new Date(ts);
      const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x, PAD.top + chartH + 16);
    });

    // ── Hover crosshair ──────────────────────────────────────
    if (mouseX !== null) {
      // Find nearest price index
      const idx = Math.round(((mouseX - PAD.left) / chartW) * (prices.length - 1));
      const clampedIdx = Math.max(0, Math.min(prices.length - 1, idx));
      const hx = scaleX(clampedIdx);
      const hy = scaleY(prices[clampedIdx]);

      // Vertical line
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = CROSS_COLOR;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(hx, PAD.top);
      ctx.lineTo(hx, PAD.top + chartH);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(PAD.left, hy);
      ctx.lineTo(W - PAD.right, hy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Crosshair dot
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = LINE_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Tooltip box
      const tipPrice = prices[clampedIdx];
      const tipTime  = timestamps[clampedIdx]
        ? new Date(timestamps[clampedIdx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '';
      const tipText  = `$${fmt(tipPrice)}`;
      const tipW = 90, tipH = 32;
      let tipX = hx + 10;
      let tipY = hy - tipH - 6;
      if (tipX + tipW > W - PAD.right) tipX = hx - tipW - 10;
      if (tipY < PAD.top) tipY = hy + 6;

      ctx.fillStyle = '#0F1520';
      ctx.strokeStyle = 'rgba(59,142,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.fillRect(tipX, tipY, tipW, tipH);
      ctx.strokeRect(tipX, tipY, tipW, tipH);

      ctx.font      = '600 11px JetBrains Mono';
      ctx.fillStyle = PRICE_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText(tipText, tipX + 8, tipY + 13);

      ctx.font      = '400 8px JetBrains Mono';
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(tipTime, tipX + 8, tipY + 25);
    }

    // ── Stats ─────────────────────────────────────────────────
    const first = prices[0];
    const chg   = ((lastPrice - first) / first * 100).toFixed(2);
    const sign  = chg >= 0 ? '+' : '';
    if (lowEl)    lowEl.textContent    = `LOW  $${fmt(min)}`;
    if (highEl)   highEl.textContent   = `HIGH  $${fmt(max)}`;
    if (changeEl) {
      changeEl.textContent = `${sign}${chg}%`;
      changeEl.style.color = chg >= 0 ? '#00C48C' : '#FF4D4D';
    }
  }

  // Mouse tracking
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouseY = (e.clientY - rect.top)  * (canvas.height / rect.height);
    draw();
  });
  canvas.addEventListener('mouseleave', () => { mouseX = null; mouseY = null; draw(); });

  async function fetchPrice() {
    try {
      const r = await fetch('/api/price');
      const d = await r.json();
      if (d.spot && d.spot > 0) {
        prices.push(d.spot);
        timestamps.push(Date.now());
        if (prices.length > MAX_TICKS)     { prices.shift(); }
        if (timestamps.length > MAX_TICKS) { timestamps.shift(); }
        draw();
      }
    } catch {}
  }

  window.addEventListener('resize', resize);
  resize();
  fetchPrice();
  setInterval(fetchPrice, 15_000);
})();
