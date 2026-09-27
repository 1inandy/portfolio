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

  // A changing word can rewrap the sentence. Reserve the tallest version of
  // the headline so that rewrapping stays inside the heading instead of moving
  // the hero, changing the document's snap geometry, and making the browser
  // visibly correct its resting scroll position a moment later.
  const heading = role.closest('h1');
  const reserveHeadlineHeight = () => {
    if (!heading) return;
    const width = heading.getBoundingClientRect().width;
    if (!width) return;

    const clone = heading.cloneNode(true);
    const cloneRole = $('.role', clone);
    if (!cloneRole) return;
    clone.removeAttribute('id');
    clone.classList.add('is-revealed', 'is-settled');
    clone.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;max-width:none;min-height:0;margin:0;visibility:hidden;pointer-events:none;`;
    cloneRole.removeAttribute('id');
    cloneRole.className = 'role';
    document.body.append(clone);

    let tallest = 0;
    roles.forEach(({ text }) => {
      cloneRole.textContent = text;
      tallest = Math.max(tallest, clone.scrollHeight);
    });
    clone.remove();
    heading.style.minBlockSize = `${Math.ceil(tallest)}px`;
  };

  let resizeFrame = 0;
  const scheduleReservation = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(reserveHeadlineHeight);
  };
  reserveHeadlineHeight();
  document.fonts?.ready.then(scheduleReservation);
  addEventListener('resize', scheduleReservation, { passive:true });

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
// `.name` and `.role` are wrapped whole — the role switcher keeps rewriting them, sos
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
  $$('.photo img').forEach((img) => targets.set(img, 3.6));
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
  const initialCount = 6;
  if (photos.length <= initialCount) { button.hidden = true; return; }

  const updateButton = () => {
    const expanded = grid.classList.contains('is-expanded');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show selected studies' : `View ${photos.length - initialCount} more studies`;
  };
  button.addEventListener('click', () => { grid.classList.toggle('is-expanded'); updateButton(); });
  updateButton();
}

// The grid is a contact sheet; this is the loupe. Each figure carries its own capture
// data as attributes, so the viewer reads the DOM rather than a parallel table.
function setupPhotoViewer() {
  const viewer = $('#photo-viewer');
  const grid = $('.photo-grid');
  if (!viewer || !grid) return;
  const image = $('#viewer-image', viewer);
  const title = $('#viewer-title', viewer);
  const count = $('.viewer-count', viewer);
  const exif = $('#viewer-exif', viewer);
  const steps = $$('[data-viewer-step]', viewer);
  const panel = $('.viewer-panel', viewer);
  const figure = $('.viewer-figure', viewer);
  const photos = $$('.photo', grid);
  // label → attribute, in the order a photographer would read them off
  const FIELDS = [['Taken','shot'], ['Camera','cam'], ['Lens','lens'], ['Focal length','focal'], ['Aperture','ap'], ['Shutter','sh'], ['Sensitivity','iso']];
  let index = -1;
  let opener = null;
  let clearing = 0;

  // Only the photos currently on the contact sheet can be stepped through, so collapsing
  // the grid while the viewer is open cannot strand it on a hidden frame.
  const visible = () => photos.filter((photo) => photo.offsetParent !== null || photo === photos[index]);

  const full = (photo) => $('img', photo).getAttribute('src').replace('assets/photos/', 'assets/photos/full/');
  const preload = (photo) => { if (photo) new Image().src = full(photo); };

  const show = (next) => {
    const list = visible();
    const photo = photos[next];
    if (!photo) return;
    index = next;
    const img = $('img', photo);
    image.src = full(photo);
    image.alt = img.alt;
    title.textContent = $('figcaption span', photo).textContent;
    const place = list.indexOf(photo) + 1;
    count.textContent = `${String(place).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    exif.replaceChildren(...FIELDS.filter(([, key]) => photo.dataset[key]).map(([label, key]) => {
      const pair = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = photo.dataset[key];
      pair.append(dt, dd);
      return pair;
    }));
    const at = list.indexOf(photo);
    steps.forEach((button) => {
      const to = at + Number(button.dataset.viewerStep);
      button.disabled = to < 0 || to >= list.length;
    });
    preload(list[at + 1]); preload(list[at - 1]);
  };

  const step = (delta) => {
    const list = visible();
    const to = list.indexOf(photos[index]) + delta;
    if (to < 0 || to >= list.length) return;
    show(photos.indexOf(list[to]));
  };

  const close = () => {
    viewer.classList.remove('is-open');
    document.body.classList.remove('viewer-open');
    const done = () => { viewer.hidden = true; image.removeAttribute('src'); };
    // the fade-out still needs the frame on screen, so the teardown waits it out —
    // reopening inside that window cancels it rather than blanking the new photo
    clearTimeout(clearing);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else clearing = setTimeout(done, 320);
    if (opener) opener.focus();
    opener = null;
    index = -1;
  };

  const open = (photo, trigger) => {
    opener = trigger;
    clearTimeout(clearing);
    viewer.hidden = false;
    show(photos.indexOf(photo));
    document.body.classList.add('viewer-open');
    requestAnimationFrame(() => viewer.classList.add('is-open'));
    $('.viewer-close', viewer).focus();
  };

  grid.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-photo-open]');
    if (!trigger) return;
    open(trigger.closest('.photo'), trigger);
  });

  viewer.addEventListener('click', (event) => {
    // the panel fills the screen, so a click that lands on it rather than on the
    // photo or its caption is a click on the dark room: treat it as dismissal
    if (event.target.closest('[data-viewer-close]') || event.target === panel || event.target === figure) { close(); return; }
    const stepper = event.target.closest('[data-viewer-step]');
    if (stepper) step(Number(stepper.dataset.viewerStep));
  });

  addEventListener('keydown', (event) => {
    if (viewer.hidden) return;
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    // the dialog is the only thing on screen, so keep the tab ring inside it
    if (event.key === 'Tab') {
      const focusable = $$('button:not([disabled])', viewer);
      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus(); }
    }
  });
}

function setupCursorLens() {
  const ring = $('.cursor-ring');
  const dot = $('.cursor-dot');
  const caption = $('.cursor-label');
  const click = $('.cursor-click');
  if (!ring || !dot || !caption || !click) return;
  if (matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;

  // [selector, ring scale, caption, tone, sticks] — first match wins, so specific rules
  // sit above `a, button`. Any element can override with data-cursor="stick|invert|link|
  // media|off" and data-cursor-text="…", so behaviour can move around without editing this.
  // A row of icons or a grid of photographs is one hover region, not five.
  // Matching the container rather than each child means the tone, the size and
  // the caption hold steady across the gaps between them, instead of the disc
  // resolving and re-resolving every few pixels as the pointer crosses a seam —
  // which read as a flicker and made the whole row feel unclickable.
  const RULES = [
    ['.photo-grid', 3, 'open', 'is-invert', false],
    // A row is a link across the full column, not a one-word tab: the old
    // index's big inverted disc sat on top of the copy being read. Same
    // treatment as a signal card, which is the page's other whole-element link.
    ['.work-repo', 1.6, 'source', 'is-link', false],
    ['.work-row', 1.9, 'visit', 'is-link', false],
    ['.publication-copy h2', 2.4, '', 'is-invert', 'rail'],
    ['.gallery-toggle', 2.1, '', 'is-invert', true],
    ['.meta-email', 2.1, '', 'is-invert', true],
    ['.signal', 1.7, 'visit', 'is-link', false],
    ['.duolingo-nudge', 1.75, '', 'is-click', false],
    ['.rail-nav, .rail-socials, .profile-links, .contact-links', 1.45, '', 'is-link', false],
    ['a, button', 1.45, '', 'is-link', false]
  ];
  const MAGNETIC = '.social-link, .profile-link, .work-repo, .work-more-link, .duolingo-nudge';
  const TONES = ['is-link', 'is-media', 'is-invert', 'is-click'];
  // how far the stuck cursor is allowed to drift off the element's centre toward the pointer
  const STICK_PULL = .11;
  // Tidal lean on a stuck element: TIDE_REACH is the furthest it will ever travel, and
  // TIDE_SOFTEN widens the falloff so small targets are not maxed out by a tiny movement.
  const TIDE_REACH = 7;
  const TIDE_SOFTEN = 30;

  const TAU = Math.PI * 2;
  const STEP = 1 / 120;
  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
  const spring = (value) => ({ x:value, v:0 });
  // Semi-implicit Euler on a fixed timestep — identical behaviour at 60, 120 or 144Hz.
  const advance = (state, target, stiffness, damping) => {
    state.v += ((target - state.x) * stiffness - state.v * damping) * STEP;
    state.x += state.v * STEP;
  };
  // ease-out falloff in [-1,1] — responsive near the centre, flattening at the edges so
  // the pull reads as a force that runs out of strength, not a leash
  const tide = (ratio) => { const t = clamp(ratio, -1, 1); return Math.sign(t) * (1 - (1 - Math.abs(t)) ** 2); };

  // A block element's box can be far wider than the words inside it — an award heading
  // fills its whole grid column — so sticking to the box centre misses the text entirely.
  // Measure the glyphs instead, keeping only the line the pointer is actually on.
  const measure = document.createRange();
  const textRect = (element, at) => {
    measure.selectNodeContents(element);
    const pieces = [...measure.getClientRects()].filter((piece) => piece.width && piece.height);
    if (!pieces.length) return element.getBoundingClientRect();
    let line = pieces[0], nearest = Infinity;
    for (const piece of pieces) {
      const gap = Math.abs(at.y - (piece.top + piece.height / 2));
      if (gap < nearest) { nearest = gap; line = piece; }
    }
    // union every fragment sharing that line, so a trailing arrow or icon still counts
    let left = line.left, right = line.right, top = line.top, bottom = line.bottom;
    for (const piece of pieces) {
      if (piece.bottom <= line.top || piece.top >= line.bottom) continue;
      left = Math.min(left, piece.left); right = Math.max(right, piece.right);
      top = Math.min(top, piece.top); bottom = Math.max(bottom, piece.bottom);
    }
    return { left, top, width:right - left, height:bottom - top };
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
  const shell = spring(0), dotShell = spring(1), captionFade = spring(0), clickFade = spring(0);
  const pullX = spring(0), pullY = spring(0);

  let angle = 0;
  let hovered = null, lastTarget = null;
  let magnetWanted = null, magnetNode = null, stickNode = null, stickMotion = '';
  let targetScale = 1, held = 0, awake = 0, engaged = false, clickWanted = false, liquidTone = '';
  let captionText = '', pendingCaption = '';
  let last = performance.now(), carry = 0;

  const MODE_TONES = { stick:'is-invert', invert:'is-invert', media:'is-media', link:'is-link', click:'is-click' };

  const resolve = (target) => {
    if (target === lastTarget) return;
    lastTarget = target;

    // nearest [data-cursor] wins over a selector rule only when it is the deeper element
    let hit = null, rule = null;
    if (target && target.closest) {
      for (const candidate of RULES) {
        const match = target.closest(candidate[0]);
        if (match) { hit = match; rule = candidate; break; }
      }
      const tagged = target.closest('[data-cursor]');
      if (tagged && (!hit || hit.contains(tagged))) { hit = tagged; rule = null; }
    }
    // The magnet stays per-element even where the rule is per-group: the icon row
    // is one hover region so the disc holds steady across it, but the single icon
    // actually under the pointer is still what leans. That means resolving it off
    // the event target, and before the early-out below — moving from one icon to
    // the next never changes which container was hit.
    const magnet = hit && target.closest ? target.closest(MAGNETIC) : null;

    if (hit === hovered) {
      magnetWanted = stickNode || magnet;
      return;
    }
    hovered = hit;

    const mode = hit ? hit.dataset.cursor || '' : '';
    const ruleMotion = !mode && rule ? rule[4] : '';
    const sticks = Boolean(hit) && mode !== 'off' && (mode === 'stick' || Boolean(ruleMotion));
    const tone = !hit || mode === 'off' ? '' : MODE_TONES[mode] || (rule ? rule[3] : 'is-link');
    liquidTone = tone;

    // a bare data-cursor with no matching rule still needs a sensible size for its tone
    const fallbackScale = tone === 'is-invert' ? 2.4 : tone === 'is-media' ? 2.3 : 1.45;
    targetScale = !hit || mode === 'off' ? 1 : Number(hit.dataset.cursorScale) || (rule ? rule[1] : fallbackScale);
    pendingCaption = !hit || mode === 'off' ? '' : hit.dataset.cursorText ?? (rule ? rule[2] : '');
    stickNode = sticks ? hit : null;
    stickMotion = sticks ? (mode === 'stick' ? 'stick' : ruleMotion) : '';
    clickWanted = tone === 'is-click';
    // a stuck element is its own magnet, so the disc parks while the element leans
    magnetWanted = sticks ? hit : magnet;
    TONES.forEach((name) => ring.classList.toggle(name, name === tone));
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
    const stickBox = stickNode ? textRect(stickNode, pointer) : null;
    let wantX = 0, wantY = 0;
    if (magnetNode && magnetNode === magnetWanted) {
      const box = magnetNode === stickNode ? stickBox : magnetNode.getBoundingClientRect();
      // subtract the offset already applied, or the element chases its own tail
      const restX = box.left + box.width / 2 - pullX.x;
      const restY = box.top + box.height / 2 - pullY.x;
      if (magnetNode === stickNode && stickMotion !== 'rail') {
        // Tide: leans toward the pointer in proportion to how far off centre it is,
        // saturating well before it could ever reach it. Anchored, never attached.
        wantX = tide((pointer.x - restX) / (box.width / 2 + TIDE_SOFTEN)) * TIDE_REACH;
        wantY = tide((pointer.y - restY) / (box.height / 2 + TIDE_SOFTEN)) * TIDE_REACH;
      } else {
        wantX = clamp((pointer.x - restX) * .22, -7, 7);
        wantY = clamp((pointer.y - restY) * .22, -7, 7);
      }
    }
    // Stick: the ring abandons the pointer and parks on the element's centre, drifting
    // only a fraction of the way back toward where the pointer actually is.
    let aimX = pointer.x, aimY = pointer.y;
    if (stickBox) {
      const midX = stickBox.left + stickBox.width / 2;
      const midY = stickBox.top + stickBox.height / 2;
      if (stickMotion === 'rail') {
        // Titles and publication headings become a horizontal rail: the disc glides over the glyphs
        // but stays vertically seated on their optical centre.
        aimX = pointer.x;
        aimY = midY + (pointer.y - midY) * .025;
      } else {
        aimX = midX + (pointer.x - midX) * STICK_PULL;
        aimY = midY + (pointer.y - midY) * STICK_PULL;
      }
    }

    const captionTarget = captionText && captionText === pendingCaption ? 1 : 0;
    // The dot is the hit point. The disc is a lens — it is large, it lags the
    // pointer by design, and on a stuck element it deliberately is not on the
    // pointer at all, so over anything clickable the dot says where the click
    // will actually land. Off a target there is nothing to aim at and the disc
    // has the screen to itself. The caption and the click glyph both occupy the
    // same centre, so the dot yields to either.
    const dotTarget = hovered && !pendingCaption && !clickWanted ? 1 : 0;

    // A parked disc wants a slower, heavier settle than a cursor chasing the pointer:
    // 2.6Hz and slightly overdamped, so it glides in and holds instead of twitching.
    const followK = stickNode ? 260 : 520;
    const followD = stickNode ? 34 : 42;
    const followKX = stickMotion === 'rail' ? 920 : followK;
    const followDX = stickMotion === 'rail' ? 68 : followD;
    const followKY = stickMotion === 'rail' ? 340 : followK;
    const followDY = stickMotion === 'rail' ? 38 : followD;
    const sizeK = stickNode ? 520 : 760;
    const sizeD = stickNode ? 44 : 40;
    // heavy and just under critical, so it lags into place and settles back with one soft rebound
    const pullK = magnetNode === stickNode ? 300 : 600;
    const pullD = magnetNode === stickNode ? 30 : 44;

    while (carry >= STEP) {
      carry -= STEP;
      advance(ringX, aimX, followKX, followDX);
      advance(ringY, aimY, followKY, followDY);
      advance(dotX, pointer.x, 2400, 98);   // critically damped, near 1:1
      advance(dotY, pointer.y, 2400, 98);
      advance(scale, targetScale, sizeK, sizeD); // damping .72 — the state change gets a soft bounce
      advance(press, held, 1400, 64);
      advance(shell, awake, 900, 60);
      advance(dotShell, dotTarget, 900, 60);
      advance(captionFade, captionTarget, 900, 60);
      advance(clickFade, clickWanted ? 1 : 0, 900, 60);
      advance(pullX, wantX, pullK, pullD);
      advance(pullY, wantY, pullK, pullD);
      // Squash reads the ring's own velocity, so it is immune to mouse polling rate.
      const speed = Math.hypot(ringX.v, ringY.v);
      // a stuck disc barely moves; damp what squash is left so it does not shimmer
      advance(stretch, clamp(speed / 5200, 0, .26) * (stickNode ? .3 : 1), 900, 60);
      if (speed > 60) angle += shortestTurn(angle, Math.atan2(ringY.v, ringX.v)) * .12;
    }

    const settling = Math.abs(ringX.v) + Math.abs(ringY.v) + Math.abs(dotX.v) + Math.abs(dotY.v) > .5
      || Math.abs(scale.x - targetScale) > .0005 || Math.abs(press.x - held) > .0005
      || Math.abs(shell.x - awake) > .0005 || Math.abs(dotShell.x - dotTarget) > .0005
      || Math.abs(captionFade.x - captionTarget) > .0005 || Math.abs(clickFade.x - (clickWanted ? 1 : 0)) > .0005 || Math.abs(stretch.x) > .0005
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
      click.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${(1 - press.x * .1).toFixed(3)})`;
      click.style.opacity = (shell.x * clickFade.x).toFixed(3);
      window.liquidCursor?.setState({ x:ringX.x, y:ringY.x, scale:body, tone:liquidTone, precise:Boolean(hovered) });
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
    stickNode = null;
    stickMotion = '';
    targetScale = 1;
    pendingCaption = '';
    clickWanted = false;
    liquidTone = '';
    ring.classList.remove(...TONES);
  };

  addEventListener('pointermove', move, { passive:true });
  addEventListener('pointerdown', () => { held = 1; }, { passive:true });
  addEventListener('pointerup', () => { held = 0; }, { passive:true });
  addEventListener('pointercancel', () => { held = 0; }, { passive:true });
  addEventListener('blur', sleep);
  document.addEventListener('mouseleave', sleep);
  requestAnimationFrame(frame);
}

// Center the Work index in the viewport it snaps into. The padding is fixed, so
// a row opening on hover grows the section downward instead of nudging everything
// above it; to keep that open state centered, the table is measured as if its
// tallest row were already open, which parks the resting list a little high.
function setupWorkCentering() {
  const section = $('.work');
  const table = $('.work-table', section || undefined);
  if (!section || !table) return;
  const center = () => {
    const rail = $('.rail');
    const offset = rail && getComputedStyle(rail).position === 'sticky' ? rail.offsetHeight : 0;
    // on touch the summaries are always out, so they are already in the measure
    const opens = matchMedia('(hover:hover)').matches ? $$('.work-row', table).map((row) =>
      $$('.work-say,.work-award', row).reduce((sum, line, index) => sum
        + (line.classList.contains('work-say') ? Math.min(line.scrollHeight, 60) + 25 : Math.min(line.scrollHeight, 34) + (index > 1 ? 3 : 9)), 0)) : [];
    const last = section.lastElementChild;
    const content = last.offsetTop + last.offsetHeight - section.firstElementChild.offsetTop + Math.max(0, ...opens);
    section.style.setProperty('--work-pad', `${Math.max(0, Math.floor((innerHeight - offset - content) / 2))}px`);
  };
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(center); };
  center();
  document.fonts?.ready.then(schedule);
  addEventListener('resize', schedule, { passive:true });
}

loadGitHubContributions(); startClock(); loadDuolingoStatus(); setInterval(loadDuolingoStatus, 5 * 60 * 1000); setupDuolingoNudge(); setupHeadlineReveal(); setupRevealAndNav(); setupParallax(); setupPhotoGallery(); setupPhotoViewer(); setupRoleSwitcher(); setupCursorLens(); setupWorkCentering();
