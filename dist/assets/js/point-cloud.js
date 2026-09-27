const canvas = document.querySelector('#point-cloud');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

if (canvas) setupPointCloud(canvas);

function setupPointCloud(canvas) {
  const context = canvas.getContext('2d', { alpha:true });
  if (!context) {
    canvas.remove();
    return;
  }

  const pointer = { x:.72, y:.28, targetX:.72, targetY:.28, active:0, targetActive:0 };
  // The signal cards are opaque panels sitting over the field. Reading one while
  // the void crawls underneath it is noise, so the hole closes for as long as the
  // pointer is on a card and eases back open when it leaves.
  const QUIET_ZONE = '.signal,.duolingo-widget';
  let suppressed = false;
  const accent = [75, 87, 209];
  // Without a hovering pointer there is nothing to carve the field, so the void
  // drifts on its own instead of sitting the page out entirely.
  const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  // The field covers the whole page now, so a colour string per dot would cost
  // more than the geometry does. Dots are binned by alpha and each bin is filled
  // in one pass with a single fillStyle.
  const ALPHA_STEPS = 24;
  const MAX_ALPHA = .28;
  const bins = Array.from({ length:ALPHA_STEPS }, () => ({ count:0, data:new Float32Array(0) }));
  let width = 0;
  let height = 0;
  let dpr = 1;
  let columns = 0;
  let rows = 0;
  let points = [];
  let frame = 0;
  let lastFrame = 0;
  let startedAt = performance.now();

  // The plane runs well past the viewport on every side so its own edge fade
  // never shows up as a band across the page.
  const PLANE_SPREAD_X = 1.62;
  const PLANE_SPREAD_Y = 1.52;

  const rebuild = () => {
    // A zero-sized viewport (hidden tab, restored background window) would poison
    // the normalised pointer with raw pixel values, so keep the last good field.
    if (!innerWidth || !innerHeight) return;
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Every dot is drawn every frame now, so the grid gets a ceiling: on a small
    // laptop the spacing below holds, and on a very wide display it opens up
    // rather than quietly doubling the work.
    const planeArea = width * PLANE_SPREAD_X * height * PLANE_SPREAD_Y;
    const spacing = Math.max(width < 700 ? 30 : 24, Math.sqrt(planeArea / 9000));
    columns = Math.ceil(width * PLANE_SPREAD_X / spacing);
    rows = Math.ceil(height * PLANE_SPREAD_Y / spacing);
    points = [];

    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        const v = row / rows;
        // A deterministic offset breaks the perfect computer grid without looking noisy.
        const jitter = Math.sin(column * 91.7 + row * 37.3);
        points.push({ u, v, jitter });
      }
    }

    // x, y and size per dot, worst case every dot landing in the same bin.
    for (const bin of bins) bin.data = new Float32Array(points.length * 3);
  };

  const move = (event) => {
    if (width < 1 || height < 1) return;
    pointer.targetX = event.clientX / width;
    pointer.targetY = event.clientY / height;
    // The void has no business gliding in from wherever it was last parked.
    if (pointer.active < .01) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
    }
    pointer.targetActive = suppressed ? 0 : 1;
    if (reducedMotion.matches) scheduleStaticFrame();
  };

  const soften = () => {
    pointer.targetActive = 0;
    if (reducedMotion.matches) scheduleStaticFrame();
  };

  const render = (milliseconds, force = false) => {
    if (!force && milliseconds - lastFrame < 1000 / 40) {
      frame = requestAnimationFrame(render);
      return;
    }
    lastFrame = milliseconds;

    const time = (milliseconds - startedAt) / 1000;

    if (!canHover) {
      // A slow lissajous walk so touch devices still get a moving clearing.
      pointer.targetX = .5 + Math.sin(time * .09) * .22;
      pointer.targetY = .44 + Math.cos(time * .073) * .17;
      pointer.targetActive = suppressed ? 0 : .62;
    }

    const ease = reducedMotion.matches ? 1 : .12;
    pointer.x += (pointer.targetX - pointer.x) * ease;
    pointer.y += (pointer.targetY - pointer.y) * ease;
    // The void opens a touch faster than it closes, so leaving the page heals the
    // field slowly rather than snapping it shut. Standing down for a card is the
    // exception: it answers a deliberate hover, so it clears quicker.
    const fade = pointer.targetActive > pointer.active ? .07 : (suppressed ? .1 : .03);
    pointer.active += (pointer.targetActive - pointer.active) * (reducedMotion.matches ? 1 : fade);

    context.clearRect(0, 0, width, height);

    // Stay present beyond the hero. The opening viewport is the clearest, then
    // the field settles to a quieter background instead of disappearing.
    const scrollPresence = .62 + .38 * Math.exp(-scrollY / Math.max(height * 1.1, 1));
    canvas.style.opacity = String(scrollPresence);

    const centerX = width * .58;
    const centerY = height * .38;
    const planeWidth = width * PLANE_SPREAD_X;
    const planeHeight = height * PLANE_SPREAD_Y;
    // The clearing the pointer carries: dots inside it wash out to the white of
    // the page. The ripple reaches a little further, so its rings break against
    // the rim of the hole instead of dying inside it.
    const voidRadius = Math.min(width, height) * .3;
    const rippleRadius = Math.min(width, height) * .42;
    const pointerX = pointer.x * width;
    const pointerY = pointer.y * height;

    for (const bin of bins) bin.count = 0;

    for (const point of points) {
      const planeX = (point.u - .5) * planeWidth;
      const planeY = (point.v - .5) * planeHeight;
      const baseScreenX = centerX + planeX;
      const baseScreenY = centerY + planeY;
      const dx = baseScreenX - pointerX;
      const dy = baseScreenY - pointerY;
      const distanceSquared = dx * dx + dy * dy;
      const distance = Math.sqrt(distanceSquared);

      // Smoothstep from a fully obscured core out to an untouched field, so the
      // hole has no edge to catch on — it just dissolves into white.
      const t = Math.min(1, distance / voidRadius);
      const veil = 1 - t * t * (3 - 2 * t);
      const clarity = 1 - veil * pointer.active;

      const influence = Math.exp(-distanceSquared / (rippleRadius * rippleRadius));

      const ambient = Math.sin(point.u * 8.8 + time * .42)
        * Math.cos(point.v * 7.1 - time * .34) * 26;
      const ripple = Math.cos(distance * .031 - time * 2.15)
        * influence * pointer.active * 42;
      const depth = ambient + ripple + point.jitter * 2.2;

      // Project the displaced plane toward a slightly off-centre camera. Depth
      // changes both position and dot size, so the motion reads as geometry.
      const perspective = 1 + depth / 560;
      const x = centerX + planeX * perspective + depth * .16;
      const y = centerY + planeY * perspective - depth * .42;

      // Keeps the plane from ending on a straight line where it runs past the
      // viewport; the spreads above put this fade offscreen on a normal window.
      const edgeX = Math.min(point.u / .1, (1 - point.u) / .1, 1);
      const edgeY = Math.min(point.v / .1, (1 - point.v) / .1, 1);
      // Light enough to sit under body copy across the whole page. The ripple
      // term adds its weight where the wave is strongest, which — since the core
      // is washed out — lands as a bright rim around the clearing.
      const alpha = Math.max(0, edgeX * edgeY * clarity * (.15 + influence * pointer.active * .12));
      if (alpha < .006 || x < -3 || x > width + 3 || y < -3 || y > height + 3) continue;

      // Fat enough to read as dots rather than dust; depth still swings the
      // size so the ripple keeps its sense of geometry.
      const size = Math.max(2, 2.6 + depth / 80);
      const bin = bins[Math.min(ALPHA_STEPS - 1, Math.floor(alpha / MAX_ALPHA * ALPHA_STEPS))];
      const offset = bin.count * 3;
      bin.data[offset] = x - size / 2;
      bin.data[offset + 1] = y - size / 2;
      bin.data[offset + 2] = size;
      bin.count++;
    }

    for (let step = 0; step < ALPHA_STEPS; step++) {
      const bin = bins[step];
      if (!bin.count) continue;
      const alpha = MAX_ALPHA * (step + .5) / ALPHA_STEPS;
      context.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${alpha.toFixed(3)})`;
      for (let index = 0; index < bin.count; index++) {
        const offset = index * 3;
        context.fillRect(bin.data[offset], bin.data[offset + 1], bin.data[offset + 2], bin.data[offset + 2]);
      }
    }

    if (!reducedMotion.matches) frame = requestAnimationFrame(render);
  };

  // Reduced motion keeps the clearing — it just stops the field from animating
  // underneath it, so the page repaints only when the pointer actually moves.
  let staticFrame = 0;
  const scheduleStaticFrame = () => {
    if (staticFrame) return;
    staticFrame = requestAnimationFrame((milliseconds) => {
      staticFrame = 0;
      render(milliseconds, true);
    });
  };

  const onMotionPreferenceChange = () => {
    cancelAnimationFrame(frame);
    startedAt = performance.now();
    if (reducedMotion.matches) {
      render(startedAt, true);
    } else {
      frame = requestAnimationFrame(render);
    }
  };

  rebuild();
  addEventListener('resize', () => {
    rebuild();
    if (reducedMotion.matches) render(performance.now(), true);
  }, { passive:true });
  addEventListener('scroll', () => {
    if (reducedMotion.matches) render(performance.now(), true);
  }, { passive:true });
  addEventListener('pointermove', move, { passive:true });
  // pointerover fires on whatever the pointer is now over, card or page, so one
  // handler covers entering and leaving without tracking each card.
  addEventListener('pointerover', (event) => {
    const quiet = Boolean(event.target?.closest?.(QUIET_ZONE));
    if (quiet === suppressed) return;
    suppressed = quiet;
    if (suppressed) pointer.targetActive = 0;
    else if (canHover) pointer.targetActive = 1;
    if (reducedMotion.matches) scheduleStaticFrame();
  }, { passive:true });
  addEventListener('blur', soften);
  document.addEventListener('mouseleave', soften);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
    } else if (!reducedMotion.matches) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(render);
    }
  });
  reducedMotion.addEventListener?.('change', onMotionPreferenceChange);
  onMotionPreferenceChange();
}
