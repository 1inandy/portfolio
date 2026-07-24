const USERNAME = '1inandy';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upstream = await fetch(`https://github.com/users/${USERNAME}/contributions`, {
      headers: { 'User-Agent': 'Andy-Portfolio-Contribution-Widget', Accept: 'text/html' }
    });
    if (!upstream.ok) throw new Error(`GitHub returned ${upstream.status}`);

    response.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.status(200).send(await upstream.text());
  } catch (error) {
    console.error('Unable to load GitHub contributions:', error);
    return response.status(502).json({ error: 'GitHub contributions are temporarily unavailable' });
  }
}
