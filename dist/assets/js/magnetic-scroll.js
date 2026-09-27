// Magnetic section scrolling. A wheel gesture carries the page to the next
// section in one eased stroke and the rest of that gesture's inertia is
// swallowed, so a flick moves exactly one section. Sections taller than the
// viewport are not skipped: inside one the wheel glides through it (smoothed,
// not snapped), and only a fresh gesture at its edge pulls on to the neighbour.
// Touch, scrollbar dragging and arrow keys stay native; a stray resting
// position left by them is resolved by the next wheel gesture.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const sections = [...document.querySelectorAll('main > section')];

// a gesture is over once the wheel has been quiet this long
const GESTURE_GAP = 120;
const EDGE = 2;
// A slow, uneven scroll pauses longer between its bursts, so once a gesture has
// snapped it needs a longer rest to end, or it would read its own tail as a
// second push. A push inside momentum must also be a real one, not jitter.
const SNAPPED_GAP = 250;
const MIN_PUSH = 30;

const easeInOutCubic = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const maxScroll = () => root.scrollHeight - innerHeight;
// `html { scroll-behavior:smooth }` would turn every per-frame write into its own animation
const put = (y) => scrollTo({ top:y, behavior:'instant' });

// Each section becomes a stop: the position that aligns its top with the
// viewport, and the furthest position still inside it. Both clamp to the
// document end, so short closing sections share the final stop instead of
// asking for a position the page cannot reach.
function stops() {
  const max = maxScroll();
  const rail = document.querySelector('.rail');
  const offset = rail && getComputedStyle(rail).position === 'sticky' ? rail.offsetHeight : 0;
  const list = [];
  for (const section of sections) {
    const box = section.getBoundingClientRect();
    const start = Math.min(max, Math.max(0, Math.round(box.top + scrollY - offset)));
    let end = Math.min(max, Math.max(start, Math.round(box.bottom + scrollY - innerHeight)));
    // a section that only spills a little past the fold snaps like a short one;
    // gliding through a sliver would just cost the reader an extra gesture
    if (end - start < innerHeight * .2) end = start;
    const last = list[list.length - 1];
    if (last && start <= last.start) { last.end = Math.max(last.end, end); continue; }
    list.push({ id:section.id, start, end });
  }
  return list;
}

function setupMagneticScroll() {
  if (!sections.length) return;

  let y = scrollY;          // where the page is (as we last left it)
  let glideTarget = null;   // smoothed free scroll inside a tall section
  let tween = null;         // { from, to, start, duration }
  let frameId = 0;
  let lastWheel = 0;
  let gesture = null;       // { used:'glide' | 'snap' }

  const cancel = () => {
    tween = null;
    glideTarget = null;
    cancelAnimationFrame(frameId);
    frameId = 0;
  };

  let lastFrame = 0;
  const frame = (now) => {
    const dt = Math.min(64, now - (lastFrame || now));
    lastFrame = now;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.duration);
      y = tween.from + (tween.to - tween.from) * tween.ease(t);
      put(y);
      if (t === 1) tween = null;
    } else if (glideTarget !== null) {
      y += (glideTarget - y) * (1 - Math.exp(-dt / 90));
      if (Math.abs(glideTarget - y) < .5) { y = glideTarget; glideTarget = null; }
      put(y);
    }
    frameId = tween || glideTarget !== null ? requestAnimationFrame(frame) : 0;
    if (!frameId) lastFrame = 0;
  };
  const run = () => { if (!frameId) frameId = requestAnimationFrame(frame); };

  const snapTo = (to) => {
    glideTarget = null;
    const from = scrollY;
    if (Math.abs(to - from) < 1) return;
    // longer trips take a little longer, but never enough to feel sluggish
    const duration = Math.min(950, 560 + Math.abs(to - from) * .22);
    // retargeted mid-flight the page is already moving, so it eases out rather
    // than stalling to a standstill and accelerating again
    const ease = tween ? easeOutCubic : easeInOutCubic;
    y = from;
    tween = { from, to, start:performance.now(), duration, ease };
    run();
  };

  // A scroll container under the pointer that can still move this way keeps the wheel.
  const innerScroller = (target, dy) => {
    for (let node = target; node instanceof Element && node !== document.body && node !== root; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
      if (dy > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 0) return true;
    }
    return false;
  };

  const blocked = () => reduceMotion.matches || document.querySelector('.viewer:not([hidden])');

  const onWheel = (event) => {
    if (event.defaultPrevented || event.ctrlKey || blocked()) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const dy = event.deltaY * unit;
    // horizontal swipes (trackpad back/forward, carousels) are not ours
    if (Math.abs(dy) < Math.abs(event.deltaX * unit) || !dy) return;
    if (innerScroller(event.target, dy)) return;
    event.preventDefault();

    const now = performance.now();
    const dir = Math.sign(dy);
    const size = Math.abs(dy);
    // A trackpad keeps streaming momentum long after the fingers lift, so
    // silence alone is too slow to spot the next flick. Momentum only decays:
    // once a gesture has passed its peak, deltas climbing back up are a new push.
    let fresh = !gesture || dir !== gesture.dir || now - lastWheel > (gesture.used === 'snap' ? SNAPPED_GAP : GESTURE_GAP);
    if (!fresh) {
      // `low` follows the tail after the peak, never the ramp up to it
      if (!gesture.decaying && size >= gesture.peak) gesture.peak = gesture.low = size;
      if (size < gesture.peak * .7) gesture.decaying = true;
      if (gesture.decaying && size >= MIN_PUSH && size > gesture.low * 1.5 + 6) fresh = true;
      gesture.low = Math.min(gesture.low, size);
    }
    lastWheel = now;
    if (fresh) gesture = { dir, peak:size, low:size, decaying:false, used:null };
    // the momentum tail of a gesture that already snapped
    if (gesture.used === 'snap') return;

    const list = stops();
    // a flick during a snap carries on from where that snap is headed
    const at = tween ? tween.to : glideTarget ?? scrollY;
    // the stop we are inside, or the gap we are in between two of them
    const index = list.findIndex((stop) => at >= stop.start - EDGE && at <= stop.end + EDGE);
    const current = list[index];

    if (current && (dir > 0 ? at < current.end - EDGE : at > current.start + EDGE)) {
      // the snap lands inside a tall section; let it arrive before gliding on
      if (tween) return;
      // room left inside a tall section: glide, and stop dead at its edge
      if (glideTarget === null) y = scrollY;
      glideTarget = Math.min(current.end, Math.max(current.start, at + dy));
      gesture.used = 'glide';
      run();
      return;
    }
    // at an edge: a gesture that was gliding meets the wall; a fresh one pulls through
    if (gesture.used === 'glide') return;

    let next;
    if (current) next = list[index + dir];
    else next = dir > 0 ? list.find((stop) => stop.start > at) : [...list].reverse().find((stop) => stop.end < at);
    gesture.used = 'snap';
    if (!next) return;
    // arriving from below lands at the bottom of a tall section, so nothing is skipped
    snapTo(dir > 0 ? next.start : next.end);
  };

  // Paging keys follow the same stops. Arrows stay native for fine reading.
  const onKey = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || blocked()) return;
    const el = document.activeElement;
    if (el && el !== document.body && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
    const list = stops();
    const at = scrollY;
    let to = null;
    if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = maxScroll();
    else {
      const down = event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey);
      const up = event.key === 'PageUp' || (event.key === ' ' && event.shiftKey);
      if (!down && !up) return;
      const target = tween ? tween.to : at;
      const next = down ? list.find((stop) => stop.start > target + EDGE) : [...list].reverse().find((stop) => stop.start < target - EDGE);
      if (!next) return;
      to = next.start;
    }
    event.preventDefault();
    snapTo(to);
  };

  // In-page links to a section ride the same curve instead of the CSS smooth scroll.
  const onClick = (event) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || reduceMotion.matches) return;
    const link = event.target.closest?.('a[href^="#"]');
    const id = link?.getAttribute('href').slice(1);
    const stop = id && stops().find((item) => item.id === id);
    if (!stop) return;
    // deliberately without writing the id into the URL: a hash left in the
    // address bar reopens the site mid-portfolio on the next visit
    event.preventDefault();
    snapTo(stop.start);
  };

  // anything the reader does by hand takes the page back from the tween
  let touched = false;
  const release = () => { touched = true; if (tween || glideTarget !== null) cancel(); };

  // The page now parks exactly on a section, so the browser restoring the last
  // position reopens the site mid-portfolio — landing on Selected projects as
  // if that were the front door. Every visit starts at the top; a shared link
  // to a section is still honoured, and aligned to that section's stop rather
  // than to the anchor's scroll margin.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const openAt = () => {
    if (touched) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const stop = id && stops().find((item) => item.id === id);
    put(y = stop ? stop.start : 0);
  };
  openAt();
  // images and webfonts land after the first paint and move the sections with them
  addEventListener('load', openAt);

  addEventListener('wheel', onWheel, { passive:false });
  addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);
  addEventListener('pointerdown', release, { passive:true });
  addEventListener('touchstart', release, { passive:true });
}

setupMagneticScroll();
