const DUOLINGO_USERNAME = 'andylin61500';
const GITHUB_USERNAME = '1inandy';
const COOLDOWN_MS = 15 * 60 * 1000;
const GLOBAL_COOLDOWN_MS = 60 * 1000;
const MAX_TRACKED_VISITORS = 10_000;
const recentNudges = new Map();
let lastGlobalNudge = 0;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  }
});

function dateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function duolingoStatus(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  }

  try {
    const url = new URL('https://www.duolingo.com/2017-06-30/users');
    url.searchParams.set('username', DUOLINGO_USERNAME);
    url.searchParams.set('fields', 'users{username,streak,streakData}');
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) throw new Error(`Duolingo returned ${upstream.status}`);

    const { users = [] } = await upstream.json();
    const user = users[0];
    const currentStreak = user?.streakData?.currentStreak;
    if (!user || !currentStreak) throw new Error('No public streak data found');

    const today = dateInTimeZone(env.DUOLINGO_TIME_ZONE || 'America/New_York');
    return json({
      username: user.username,
      streak: currentStreak.length ?? user.streak ?? 0,
      didPracticeToday: currentStreak.endDate === today,
      lastPracticeDate: currentStreak.endDate,
      checkedAt: new Date().toISOString()
    }, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  } catch (error) {
    console.error('Unable to load Duolingo status:', error);
    return json({ error: 'Duolingo status is temporarily unavailable' }, 502);
  }
}

async function githubContributions(request) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  }

  try {
    const upstream = await fetch(`https://github.com/users/${GITHUB_USERNAME}/contributions`, {
      headers: {
        'User-Agent': 'Andy-Portfolio-Contribution-Widget',
        Accept: 'text/html'
      }
    });
    if (!upstream.ok) throw new Error(`GitHub returned ${upstream.status}`);

    return new Response(await upstream.text(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch (error) {
    console.error('Unable to load GitHub contributions:', error);
    return json({ error: 'GitHub contributions are temporarily unavailable' }, 502);
  }
}

function validatedWebhookUrl(value) {
  if (!value || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    const validHost = url.hostname === 'discord.com' || url.hostname.endsWith('.discord.com');
    const validPath = /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname);
    if (url.protocol !== 'https:' || !validHost || url.port || url.username || url.password || !validPath) return null;
    return url;
  } catch {
    return null;
  }
}

function pruneNudges(now) {
  for (const [key, timestamp] of recentNudges) {
    if (now - timestamp >= COOLDOWN_MS) recentNudges.delete(key);
  }
  if (recentNudges.size >= MAX_TRACKED_VISITORS) recentNudges.clear();
}

async function duolingoNudge(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  const webhookUrl = validatedWebhookUrl(env.DISCORD_DUOLINGO_WEBHOOK_URL);
  if (!webhookUrl) return json({ error: 'Reminders are not configured yet' }, 503);

  const key = (request.headers.get('CF-Connecting-IP') || 'unknown').trim().slice(0, 128);
  const now = Date.now();
  pruneNudges(now);

  if (now - lastGlobalNudge < GLOBAL_COOLDOWN_MS) {
    const retryAfter = Math.ceil((GLOBAL_COOLDOWN_MS - (now - lastGlobalNudge)) / 1000);
    return json({ error: 'A reminder was just sent — please try again shortly' }, 429, {
      'Retry-After': String(retryAfter)
    });
  }

  const lastNudge = recentNudges.get(key);
  if (lastNudge && now - lastNudge < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (now - lastNudge)) / 60_000);
    return json({ error: `Try again in ${retryAfter} minute${retryAfter === 1 ? '' : 's'}` }, 429, {
      'Retry-After': String(retryAfter * 60)
    });
  }

  try {
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '🔔 I need to do a Duolingo lesson — this is a reminder from my portfolio.'
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!upstream.ok) throw new Error(`Discord returned ${upstream.status}`);

    recentNudges.set(key, now);
    lastGlobalNudge = now;
    return json({ ok: true });
  } catch (error) {
    console.error('Unable to send Duolingo reminder:', error);
    return json({ error: 'Could not send the reminder' }, 502);
  }
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/duolingo') return duolingoStatus(request, env);
    if (url.pathname === '/api/duolingo-nudge') return duolingoNudge(request, env);
    if (url.pathname === '/api/github-contributions') return githubContributions(request);

    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === '/') assetUrl.pathname = '/index.html';
    const assetRequest = new Request(assetUrl, request);
    return withSecurityHeaders(await env.ASSETS.fetch(assetRequest));
  }
};
