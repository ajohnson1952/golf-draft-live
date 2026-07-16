const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ESPN_EVENT_ID = process.env.ESPN_EVENT_ID || '401811957';

function send(res, status, body, type='application/json') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': type.includes('json') ? 'no-store' : 'public, max-age=300'});
  res.end(body);
}

function normalizeScore(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'E' || s === 'EVEN') return 0;
  const n = Number(s.replace('+',''));
  return Number.isFinite(n) ? n : null;
}

function findEntries(obj) {
  const candidates = [];
  const seen = new Set();
  function walk(x, depth=0) {
    if (!x || typeof x !== 'object' || depth > 10 || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      if (x.length && x.some(y => y && typeof y === 'object') && x.some(y => {
        const z = y || {};
        return z.athlete || z.competitor || z.player || z.displayName || z.fullName;
      })) candidates.push(x);
      x.forEach(y => walk(y, depth+1));
    } else Object.values(x).forEach(y => walk(y, depth+1));
  }
  walk(obj);
  return candidates.sort((a,b)=>b.length-a.length)[0] || [];
}

function normalizeEntry(e) {
  const athlete = e.athlete || e.competitor?.athlete || e.competitor || e.player || e;
  const name = athlete.displayName || athlete.fullName || athlete.name || e.displayName || e.fullName;
  if (!name || typeof name !== 'string') return null;
  const statusText = e.status?.type?.description || e.status?.description || e.status?.displayValue || e.status || '';
  const status = String(statusText).toUpperCase();
  const score = normalizeScore(e.score?.displayValue ?? e.score ?? e.totalScore ?? e.toPar ?? e.statistics?.find?.(s=>/score|to par/i.test(s.name||s.displayName||''))?.displayValue);
  const thru = e.linescores?.[0]?.period ?? e.thru ?? e.holesCompleted ?? e.status?.period ?? '';
  const round = e.round ?? e.currentRound ?? '';
  let cutStatus = 'active';
  if (/CUT|MC/.test(status)) cutStatus = 'cut';
  if (/WD|WITHDRAW/.test(status)) cutStatus = 'wd';
  if (/DQ|DISQUAL/.test(status)) cutStatus = 'dq';
  if (/FINAL|COMPLETE|FINISHED/.test(status)) cutStatus = 'finished';
  return { name, score, thru: String(thru || ''), round: String(round || ''), status: cutStatus, statusText: statusText || '' };
}

async function fetchLeaderboard() {
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event=${ESPN_EVENT_ID}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${ESPN_EVENT_ID}`,
    `https://site.web.api.espn.com/apis/fittwo/v3/sports/golf/pga/leaderboard?region=us&lang=en&event=${ESPN_EVENT_ID}`
  ];
  let lastError = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, {headers: {'User-Agent':'Mozilla/5.0'}});
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const json = await r.json();
      const entries = findEntries(json).map(normalizeEntry).filter(Boolean);
      if (entries.length >= 20) return {source:'ESPN', updatedAt:new Date().toISOString(), players:entries};
      lastError = `Endpoint returned only ${entries.length} recognizable players.`;
    } catch (e) { lastError = e.message; }
  }
  throw new Error(lastError || 'No live data source responded.');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/leaderboard') {
    try { send(res, 200, JSON.stringify(await fetchLeaderboard())); }
    catch (e) { send(res, 502, JSON.stringify({error:e.message, updatedAt:new Date().toISOString()})); }
    return;
  }
  let rel = u.pathname === '/' ? '/index.html' : u.pathname;
  rel = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res,403,'Forbidden','text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res,404,'Not found','text/plain');
    const ext=path.extname(file);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml'};
    send(res,200,data,types[ext]||'application/octet-stream');
  });
});
server.listen(PORT, ()=>console.log(`Open Draft Live running at http://localhost:${PORT}`));
