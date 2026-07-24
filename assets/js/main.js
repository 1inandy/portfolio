import { mountAmbientTree } from './ambient-tree.js';

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

function setupRevealAndNav() {
  const reveal = $$('[data-reveal]');
  const nav = $$('[data-nav]');
  const show = (entry) => entry.target.classList.add('is-revealed');
  const revealObserver = new IntersectionObserver((entries, observer) => entries.forEach((entry) => { if (entry.isIntersecting) { show(entry); observer.unobserve(entry.target); } }), { threshold:.08 });
  reveal.forEach((item) => revealObserver.observe(item));
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
  const lens = $('.cursor-lens');
  if (!lens || matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;

  const pointer = { x:innerWidth / 2, y:innerHeight / 2, active:false };
  const lensPosition = { x:pointer.x, y:pointer.y };
  let lastFrame = performance.now();
  const move = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    lens.style.opacity = '1';
  };
  const draw = (now) => {
    const elapsed = Math.min(32, now - lastFrame) / 16.67;
    lastFrame = now;
    lensPosition.x += (pointer.x - lensPosition.x) * Math.min(1, .32 * elapsed);
    lensPosition.y += (pointer.y - lensPosition.y) * Math.min(1, .32 * elapsed);
    lens.style.transform = `translate3d(${lensPosition.x}px, ${lensPosition.y}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(draw);
  };

  document.documentElement.classList.add('has-cursor-lens');
  addEventListener('pointermove', move, { passive:true });
  addEventListener('blur', () => { pointer.active = false; lens.style.opacity = '0'; });
  requestAnimationFrame(draw);
}

loadGitHubContributions(); startClock(); loadDuolingoStatus(); setInterval(loadDuolingoStatus, 5 * 60 * 1000); setupDuolingoNudge(); setupRevealAndNav(); setupPhotoGallery(); setupRoleSwitcher(); setupCursorLens(); mountAmbientTree($('#ambient-tree'));
