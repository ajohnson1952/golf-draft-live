const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ESPN_EVENT_ID = process.env.ESPN_EVENT_ID || '401811957';

function send(res,status,body,type='application/json') {
  res.writeHead(status, {'Content-Type':type, 'Cache-Control':type.includes('json') ? 'no-store' : 'public, max-age=300'});
  res.end(body);
}

function normalizeScore(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().toUpperCase();
  if (text === 'E' || text === 'EVEN') return 0;
  const number = Number(text.replace('+',''));
  return Number.isFinite(number) ? number : null;
}

function statValue(entry,patterns) {
  const stats = Array.isArray(entry.statistics) ? entry.statistics : [];
  for (const stat of stats) {
    const label = [stat.name,stat.displayName,stat.shortDisplayName,stat.abbreviation,stat.description].filter(Boolean).join(' ').toLowerCase();
    if (patterns.some(pattern => pattern.test(label))) return stat.displayValue ?? stat.value ?? stat.rankDisplayValue ?? null;
  }
  return null;
}

function parseThru(entry,statusText) {
  const stat = statValue(entry,[/^thru$/, /holes? completed/, /through/]);
  const candidates = [stat, entry.thru, entry.holesCompleted, entry.status?.displayClock, entry.status?.type?.shortDetail];
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
  if (/FINAL|COMPLETE|FINISHED/i.test(statusText)) return 'F';
  return '';
}

function normalizeEntry(entry) {
  const athlete = entry.athlete || entry.competitor?.athlete || entry.competitor || entry.player || entry;
  const name = athlete.displayName || athlete.fullName || athlete.name || entry.displayName || entry.fullName;
  if (!name || typeof name !== 'string') return null;

  const rawStatus = entry.status?.type?.description || entry.status?.type?.detail || entry.status?.description || entry.status?.displayValue || entry.status || '';
  const statusText = String(rawStatus);
  const upperStatus = statusText.toUpperCase();
  const score = normalizeScore(
    entry.score?.displayValue ??
    entry.score ??
    entry.toPar ??
    statValue(entry,[/score to par/, /to par/, /^score$/])
  );
  const round = entry.status?.period ?? entry.round ?? entry.currentRound ?? '';
  const thru = parseThru(entry,statusText);
  const teeTime = entry.teeTime || entry.status?.type?.shortDetail || '';

  let status = 'active';
  if (/CUT|MC/.test(upperStatus)) status = 'cut';
  else if (/WD|WITHDRAW/.test(upperStatus)) status = 'wd';
  else if (/DQ|DISQUAL/.test(upperStatus)) status = 'dq';
  else if (/FINAL|COMPLETE|FINISHED/.test(upperStatus)) status = 'finished';

  return {name,score,thru,round:String(round || ''),status,statusText,teeTime};
}

function getCompetition(json) {
  return json.events?.[0]?.competitions?.[0] || json.competitions?.[0] || json.leaderboard?.competitions?.[0] || null;
}

function extractEntries(json) {
  const competition = getCompetition(json);
  if (Array.isArray(competition?.competitors) && competition.competitors.length) return competition.competitors;
  if (Array.isArray(json.leaderboard?.competitors) && json.leaderboard.competitors.length) return json.leaderboard.competitors;
  if (Array.isArray(json.competitors) && json.competitors.length) return json.competitors;
  return [];
}

function eventName(json) {
  return json.events?.[0]?.name || json.events?.[0]?.shortName || json.leagues?.[0]?.name || 'Current PGA Tournament';
}

async function fetchLeaderboard() {
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?league=pga&event=${ESPN_EVENT_ID}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?league=pga&event=${ESPN_EVENT_ID}`,
    `https://site.web.api.espn.com/apis/fittwo/v3/sports/golf/pga/leaderboard?region=us&lang=en&event=${ESPN_EVENT_ID}`
  ];
  let lastError = '';

  for (const url of urls) {
    try {
      const response = await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      const players = extractEntries(json).map(normalizeEntry).filter(Boolean);
      if (players.length >= 20) {
        return {source:'ESPN',updatedAt:new Date().toISOString(),eventName:eventName(json),players};
      }
      lastError = `Endpoint returned only ${players.length} recognizable players.`;
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError || 'No live data source responded.');
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,`http://${req.headers.host}`);
  if (url.pathname === '/api/leaderboard') {
    try { send(res,200,JSON.stringify(await fetchLeaderboard())); }
    catch (error) { send(res,502,JSON.stringify({error:error.message,updatedAt:new Date().toISOString()})); }
    return;
  }

  let relative = url.pathname === '/' ? '/index.html' : url.pathname;
  relative = path.normalize(relative).replace(/^([.][.][/\\])+/, '');
  const file = path.join(ROOT,relative);
  if (!file.startsWith(ROOT)) return send(res,403,'Forbidden','text/plain');

  fs.readFile(file,(error,data) => {
    if (error) return send(res,404,'Not found','text/plain');
    const extension = path.extname(file);
    const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml'};
    send(res,200,data,types[extension] || 'application/octet-stream');
  });
});

server.listen(PORT,() => console.log(`Caveman PGA Draft Game running at http://localhost:${PORT}`));
