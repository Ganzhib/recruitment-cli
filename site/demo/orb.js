import { MODE_DRAWS, resolvePreset } from '../vendor/thinking-orbs/engine.es.js';

// Native canvas host for thinking-orbs/engine; follows the upstream lifecycle guidance.
export function createOrb(canvas, size = 20) {
  const context = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = size + 'px';
  let preset = resolvePreset('breathing', size);
  let active = false;
  let visible = true;
  let frame = 0;
  function draw(time) {
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);
    MODE_DRAWS[preset.mode](context, size, time, true, preset.opts);
  }
  function tick() {
    draw((performance.now() / 1000) * preset.speed);
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    draw(0.6);
    if (active && visible && !document.hidden && !reduced.matches)
      frame = requestAnimationFrame(tick);
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  sync();
  return {
    set(state, label, running = true) {
      preset = resolvePreset(state, size);
      canvas.dataset.state = state;
      canvas.setAttribute('aria-label', label);
      active = running;
      sync();
    },
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    },
  };
}
