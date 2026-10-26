// Quadro de assinatura (dedo, caneta ou mouse). Uso: const q = quadroAssinatura(canvas); q.vazio(); q.png(); q.limpar();
window.quadroAssinatura = function (canvas) {
  const ctx = canvas.getContext('2d');
  let tinta = 0, desenhando = false, ultimo = null;
  function ajustar() {
    const r = canvas.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4a';
    tinta = 0;
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { desenhando = true; ultimo = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!desenhando) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    tinta += Math.hypot(p.x - ultimo.x, p.y - ultimo.y); ultimo = p;
  });
  const parar = () => { desenhando = false; };
  canvas.addEventListener('pointerup', parar); canvas.addEventListener('pointercancel', parar); canvas.addEventListener('pointerleave', parar);
  ajustar();
  return {
    // pouco traço (um ponto ou um risco curto) não vale como assinatura
    vazio: () => tinta < 60,
    limpar: ajustar,
    // recorta a área desenhada e devolve data:image/png
    png() {
      const { width: w, height: h } = canvas, d = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
      const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
      c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
  };
};
