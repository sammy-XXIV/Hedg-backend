(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, t = 0;

  const LINES = [
    { amp: 0.06, freq: 0.0008, speed: 0.00012, phase: 0,    color: 'rgba(201,169,110,0.07)', yBase: 0.35 },
    { amp: 0.04, freq: 0.0012, speed: 0.00008, phase: 2.1,  color: 'rgba(201,169,110,0.04)', yBase: 0.62 },
    { amp: 0.05, freq: 0.0006, speed: 0.00015, phase: 4.7,  color: 'rgba(201,169,110,0.05)', yBase: 0.50 },
  ];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function drawLine(l) {
    ctx.beginPath();
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 1;
    const step = 4;
    for (let x = 0; x <= W; x += step) {
      const y = H * l.yBase + H * l.amp * Math.sin(x * l.freq + l.phase + t * l.speed * 10000);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function tick() {
    t++;
    ctx.clearRect(0, 0, W, H);
    LINES.forEach(l => {
      l.phase += l.speed;
      drawLine(l);
    });
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  resize();
  tick();
})();
