const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ESPN_EVENT_ID = process.env.ESPN_EVENT_ID || '401811957';

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': (type.includes('json') || type.includes('text/html')) ? 'no-store' : 'public, max-age=60'
  });
  res.end(body);
}

function normalizeScore(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().toUpperCase();
  if (/^(E|EVEN)(?:$|\s|\(|\[|\-|\/)/.test(text)) return 0;
  const match = text.match(/[+-]?\d+/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function statLabel(stat) {
  return [stat?.name, stat?.displayName, stat?.shortDisplayName, stat?.abbreviation, stat?.description]
    .filter(Boolean).join(' ').toLowerCase();
}

function statValue(entry, patterns) {
  const stats = Array.isArray(entry.statistics) ? entry.statistics : [];
  for (const stat of stats) {
    if (patterns.some(pattern => pattern.test(statLabel(stat)))) {
      return stat.displayValue ?? stat.value ?? stat.rankDisplayValue ?? null;
    }
  }
  return null;
}

function parseThru(entry, statusText) {
  const candidates = [
    entry.status?.displayThru,
    entry.status?.thru,
    entry.status?.displayValue,
    entry.status?.hole,
    entry.thru,
    entry.holesCompleted,
    statValue(entry, [/^thru$/, /holes? completed/, /through/])
  ];

  for (const value of candidates) {
    if (value == null || value === '') continue;
    const text = String(value).trim();
    if (/^(F|FINAL)$/i.test(text)) return 'F';
    const match = text.match(/(?:THRU\s*)?(\d{1,2})/i);
    if (match) {
      const holes = Number(match[1]);
      if (holes >= 1 && holes <= 18) return String(holes);
    }
  }

  if (/FINAL|COMPLETE|FINISH/i.test(statusText)) return 'F';
  return '';
}

function parseHoleList(round, coursePars) {
  const source = [round?.holes, round?.holeScores, round?.linescores, round?.scores]
    .find(value => Array.isArray(value) && value.length > 0) || [];

  return source.map((hole, index) => {
    const number = Number(hole?.hole ?? hole?.number ?? hole?.period ?? index + 1);
    if (!Number.isFinite(number) || number < 1 || number > 18) return null;
    const par = Number(hole?.par ?? hole?.shotsToPar ?? coursePars[number - 1]?.par ?? coursePars[number - 1]?.shotsToPar);
    const strokes = Number(hole?.strokes ?? hole?.score?.value ?? hole?.value ?? hole?.rawScore);
    const relative = normalizeScore(hole?.toPar ?? hole?.scoreToPar ?? hole?.displayValue);
    return {
      hole: number,
      par: Number.isFinite(par) ? par : null,
      strokes: Number.isFinite(strokes) ? strokes : null,
      relative: relative != null ? relative : (Number.isFinite(strokes) && Number.isFinite(par) ? strokes - par : null)
    };
  }).filter(Boolean).sort((a, b) => a.hole - b.hole);
}

function parseRoundScores(entry, coursePars) {
  const sources = [entry.linescores, entry.rounds, entry.scores].find(Array.isArray) || [];
  return sources.map((round, index) => {
    const roundNumber = Number(round?.period ?? round?.round ?? round?.number ?? index + 1);
    const strokes = Number(round?.value ?? round?.strokes ?? round?.score?.value ?? round?.rawScore);
    const toPar = normalizeScore(
      round?.displayValue ?? round?.score?.displayValue ?? round?.toPar ?? round?.scoreToPar
    );
    const holes = parseHoleList(round, coursePars);
    return {
      round: roundNumber,
      score: toPar,
      strokes: Number.isFinite(strokes) ? strokes : null,
      inScore: Number.isFinite(Number(round?.inScore)) ? Number(round.inScore) : null,
      outScore: Number.isFinite(Number(round?.outScore)) ? Number(round.outScore) : null,
      holes
    };
  }).filter(round => round.round >= 1 && round.round <= 4);
}

function normalizeEntry(entry, coursePars) {
  const athlete = entry.athlete || entry.competitor?.athlete || entry.competitor || entry.player || entry;
  const name = athlete.displayName || athlete.fullName || athlete.name || entry.displayName || entry.fullName;
  if (!name || typeof name !== 'string') return null;

  const rawStatus = entry.status?.type?.description || entry.status?.type?.detail || entry.status?.description || entry.status?.detail || entry.status?.displayValue || entry.status || '';
  const statusText = String(rawStatus);
  const upperStatus = statusText.toUpperCase();
  // ESPN's entry.score is not consistently the tournament-to-par value.
  // The scoreToPar statistic is the reliable total used on ESPN's leaderboard.
  const score = normalizeScore(
    statValue(entry, [/^scoretopar$/, /score to par/, /^to par$/]) ??
    entry.toPar ??
    entry.score?.displayValue ??
    entry.score
  );
  const round = Number(entry.status?.period ?? entry.round ?? entry.currentRound ?? 0) || null;
  const thru = parseThru(entry, statusText);
  const teeTime = entry.status?.teeTime || entry.teeTime || '';
  const rounds = parseRoundScores(entry, coursePars);

  // ESPN exposes the current-round score in status.todayDetail, such as "-3(F)".
  // This is more reliable than trying to infer it from the tournament-total score.
  const today = normalizeScore(
    entry.status?.todayDetail ??
    entry.todayDetail ??
    statValue(entry, [/^today$/, /today score/, /current round/]) ??
    rounds.find(item => item.round === round)?.score
  );

  const position = String(
    entry.status?.position?.displayName ??
    entry.position?.displayValue ??
    entry.position ??
    (entry.sortOrder ? entry.sortOrder : '') ??
    ''
  );

  let status = 'active';
  if (/CUT|MC/.test(upperStatus)) status = 'cut';
  else if (/WD|WITHDRAW/.test(upperStatus)) status = 'wd';
  else if (/DQ|DISQUAL/.test(upperStatus)) status = 'dq';
  else if (/FINAL|COMPLETE|FINISH/.test(upperStatus)) status = 'finished';

  const thruNumber = thru === 'F' ? 18 : Number(thru || 0);
  const holesPlayed = round ? Math.min(72, Math.max(0, (round - 1) * 18 + thruNumber)) : 0;

  return {
    id: String(athlete.id || entry.id || ''),
    name,
    score,
    today,
    position,
    thru,
    round: round ? String(round) : '',
    holesPlayed,
    status,
    statusText,
    teeTime,
    rounds,
    scorecardUrl: `https://www.espn.com/golf/leaderboard?tournamentId=${ESPN_EVENT_ID}`
  };
}

function findEvent(json) {
  const events = Array.isArray(json.events) ? json.events : [];
  return events.find(event => String(event.id) === String(ESPN_EVENT_ID)) || events.find(event => event.primary) || events[0] || null;
}

function getCompetition(json) {
  const event = findEvent(json);
  return event?.competitions?.[0] || json.competitions?.[0] || json.leaderboard?.competitions?.[0] || null;
}

function coursePars(json) {
  const competition = getCompetition(json);
  const holes = competition?.courses?.[0]?.holes || [];
  return holes.map(hole => ({
    hole: Number(hole.number),
    par: Number(hole.shotsToPar),
    yards: Number(hole.totalYards)
  }));
}

function extractEntries(json) {
  const competition = getCompetition(json);
  if (Array.isArray(competition?.competitors) && competition.competitors.length) return competition.competitors;
  if (Array.isArray(json.leaderboard?.competitors) && json.leaderboard.competitors.length) return json.leaderboard.competitors;
  if (Array.isArray(json.competitors) && json.competitors.length) return json.competitors;
  return [];
}

function eventName(json) {
  const event = findEvent(json);
  return event?.name || event?.shortName || 'Current PGA Tournament';
}

async function fetchLeaderboard() {
  const urls = [
    'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard',
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?region=us&lang=en'
  ];
  let lastError = '';

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      const selectedEvent = findEvent(json);
      if (!selectedEvent) throw new Error('No golf event was returned by ESPN.');
      if (String(selectedEvent.id) !== String(ESPN_EVENT_ID)) {
        throw new Error(`ESPN did not return requested event ${ESPN_EVENT_ID}; received ${selectedEvent.id}.`);
      }
      const pars = coursePars(json);
      const players = extractEntries(json).map(entry => normalizeEntry(entry, pars)).filter(Boolean);
      if (players.length >= 20) {
        return {
          source: 'ESPN',
          updatedAt: new Date().toISOString(),
          eventName: eventName(json),
          course: getCompetition(json)?.courses?.[0]?.name || '',
          coursePars: pars,
          players
        };
      }
      lastError = `Endpoint returned only ${players.length} recognizable players.`;
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError || 'No live data source responded.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/leaderboard') {
    try { send(res, 200, JSON.stringify(await fetchLeaderboard())); }
    catch (error) { send(res, 502, JSON.stringify({ error: error.message, updatedAt: new Date().toISOString() })); }
    return;
  }

  let relative = url.pathname === '/' ? '/index.html' : url.pathname;
  relative = path.normalize(relative).replace(/^([.][.][/\\])+/, '');
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain');
    const extension = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
    send(res, 200, data, types[extension] || 'application/octet-stream');
  });
});

server.listen(PORT, () => console.log(`Caveman PGA Draft Game running at http://localhost:${PORT}`));
