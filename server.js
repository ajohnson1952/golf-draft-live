const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ESPN_EVENT_ID = process.env.ESPN_EVENT_ID || '401811957';
const ESPN_TOUR = process.env.ESPN_TOUR || 'pga';
const PLAYER_SUMMARY_CACHE_MS = 30 * 1000;
const playerSummaryCache = new Map();

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

  const statusType = entry.status?.type || {};
  const isCompleted = statusType.completed === true || String(statusType.state || '').toLowerCase() === 'post';
  if (isCompleted && /FINAL|COMPLETE|FINISH/i.test(statusText)) return 'F';
  return '';
}


function formatCentralTeeTime(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return text;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(timestamp));
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parseHoleArray(source, coursePars) {
  if (!Array.isArray(source) || !source.length) return [];
  const parsed = source.map((hole, index) => {
    const number = Number(hole?.hole ?? hole?.holeNumber ?? hole?.number ?? hole?.period ?? index + 1);
    if (!Number.isFinite(number) || number < 1 || number > 18) return null;
    const par = toFiniteNumber(hole?.par ?? hole?.shotsToPar ?? coursePars[number - 1]?.par ?? coursePars[number - 1]?.shotsToPar);
    const strokes = toFiniteNumber(
      hole?.strokes ?? hole?.score?.value ?? hole?.score?.displayValue ?? hole?.value ??
      hole?.rawScore ?? hole?.displayValue ?? hole?.result?.value
    );
    const relative = normalizeScore(hole?.toPar ?? hole?.scoreToPar ?? hole?.relativeToPar ?? hole?.result?.displayValue);
    return {
      hole: number,
      par,
      strokes,
      relative: relative != null ? relative : (strokes != null && par != null ? strokes - par : null)
    };
  }).filter(Boolean);

  const unique = new Map();
  parsed.forEach(hole => {
    const existing = unique.get(hole.hole);
    if (!existing || (existing.strokes == null && hole.strokes != null)) unique.set(hole.hole, hole);
  });
  return [...unique.values()].sort((a, b) => a.hole - b.hole);
}

function findHoleData(node, coursePars, depth = 0) {
  if (!node || depth > 6) return [];
  if (Array.isArray(node)) {
    const direct = parseHoleArray(node, coursePars);
    const completed = direct.filter(hole => hole.strokes != null);
    if (completed.length >= 1 && direct.length <= 18) return direct;
    for (const child of node) {
      const nested = findHoleData(child, coursePars, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }
  if (typeof node !== 'object') return [];

  const preferredKeys = ['holes', 'holeScores', 'holeByHole', 'scorecard', 'scores', 'linescores', 'periods'];
  for (const key of preferredKeys) {
    if (node[key] != null) {
      const found = findHoleData(node[key], coursePars, depth + 1);
      if (found.length) return found;
    }
  }
  for (const value of Object.values(node)) {
    const found = findHoleData(value, coursePars, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function parseHoleList(round, coursePars) {
  return findHoleData(round, coursePars);
}

function parseRoundScores(entry, coursePars) {
  const possible = [entry.rounds, entry.roundScores, entry.scorecard?.rounds, entry.linescores, entry.scores]
    .find(value => Array.isArray(value) && value.length > 0) || [];

  const looksLikeHoleArray = possible.length > 4 && possible.every((item, index) => {
    const number = Number(item?.hole ?? item?.holeNumber ?? item?.period ?? index + 1);
    return number >= 1 && number <= 18;
  });

  if (looksLikeHoleArray) {
    const roundNumber = Number(entry.status?.period ?? entry.round ?? entry.currentRound ?? 1) || 1;
    return [{ round: roundNumber, score: null, strokes: null, inScore: null, outScore: null, holes: parseHoleArray(possible, coursePars) }];
  }

  return possible.map((round, index) => {
    const roundNumber = Number(round?.period ?? round?.round ?? round?.number ?? index + 1);
    const strokes = toFiniteNumber(round?.value ?? round?.strokes ?? round?.score?.value ?? round?.rawScore);
    const toPar = normalizeScore(round?.displayValue ?? round?.score?.displayValue ?? round?.toPar ?? round?.scoreToPar);
    return {
      round: roundNumber,
      score: toPar,
      strokes,
      inScore: toFiniteNumber(round?.inScore),
      outScore: toFiniteNumber(round?.outScore),
      holes: parseHoleList(round, coursePars)
    };
  }).filter(round => round.round >= 1 && round.round <= 4);
}

function mergeRoundDetails(primaryRounds, supplementalRounds) {
  const rounds = new Map();
  [...(primaryRounds || []), ...(supplementalRounds || [])].forEach(round => {
    if (!round?.round) return;
    const existing = rounds.get(round.round) || {};
    const existingHoles = Array.isArray(existing.holes) ? existing.holes : [];
    const newHoles = Array.isArray(round.holes) ? round.holes : [];
    rounds.set(round.round, {
      ...existing,
      ...round,
      score: round.score ?? existing.score ?? null,
      strokes: round.strokes ?? existing.strokes ?? null,
      holes: newHoles.filter(h => h.strokes != null).length >= existingHoles.filter(h => h.strokes != null).length ? newHoles : existingHoles
    });
  });
  return [...rounds.values()].sort((a, b) => a.round - b.round);
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
  let thru = parseThru(entry, statusText);
  const rawTeeTime = entry.status?.teeTime || entry.teeTime || '';
  const teeTime = formatCentralTeeTime(rawTeeTime);
  const rounds = parseRoundScores(entry, coursePars);

  const statusType = entry.status?.type || {};
  const statusState = String(statusType.state || '').toLowerCase();
  const statusName = String(statusType.name || statusType.description || statusType.detail || '').toLowerCase();
  const teeTimestamp = Date.parse(String(rawTeeTime || ''));
  const teeTimeIsFuture = Number.isFinite(teeTimestamp) && teeTimestamp > Date.now() + 60 * 1000;
  const explicitlyPreRound = statusState === 'pre' || /scheduled|not started|pre-event|pre round/.test(statusName);

  // ESPN sometimes leaves displayThru='F' from the prior round while already
  // labeling the golfer as being in the next round. A future tee time or an
  // explicit pre-round state must win over that stale prior-round value.
  const scheduledNotStarted = explicitlyPreRound || teeTimeIsFuture;
  if (scheduledNotStarted) thru = '';

  const explicitlyCompleted = !scheduledNotStarted && (statusType.completed === true || statusState === 'post');
  const hasStartedRound = !scheduledNotStarted && (thru === 'F' || Number(thru) > 0 || statusState === 'in');

  // Do not borrow a round-summary score for a golfer who has not teed off yet.
  // ESPN can expose a current-round number and a generic "Finish" description
  // before the golfer's scheduled tee time.
  const today = hasStartedRound || explicitlyCompleted ? normalizeScore(
    entry.status?.todayDetail ??
    entry.todayDetail ??
    statValue(entry, [/^today$/, /today score/, /current round/]) ??
    rounds.find(item => item.round === round)?.score
  ) : null;

  const position = String(
    entry.status?.position?.displayName ??
    entry.position?.displayValue ??
    entry.position ??
    (entry.sortOrder ? entry.sortOrder : '') ??
    ''
  );

  const groupId = String(
    entry.group?.id ??
    entry.groupId ??
    entry.status?.groupId ??
    entry.pairing?.id ??
    ''
  );
  const sourceGroupLabel = String(
    entry.group?.displayName ??
    entry.group?.name ??
    entry.pairing?.displayName ??
    ''
  );
  const groupLabel = teeTime
    ? `${sourceGroupLabel ? `${sourceGroupLabel} · ` : ''}Tee time ${teeTime}`
    : sourceGroupLabel;
  const groupKey = groupId || (rawTeeTime && round ? `${round}|${rawTeeTime}` : '');

  let status = 'active';
  if (/CUT|MC/.test(upperStatus)) status = 'cut';
  else if (/WD|WITHDRAW/.test(upperStatus)) status = 'wd';
  else if (/DQ|DISQUAL/.test(upperStatus)) status = 'dq';
  else if (thru === 'F' || (explicitlyCompleted && /FINAL|COMPLETE|FINISH/i.test(statusText))) status = 'finished';

  const thruNumber = thru === 'F' ? 18 : Number(thru || 0);
  const holesPlayed = round ? Math.min(72, Math.max(0, (round - 1) * 18 + thruNumber)) : 0;

  const athleteId = String(athlete.id || entry.id || '');
  const suppliedHeadshot = athlete.headshot?.href || entry.headshot?.href ||
    (typeof athlete.headshot === 'string' ? athlete.headshot : '') ||
    (typeof entry.headshot === 'string' ? entry.headshot : '');
  const headshot = suppliedHeadshot ||
    (athleteId ? `https://a.espncdn.com/i/headshots/golf/players/full/${athleteId}.png` : '');

  return {
    id: athleteId,
    headshot,
    name,
    score,
    today,
    position,
    thru,
    round: round ? String(round) : '',
    holesPlayed,
    status,
    statusText,
    started: hasStartedRound || explicitlyCompleted,
    scheduledNotStarted,
    teeTime,
    rawTeeTime,
    groupId,
    groupKey,
    groupLabel,
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
          eventId: String(selectedEvent.id),
          season: Number(selectedEvent.season?.year || selectedEvent.season || new Date().getFullYear()),
          tour: ESPN_TOUR,
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


function normalizeHole(hole, index) {
  const holeNumber = Number(hole?.period ?? hole?.hole ?? hole?.holeNumber ?? index + 1);
  const strokes = toFiniteNumber(hole?.value ?? hole?.displayValue ?? hole?.score?.value);
  const par = toFiniteNumber(hole?.par ?? hole?.shotsToPar);
  return {
    hole: holeNumber,
    strokes,
    par,
    relative: strokes != null && par != null
      ? strokes - par
      : normalizeScore(hole?.scoreType?.displayValue ?? hole?.toPar ?? hole?.scoreToPar),
    scoreType: hole?.scoreType?.name || hole?.scoreType?.displayName || ''
  };
}

function normalizeRound(round, index) {
  const rawHoles = Array.isArray(round?.linescores)
    ? round.linescores
    : Array.isArray(round?.holes)
      ? round.holes
      : [];
  const holes = rawHoles
    .map(normalizeHole)
    .filter(hole => Number.isFinite(hole.hole) && hole.hole >= 1 && hole.hole <= 18)
    .sort((a, b) => a.hole - b.hole);

  return {
    round: Number(round?.period ?? round?.round ?? index + 1),
    strokes: toFiniteNumber(round?.value ?? round?.strokes),
    score: normalizeScore(round?.displayValue ?? round?.toPar ?? round?.scoreToPar),
    inScore: toFiniteNumber(round?.inScore),
    outScore: toFiniteNumber(round?.outScore),
    holes
  };
}

function normalizeCoreLinescores(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const rounds = items
    .map(normalizeRound)
    .filter(round => round.round >= 1 && round.round <= 4 && round.holes.length);
  return {
    source: 'core-linescores',
    playerId: '',
    playerName: '',
    rounds,
    diagnostics: {
      source: 'core-linescores',
      roundCount: rounds.length,
      holeCount: rounds.reduce((sum, round) => sum + round.holes.length, 0)
    }
  };
}

function normalizePlayerSummary(json) {
  const rawRounds = Array.isArray(json?.rounds) ? json.rounds : [];
  const rounds = rawRounds
    .map(normalizeRound)
    .filter(round => round.round >= 1 && round.round <= 4 && round.holes.length);
  return {
    source: 'web-player-summary',
    playerId: String(json?.profile?.id || ''),
    playerName: json?.profile?.displayName || '',
    rounds,
    diagnostics: {
      source: 'web-player-summary',
      roundCount: rounds.length,
      holeCount: rounds.reduce((sum, round) => sum + round.holes.length, 0)
    }
  };
}

async function fetchJson(endpoint) {
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CavemanGolfDraft/1.0)',
      'Accept': 'application/json, text/plain, */*'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const excerpt = text.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`${response.status}${excerpt ? `: ${excerpt}` : ''}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('ESPN returned a non-JSON response.');
  }
}

async function fetchPlayerSummary(playerId, season, eventId = ESPN_EVENT_ID, tour = ESPN_TOUR) {
  if (!/^\d+$/.test(String(playerId || ''))) throw new Error('A valid ESPN player ID is required.');
  const safeSeason = /^\d{4}$/.test(String(season || '')) ? String(season) : String(new Date().getFullYear());
  const safeEvent = /^\d+$/.test(String(eventId || '')) ? String(eventId) : ESPN_EVENT_ID;
  const safeTour = /^(pga|lpga|liv|eur|champions-tour|ntw|mens-olympics-golf|womens-olympics-golf|tgl)$/i.test(String(tour || ''))
    ? String(tour).toLowerCase()
    : ESPN_TOUR;
  const cacheKey = `${safeTour}|${safeEvent}|${safeSeason}|${playerId}`;
  const cached = playerSummaryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < PLAYER_SUMMARY_CACHE_MS) return cached.data;

  const attempts = [];
  const endpoints = [
    {
      source: 'core-linescores',
      url: `https://sports.core.api.espn.com/v2/sports/golf/leagues/${safeTour}/events/${safeEvent}/competitions/${safeEvent}/competitors/${encodeURIComponent(playerId)}/linescores?lang=en&region=us&limit=10`,
      normalize: normalizeCoreLinescores
    },
    {
      source: 'web-player-summary',
      url: `https://site.web.api.espn.com/apis/site/v2/sports/golf/${safeTour}/leaderboard/${safeEvent}/playersummary?season=${safeSeason}&player=${encodeURIComponent(playerId)}`,
      normalize: normalizePlayerSummary
    }
  ];

  for (const endpoint of endpoints) {
    try {
      const json = await fetchJson(endpoint.url);
      const data = endpoint.normalize(json);
      if (data.rounds.length && data.diagnostics.holeCount > 0) {
        data.playerId = data.playerId || String(playerId);
        data.diagnostics.attempts = attempts;
        playerSummaryCache.set(cacheKey, { savedAt: Date.now(), data });
        return data;
      }
      attempts.push({ source: endpoint.source, result: 'no-hole-data' });
    } catch (error) {
      attempts.push({ source: endpoint.source, result: error.message });
    }
  }

  const detail = attempts.map(attempt => `${attempt.source}: ${attempt.result}`).join('; ');
  const error = new Error(`ESPN did not return hole-by-hole scoring. ${detail}`);
  error.diagnostics = { attempts };
  throw error;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/leaderboard') {
    try { send(res, 200, JSON.stringify(await fetchLeaderboard())); }
    catch (error) { send(res, 502, JSON.stringify({ error: error.message, updatedAt: new Date().toISOString() })); }
    return;
  }

  if (url.pathname === '/api/player-summary') {
    try {
      const data = await fetchPlayerSummary(
        url.searchParams.get('player'),
        url.searchParams.get('season'),
        url.searchParams.get('eventId'),
        url.searchParams.get('tour')
      );
      send(res, 200, JSON.stringify(data));
    } catch (error) {
      send(res, 502, JSON.stringify({ error: error.message }));
    }
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
