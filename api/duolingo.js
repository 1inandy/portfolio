const USERNAME = 'andylin61500';
const TIME_ZONE = process.env.DUOLINGO_TIME_ZONE || 'America/New_York';

function dateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const url = new URL('https://www.duolingo.com/2017-06-30/users');
    url.searchParams.set('username', USERNAME);
    url.searchParams.set('fields', 'users{username,streak,streakData}');

    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) throw new Error(`Duolingo returned ${upstream.status}`);

    const { users = [] } = await upstream.json();
    const user = users[0];
    const currentStreak = user?.streakData?.currentStreak;
    if (!user || !currentStreak) throw new Error('No public streak data found');

    const today = dateInTimeZone(TIME_ZONE);
    response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({
      username: user.username,
      streak: currentStreak.length ?? user.streak ?? 0,
      didPracticeToday: currentStreak.endDate === today,
      lastPracticeDate: currentStreak.endDate,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Unable to load Duolingo status:', error);
    return response.status(502).json({ error: 'Duolingo status is temporarily unavailable' });
  }
}
