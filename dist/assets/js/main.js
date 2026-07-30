const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

async function loadGitHubContributions() {
  const graph = $('#gh-graph');
  const note = $('#gh-note');
  if (!graph || !note) return;

  try {
    const response = await fetch('/api/github-contributions');
    if (!response.ok) throw new Error('Contributions unavailable');
    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const firstVisibleDate = sixMonthsAgo.toISOString().slice(0, 10);
    const days = [...document.querySelectorAll('[data-date][data-level]')]
      .map((day) => ({ date: day.dataset.date, level: Number(day.dataset.level) }))
      .filter((day) => day.date >= firstVisibleDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) throw new Error('No contribution data found');

    const levels = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    graph.replaceChildren();
    for (const day of days) {
      const cell = document.createElement('span');
      cell.className = 'contribution';
      cell.style.background = levels[day.level] || levels[0];
      cell.title = day.date;
      graph.append(cell);
    }
    const activeDays = days.filter((day) => day.level > 0).length;
    note.textContent = `${activeDays} active days · last 6 months`;
  } catch (error) {
    note.textContent = 'contributions temporarily unavailable';
  }
}

function startClock() {
  const clock = $('#clock');
  const hourHand = $('#analog-hour');
  const minuteHand = $('#analog-minute');
  if (!clock || !hourHand || !minuteHand) return;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
  const tick = () => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const hour = Number(parts.hour) % 12;
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    clock.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
    hourHand.setAttribute('transform', `rotate(${hour * 30 + minute / 2} 22 22)`);
    minuteHand.setAttribute('transform', `rotate(${minute * 6 + second / 10} 22 22)`);
  };
  tick(); setInterval(tick, 1000);
}

async function loadDuolingoStatus() {
  const card = $('#duolingo-widget');
  const status = $('#duolingo-status');
  const streak = $('#duolingo-streak');
  const note = $('#duolingo-note');
  if (!card || !status || !streak || !note) return;

  try {
    const response = await fetch('/api/duolingo');
    if (!response.ok) throw new Error('Status unavailable');
    const data = await response.json();
    const active = data.didPracticeToday;
    card.classList.toggle('is-complete', active);
    card.classList.toggle('is-pending', !active);
    status.setAttribute('aria-label', active ? 'Duolingo completed today' : 'Duolingo not completed today');
    streak.textContent = data.streak.toLocaleString('en-US');
    note.textContent = active ? 'day streak · done today' : 'day streak · not yet today';
  } catch (error) {
    card.classList.add('is-unavailable');
    status.setAttribute('aria-label', 'Duolingo status unavailable');
    note.textContent = 'status temporarily unavailable';
  }
}

function setupDuolingoNudge() {
  const button = $('#duolingo-nudge');
  const note = $('#duolingo-nudge-note');
  if (!button || !note) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    note.textContent = 'sending reminder…';
    try {
      const response = await fetch('/api/duolingo-nudge', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send the reminder');
      button.setAttribute('aria-label', 'Reminder sent');
      button.title = 'Reminder sent';
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      $('#duolingo-callout')?.remove();
      note.textContent = 'thanks for letting me know -- i guess ill go do it now 🙄.';
    } catch (error) {
      button.disabled = false;
      note.textContent = error.message;
    }
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function typeRole(role, text, deleting = false) {
  role.className = 'role role--typing';
  const characters = deleting ? [...role.textContent] : [...text];
  if (deleting) {
    while (characters.length) { characters.pop(); role.textContent = characters.join(''); await delay(42); }
  } else {
    role.textContent = '';
    for (const character of characters) { role.textContent += character; await delay(68); }
  }
  role.className = 'role';
}

function setupRoleSwitcher() {
  const role = $('#role');
  if (!role || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const roles = [
    { text: 'engineer', transition: 'type' },
    { text: 'builder', transition: 'swipe' },
    { text: 'creator', transition: 'paste' },
    { text: 'developer', transition: 'highlight' },
    { text: 'photographer', transition: 'fade' },
    { text: 'biologist', transition: 'type' }
  ];
  let index = 0;

  const changeRole = async () => {
    const next = roles[(index + 1) % roles.length];
    if (next.transition === 'type') {
      await typeRole(role, '', true);
      await typeRole(role, next.text);
    } else {
      role.className = next.transition === 'swipe' ? 'role role--swipe-out' : 'role role--leaving';
      await delay(210);
      role.textContent = next.text;
      role.className = `role role--${next.transition}`;
      if (next.transition === 'swipe') role.className = 'role role--swipe-in';
      await delay(500);
    }
    index = (index + 1) % roles.length;
    await delay(2800);
    changeRole();
  };

  role.textContent = '';
  typeRole(role, roles[0].text).then(() => delay(2800)).then(changeRole);
}

// Splits the headline into masked words so each one can rise out of its own line box.
// `.name` and `.role` are wrapped whole — the role switcher keeps rewriting them, so
// they must survive untouched.
function setupHeadlineReveal() {
  const heading = $('h1');
  if (!heading || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const words = [];
  const mask = (node) => {
    const clip = document.createElement('span');
    const word = document.createElement('span');
    clip.className = 'h-mask';
    word.className = 'h-word';
    word.appendChild(node);
    clip.appendChild(word);
    words.push(word);
    return clip;
  };

  const rebuilt = document.createDocumentFragment();
  [...heading.childNodes].forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE) { rebuilt.appendChild(mask(node)); return; }
    // keep the gaps as real text nodes so the line still wraps where it wants to
    node.textContent.split(/(\s+)/).forEach((chunk) => {
      if (!chunk) return;
      rebuilt.appendChild(/^\s+$/.test(chunk) ? document.createTextNode(chunk) : mask(document.createTextNode(chunk)));
    });
  });
  if (!words.length) return;

  heading.replaceChildren(rebuilt);
  words.forEach((word, index) => word.style.setProperty('--i', index));
  heading.classList.add('is-split');
  requestAnimationFrame(() => requestAnimationFrame(() => heading.classList.add('is-revealed')));

  // Once the last word has landed, drop the clipping so the role switcher's caret,
  // blur and highlight animations aren't cut off by the masks.
  const settle = () => heading.classList.add('is-settled');
  words[words.length - 1].addEventListener('transitionend', settle, { once:true });
  setTimeout(settle, 1200 + words.length * 42);
}

// Media drifts against the scroll. One rAF loop, reads batched ahead of writes,
// and it parks itself the moment nothing is on screen.
function setupParallax() {
  if (matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;
  const targets = new Map();
  $$('.photo img, .project-media img').forEach((img) => targets.set(img, img.closest('.project-media') ? 2.2 : 3.6));
  if (!targets.size) return;

  const active = new Set();
  let running = false;
  const frame = () => {
    if (!active.size) { running = false; return; }
    const height = innerHeight;
    const measured = [];
    active.forEach((img) => { const box = img.getBoundingClientRect(); measured.push([img, box.top + box.height / 2, box.height]); });
    measured.forEach(([img, middle, own]) => {
      const progress = Math.max(-1, Math.min(1, (middle - height / 2) / ((height + own) / 2)));
      img.style.setProperty('--par', `${(progress * targets.get(img)).toFixed(2)}%`);
    });
    requestAnimationFrame(frame);
  };
  const start = () => { if (!running) { running = true; requestAnimationFrame(frame); } };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) active.add(entry.target);
      else { active.delete(entry.target); entry.target.style.setProperty('--par', '0%'); }
    });
    start();
  }, { rootMargin:'14% 0px' });
  targets.forEach((_, img) => observer.observe(img));
  document.documentElement.classList.add('has-parallax');
}

function setupRevealAndNav() {
  const nav = $$('[data-nav]');
  // Entries that cross the threshold together get staggered against each other, so a fast
  // scroll cascades a whole list while a slow one reveals each item as it arrives.
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      .forEach((entry, index) => {
        const item = entry.target;
        if (index) item.style.transitionDelay = `${index * 65}ms`;
        // clear the delay afterwards so it can't slow this element's hover transitions,
        // ignoring transitionend bubbling up from children
        const settle = (event) => {
          if (event.target !== item) return;
          item.style.transitionDelay = '';
          item.removeEventListener('transitionend', settle);
        };
        item.addEventListener('transitionend', settle);
        item.classList.add('is-revealed');
        observer.unobserve(item);
      });
  }, { threshold:.08, rootMargin:'0px 0px -5% 0px' });
  $$('[data-reveal]').forEach((item) => revealObserver.observe(item));
  const navObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) nav.forEach((link) => link.classList.toggle('is-active', link.dataset.nav === entry.target.id)); }), { rootMargin:'-45% 0px -50% 0px' });
  nav.map((link) => $(`#${link.dataset.nav}`)).filter(Boolean).forEach((section) => navObserver.observe(section));
}

function setupPhotoGallery() {
  const grid = $('.photo-grid');
  const button = $('[data-gallery-toggle]');
  if (!grid || !button) return;
  const photos = $$('.photo', grid);
  const initialCount = 5;
  if (photos.length <= initialCount) { button.hidden = true; return; }

  const updateButton = () => {
    const expanded = grid.classList.contains('is-expanded');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show selected studies' : `View ${photos.length - initialCount} more studies`;
  };
  button.addEventListener('click', () => { grid.classList.toggle('is-expanded'); updateButton(); });
  updateButton();
}

function setupCursorLens() {
  const ring = $('.cursor-ring');
  const dot = $('.cursor-dot');
  const caption = $('.cursor-label');
  if (!ring || !dot || !caption) return;
  if (matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;

  // [selector, ring scale, caption, tone] — first match wins, so specific rules sit above `a, button`.
  const RULES = [
    ['.photo, .project-media', 2.3, 'view', 'is-media'],
    ['.project-name', 1.7, 'open', 'is-link'],
    ['.signal', 1.7, 'visit', 'is-link'],
    ['.gallery-toggle', 1.55, 'more', 'is-link'],
    ['.duolingo-nudge', 1.55, 'nudge', 'is-link'],
    ['a, button', 1.45, '', 'is-link']
  ];
  const MAGNETIC = '.social-link, .profile-link, .project-name, .project-repo, .gallery-toggle, .duolingo-nudge';

  const TAU = Math.PI * 2;
  const STEP = 1 / 120;
  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
  const spring = (value) => ({ x:value, v:0 });
  // Semi-implicit Euler on a fixed timestep — identical behaviour at 60, 120 or 144Hz.
  const advance = (state, target, stiffness, damping) => {
    state.v += ((target - state.x) * stiffness - state.v * damping) * STEP;
    state.x += state.v * STEP;
  };
  const shortestTurn = (from, to) => {
    let delta = (to - from) % TAU;
    if (delta > Math.PI) delta -= TAU;
    else if (delta < -Math.PI) delta += TAU;
    return delta;
  };

  const pointer = { x:innerWidth / 2, y:innerHeight / 2 };
  const ringX = spring(pointer.x), ringY = spring(pointer.y);
  const dotX = spring(pointer.x), dotY = spring(pointer.y);
  const scale = spring(1), stretch = spring(0), press = spring(0);
  const shell = spring(0), dotShell = spring(1), captionFade = spring(0);
  const pullX = spring(0), pullY = spring(0);

  let angle = 0;
  let hovered = null, lastTarget = null;
  let magnetWanted = null, magnetNode = null;
  let targetScale = 1, held = 0, awake = 0, engaged = false;
  let captionText = '', pendingCaption = '';
  let last = performance.now(), carry = 0;

  const resolve = (target) => {
    if (target === lastTarget) return;
    lastTarget = target;
    let hit = null, rule = null;
    if (target && target.closest) {
      for (const candidate of RULES) {
        hit = target.closest(candidate[0]);
        if (hit) { rule = candidate; break; }
      }
    }
    if (hit === hovered) return;
    hovered = hit;
    targetScale = rule ? rule[1] : 1;
    pendingCaption = rule ? rule[2] : '';
    ring.classList.toggle('is-link', rule ? rule[3] === 'is-link' : false);
    ring.classList.toggle('is-media', rule ? rule[3] === 'is-media' : false);
    dot.classList.toggle('is-inverted', Boolean(rule));
    magnetWanted = hit ? hit.closest(MAGNETIC) : null;
  };

  const frame = (now) => {
    const delta = clamp((now - last) / 1000, 0, .05);
    last = now;
    carry = Math.min(carry + delta, .1);

    // Hand the magnet over only once the previous element has eased back to rest.
    if (magnetNode && magnetNode !== magnetWanted && Math.abs(pullX.x) < .06 && Math.abs(pullY.x) < .06) {
      magnetNode.style.translate = '';
      magnetNode = null;
    }
    if (!magnetNode && magnetWanted) magnetNode = magnetWanted;

    // All layout reads happen here, before this frame writes anything.
    let wantX = 0, wantY = 0;
    if (magnetNode && magnetNode === magnetWanted) {
      const box = magnetNode.getBoundingClientRect();
      wantX = clamp((pointer.x - (box.left + box.width / 2 - pullX.x)) * .22, -7, 7);
      wantY = clamp((pointer.y - (box.top + box.height / 2 - pullY.x)) * .22, -7, 7);
    }
    const captionTarget = captionText && captionText === pendingCaption ? 1 : 0;
    const dotTarget = pendingCaption ? 0 : 1; // the caption owns the centre when there is one

    while (carry >= STEP) {
      carry -= STEP;
      advance(ringX, pointer.x, 520, 42);   // 3.6Hz, damping .92 — a breath of lag, no overshoot wobble
      advance(ringY, pointer.y, 520, 42);
      advance(dotX, pointer.x, 2400, 98);   // critically damped, near 1:1
      advance(dotY, pointer.y, 2400, 98);
      advance(scale, targetScale, 760, 40); // damping .72 — the state change gets a soft bounce
      advance(press, held, 1400, 64);
      advance(shell, awake, 900, 60);
      advance(dotShell, dotTarget, 900, 60);
      advance(captionFade, captionTarget, 900, 60);
      advance(pullX, wantX, 600, 44);
      advance(pullY, wantY, 600, 44);
      // Squash reads the ring's own velocity, so it is immune to mouse polling rate.
      const speed = Math.hypot(ringX.v, ringY.v);
      advance(stretch, clamp(speed / 5200, 0, .26), 900, 60);
      if (speed > 60) angle += shortestTurn(angle, Math.atan2(ringY.v, ringX.v)) * .12;
    }

    const settling = Math.abs(ringX.v) + Math.abs(ringY.v) + Math.abs(dotX.v) + Math.abs(dotY.v) > .5
      || Math.abs(scale.x - targetScale) > .0005 || Math.abs(press.x - held) > .0005
      || Math.abs(shell.x - awake) > .0005 || Math.abs(dotShell.x - dotTarget) > .0005
      || Math.abs(captionFade.x - captionTarget) > .0005 || Math.abs(stretch.x) > .0005
      || Math.abs(pullX.x - wantX) > .01 || Math.abs(pullY.x - wantY) > .01;

    if (settling) {
      if (pendingCaption !== captionText && captionFade.x < .08) {
        captionText = pendingCaption;
        caption.textContent = captionText;
      }
      const body = scale.x * (1 - press.x * .14);
      const x = ringX.x.toFixed(2), y = ringY.x.toFixed(2);
      // One transform per element: position, centre, then rotate/scale about that centre.
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${angle.toFixed(4)}rad) scale(${(body * (1 + stretch.x)).toFixed(4)}, ${(body * (1 - stretch.x * .55)).toFixed(4)})`;
      ring.style.opacity = shell.x.toFixed(3);
      dot.style.transform = `translate3d(${dotX.x.toFixed(2)}px, ${dotY.x.toFixed(2)}px, 0) translate(-50%, -50%) scale(${(1 - press.x * .45).toFixed(3)})`;
      dot.style.opacity = (shell.x * dotShell.x).toFixed(3);
      caption.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      caption.style.opacity = (shell.x * captionFade.x).toFixed(3);
      if (magnetNode) magnetNode.style.translate = `${pullX.x.toFixed(2)}px ${pullY.x.toFixed(2)}px`;
    }
    requestAnimationFrame(frame);
  };

  const move = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!engaged) {
      engaged = true;
      ringX.x = dotX.x = pointer.x;
      ringY.x = dotY.x = pointer.y;
      document.documentElement.classList.add('has-cursor-lens');
    }
    awake = 1;
    resolve(event.target);
  };
  const sleep = () => {
    awake = 0;
    held = 0;
    lastTarget = null;
    hovered = null;
    magnetWanted = null;
    targetScale = 1;
    pendingCaption = '';
    ring.classList.remove('is-link', 'is-media');
    dot.classList.remove('is-inverted');
  };

  addEventListener('pointermove', move, { passive:true });
  addEventListener('pointerdown', () => { held = 1; }, { passive:true });
  addEventListener('pointerup', () => { held = 0; }, { passive:true });
  addEventListener('pointercancel', () => { held = 0; }, { passive:true });
  addEventListener('blur', sleep);
  document.addEventListener('mouseleave', sleep);
  requestAnimationFrame(frame);
}

loadGitHubContributions(); startClock(); loadDuolingoStatus(); setInterval(loadDuolingoStatus, 5 * 60 * 1000); setupDuolingoNudge(); setupHeadlineReveal(); setupRevealAndNav(); setupParallax(); setupPhotoGallery(); setupRoleSwitcher(); setupCursorLens();
