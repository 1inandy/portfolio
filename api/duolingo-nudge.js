const WEBHOOK_URL = process.env.DISCORD_DUOLINGO_WEBHOOK_URL;
const RATE_LIMIT_DISABLED = false;
const COOLDOWN_MS = 15 * 60 * 1000;
const GLOBAL_COOLDOWN_MS = 60 * 1000;
const MAX_TRACKED_VISITORS = 10_000;
const recentNudges = new Map();
let lastGlobalNudge = 0;

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

function clientKey(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const address = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  // Keep the tracking key bounded. It is only used for rate limiting, never displayed or persisted.
  return (address || request.socket?.remoteAddress || 'unknown').trim().slice(0, 128);
}

function pruneNudges(now) {
  for (const [key, timestamp] of recentNudges) {
    if (now - timestamp >= COOLDOWN_MS) recentNudges.delete(key);
  }
  if (recentNudges.size >= MAX_TRACKED_VISITORS) recentNudges.clear();
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const webhookUrl = validatedWebhookUrl(WEBHOOK_URL);
  if (!webhookUrl) {
    return response.status(503).json({ error: 'Reminders are not configured yet' });
  }

  const key = clientKey(request);
  const now = Date.now();
  pruneNudges(now);
  if (!RATE_LIMIT_DISABLED && now - lastGlobalNudge < GLOBAL_COOLDOWN_MS) {
    const retryAfter = Math.ceil((GLOBAL_COOLDOWN_MS - (now - lastGlobalNudge)) / 1000);
    response.setHeader('Retry-After', String(retryAfter));
    return response.status(429).json({ error: 'A reminder was just sent — please try again shortly' });
  }
  const lastNudge = recentNudges.get(key);
  if (!RATE_LIMIT_DISABLED && lastNudge && now - lastNudge < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (now - lastNudge)) / 60000);
    response.setHeader('Retry-After', String(retryAfter * 60));
    return response.status(429).json({ error: `Try again in ${retryAfter} minute${retryAfter === 1 ? '' : 's'}` });
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
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Unable to send Duolingo reminder:', error);
    return response.status(502).json({ error: 'Could not send the reminder' });
  }
}
