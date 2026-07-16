const teams = {
  Johnson:['Scottie Scheffler','Shane Lowry','Justin Thomas','Hideki Matsuyama','Akshay Bhatia'],
  Gerdes:['Rory McIlroy','Sam Burns','Cameron Young','Si Woo Kim','Brooks Koepka'],
  Long:['Matt Fitzpatrick','Tyrrell Hatton','Tom Kim','Brian Harman','Ben Griffin'],
  Schreck:['Tommy Fleetwood','Viktor Hovland','Joaquin Niemann','Jordan Spieth','Corey Conners'],
  Butts:['Jon Rahm','Robert MacIntyre','Russell Henley','J.J. Spaun','Harris English'],
  Gilliam:['Xander Schauffele','Wyndham Clark','Patrick Reed','Bryson DeChambeau','Keegan Bradley'],
  Allen:['Ludvig Aberg','Collin Morikawa','Min Woo Lee','Nicolai Hojgaard','Kristoffer Reitan'],
  Sterns:['Chris Gotterup','Justin Rose','Aaron Rai','Alex Fitzpatrick','Tom McKibbin']
};

const COUNTING_PLAYERS = 3;
const TEAM_PAYOUT = 160;
const GOLFER_PAYOUT = 160;
const eliminatedStatuses = new Set(['cut','wd','dq']);
const aliases = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
let live = {};
let lastUpdated = null;
let overrides = JSON.parse(localStorage.getItem('draftOverrides') || '{}');
let previousHoles = JSON.parse(localStorage.getItem('draftPreviousHoles') || '{}');
let projections = {};
let coursePars = [];

const fmt = score => score == null ? '—' : score === 0 ? 'E' : score > 0 ? `+${score}` : `${score}`;
const scoreSort = (a,b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name);

function getPlayer(name) {
  const found = live[aliases(name)] || {};
  const manual = overrides[name] || {};
  return {...found, ...manual, name, score: manual.score ?? found.score ?? null, status: manual.status ?? found.status ?? 'active'};
}

function compute() {
  return Object.entries(teams).map(([name,names]) => {
    const players = names.map(getPlayer);
    const eligible = players.filter(player => !eliminatedStatuses.has(player.status) && player.score != null).sort(scoreSort);
    const frozen = players.filter(player => eliminatedStatuses.has(player.status) && player.score != null).sort(scoreSort);
    const counting = eligible.length >= COUNTING_PLAYERS ? eligible.slice(0, COUNTING_PLAYERS) : [...eligible, ...frozen.slice(0, COUNTING_PLAYERS - eligible.length)];
    const total = counting.length === COUNTING_PLAYERS ? counting.reduce((sum,player) => sum + player.score, 0) : null;
    return {name, players:[...players].sort(scoreSort), counting, total};
  }).sort((a,b) => (a.total ?? Number.POSITIVE_INFINITY) - (b.total ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));
}

function progressText(player) {
  if (player.status === 'cut') return 'Missed cut';
  if (player.status === 'wd') return 'Withdrawn';
  if (player.status === 'dq') return 'Disqualified';
  if (player.status === 'finished') return 'Finished';
  if (player.thru === 'F' || player.thru === 18 || player.thru === '18') return 'Finished round';
  if (player.thru !== '' && player.thru != null) return `Thru ${player.thru}`;
  return player.teeTime || 'Not started';
}

function normalRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildProjections(standings) {
  const sims = 1800;
  const wins = Object.fromEntries(standings.map(team => [team.name,0]));
  const projectedTotals = Object.fromEntries(standings.map(team => [team.name,[]]));

  for (let s = 0; s < sims; s++) {
    const results = standings.map(team => {
      const playerFinishes = team.players.map(player => {
        if (player.score == null) return Number.POSITIVE_INFINITY;
        if (eliminatedStatuses.has(player.status)) return player.score;
        const holesPlayed = Number(player.holesPlayed || 0);
        const remaining = Math.max(0, 72 - holesPlayed);
        const observedRate = holesPlayed > 0 ? player.score / holesPlayed : 0;
        const expectedRate = observedRate * Math.min(.35, holesPlayed / 100);
        return player.score + remaining * expectedRate + normalRandom() * Math.sqrt(remaining) * .42;
      }).sort((a,b) => a-b);
      const total = playerFinishes.slice(0,COUNTING_PLAYERS).reduce((sum,value) => sum + value,0);
      projectedTotals[team.name].push(total);
      return {name:team.name,total};
    }).sort((a,b) => a.total-b.total);
    const best = results[0].total;
    const tied = results.filter(result => Math.abs(result.total-best) < .0001);
    tied.forEach(result => wins[result.name] += 1/tied.length);
  }

  return Object.fromEntries(standings.map(team => {
    const vals = projectedTotals[team.name].sort((a,b)=>a-b);
    return [team.name, {projected: Math.round(vals[Math.floor(vals.length/2)]), winChance: Math.round(wins[team.name]/sims*100)}];
  }));
}

function render() {
  const standings = compute();
  projections = buildProjections(standings);
  const leader = standings[0];
  document.querySelector('#leaderName').textContent = leader.total == null ? 'Waiting for scores' : leader.name;
  document.querySelector('#leaderScore').textContent = fmt(leader.total);

  document.querySelector('#teams').innerHTML = standings.map((team,index) => `
    <article class="team place-${index+1}">
      <button class="teamhead" data-team="${team.name}">
        <div class="rank">${index + 1}</div>
        <div class="teamname">${team.name}</div>
        <div class="teamscore">${fmt(team.total)}</div>
      </button>
      <div class="players">
        ${team.players.map(player => {
          const counts = team.counting.some(counting => counting.name === player.name);
          return `<button class="player ${counts ? 'counting' : 'dropped'} ${eliminatedStatuses.has(player.status) ? 'cut' : ''}" data-player="${player.name}">
            <span class="player-main"><span class="pname">${player.name}</span><span class="pscore">${fmt(player.score)}</span></span>
            <span class="meta">${progressText(player)}${player.round ? ` · R${player.round}` : ''}${player.today != null ? ` · Today ${fmt(player.today)}` : ''}</span>
          </button>`;
        }).join('')}
      </div>
    </article>`).join('');

  document.querySelectorAll('[data-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.player));
  document.querySelectorAll('[data-team]').forEach(el => el.onclick = () => openTeam(el.dataset.team));
  renderPayouts(standings);
  renderMovers();
  renderEditor();
}


function ownerOfGolfer(name) {
  return Object.entries(teams).find(([, players]) => players.includes(name))?.[0] || '—';
}

function renderPayouts(standings) {
  const teamLeader = standings[0];
  const draftedPlayers = Object.values(teams).flat().map(getPlayer).filter(player => player.score != null);
  const bestScore = draftedPlayers.length ? Math.min(...draftedPlayers.map(player => player.score)) : null;
  const golferLeaders = bestScore == null ? [] : draftedPlayers.filter(player => player.score === bestScore);
  const golferText = golferLeaders.length
    ? golferLeaders.map(player => `${player.name} (${ownerOfGolfer(player.name)})`).join(', ')
    : 'Waiting for scores';

  document.querySelector('#teamPayoutLeader').textContent = teamLeader?.total == null ? 'Waiting for scores' : `${teamLeader.name} · ${fmt(teamLeader.total)}`;
  document.querySelector('#golferPayoutLeader').textContent = golferLeaders.length ? `${golferText} · ${fmt(bestScore)}` : golferText;
}

function scoreClass(relative) {
  if (relative == null) return '';
  if (relative <= -2) return 'eagle';
  if (relative === -1) return 'birdie';
  if (relative === 1) return 'bogey';
  if (relative >= 2) return 'double';
  return 'par';
}

function renderScorecard(round, fallbackPars = []) {
  const holes = Array.isArray(round?.holes) ? round.holes : [];
  if (!holes.length) {
    return `<div class="round-summary-only">
      <span>Round ${round.round}</span>
      <strong>${round.strokes != null ? `${round.strokes} strokes` : fmt(round.score)}</strong>
      <small>Hole-by-hole data is not included in ESPN’s current feed for this round.</small>
    </div>`;
  }

  const byHole = Object.fromEntries(holes.map(hole => [hole.hole, hole]));
  return `<div class="scorecard-wrap">
    <div class="scorecard-title"><strong>Round ${round.round}</strong><span>${round.strokes != null ? `${round.strokes} strokes` : fmt(round.score)}</span></div>
    <div class="scorecard-scroll"><table class="scorecard-table">
      <thead><tr><th>Hole</th>${Array.from({length:18},(_,i)=>`<th>${i+1}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>
        <tr><th>Par</th>${Array.from({length:18},(_,i)=>`<td>${byHole[i+1]?.par ?? fallbackPars[i]?.par ?? '—'}</td>`).join('')}<td>${fallbackPars.reduce((sum,h)=>sum+(Number(h.par)||0),0)||'—'}</td></tr>
        <tr><th>Score</th>${Array.from({length:18},(_,i)=>{const h=byHole[i+1]; return `<td class="${scoreClass(h?.relative)}">${h?.strokes ?? '—'}</td>`}).join('')}<td>${round.strokes ?? '—'}</td></tr>
      </tbody>
    </table></div>
  </div>`;
}

function renderMovers() {
  const players = Object.values(teams).flat().map(getPlayer).filter(player => player.today != null);
  const sorted = [...players].sort((a,b) => a.today-b.today);
  const row = player => `<div class="mover-row"><span>${player.name}</span><strong>${fmt(player.today)}</strong></div>`;
  document.querySelector('#hotPlayers').innerHTML = sorted.slice(0,5).map(row).join('') || '<p class="empty">Round scoring is not available yet.</p>';
  document.querySelector('#coldPlayers').innerHTML = sorted.slice(-5).reverse().map(row).join('') || '<p class="empty">Round scoring is not available yet.</p>';
}

function openPlayer(name) {
  const player = getPlayer(name);
  const rounds = (player.rounds || []).filter(round => round.score != null || round.strokes != null || (round.holes || []).length);
  const owner = ownerOfGolfer(name);
  showModal(`
    <p class="modal-eyebrow">Golfer detail</p>
    <h2 id="modalTitle">${player.name}</h2>
    <div class="detail-score">${fmt(player.score)}</div>
    <div class="detail-grid">
      <div><span>Position</span><strong>${player.position || '—'}</strong></div>
      <div><span>Today</span><strong>${fmt(player.today)}</strong></div>
      <div><span>Progress</span><strong>${progressText(player)}</strong></div>
      <div><span>Drafted by</span><strong>${owner}</strong></div>
    </div>
    <div class="payout-callout"><span>Winning-golfer prize</span><strong>$${GOLFER_PAYOUT}</strong><small>Paid to the person who drafted the tournament champion.</small></div>
    <h3>Tournament scorecard</h3>
    <div class="scorecards">${rounds.length ? rounds.map(round => renderScorecard(round, coursePars)).join('') : '<p class="empty">Round details are not available yet.</p>'}</div>
    ${player.scorecardUrl ? `<a class="external-scorecard" href="${player.scorecardUrl}" target="_blank" rel="noopener">Open ESPN full scorecard</a>` : ''}
  `);
}

function openTeam(name) {
  const standings = compute();
  const team = standings.find(item => item.name === name);
  const projection = projections[name] || {projected:null,winChance:0};
  const playersWithScores = team.players.filter(player => player.score != null);
  const average = playersWithScores.length ? playersWithScores.reduce((sum,p)=>sum+p.score,0)/playersWithScores.length : null;
  const best = playersWithScores.slice().sort(scoreSort)[0];
  const todayPlayers = team.players.filter(player => player.today != null);
  const todayTotal = todayPlayers.length ? todayPlayers.sort((a,b)=>a.today-b.today).slice(0,COUNTING_PLAYERS).reduce((sum,p)=>sum+p.today,0) : null;
  const completedHoles = team.players.reduce((sum,p)=>sum+Number(p.holesPlayed||0),0);

  showModal(`
    <p class="modal-eyebrow">Team detail</p>
    <h2 id="modalTitle">${team.name}</h2>
    <div class="detail-score">${fmt(team.total)}</div>
    <div class="detail-grid">
      <div><span>Projected finish</span><strong>${fmt(projection.projected)}</strong></div>
      <div><span>Chance to win</span><strong>${projection.winChance}%</strong></div>
      <div><span>Best golfer</span><strong>${best ? `${best.name} ${fmt(best.score)}` : '—'}</strong></div>
      <div><span>Today’s best 3</span><strong>${fmt(todayTotal)}</strong></div>
      <div><span>Team average</span><strong>${average == null ? '—' : average.toFixed(1)}</strong></div>
      <div><span>Holes completed</span><strong>${completedHoles}</strong></div>
    </div>
    <div class="payout-callout"><span>Winning-team prize</span><strong>$${TEAM_PAYOUT}</strong><small>Paid to the owner of the lowest best-three team total.</small></div>
    <p class="projection-note">Projected finish and win chance are simulation estimates based on current scores, holes remaining and normal scoring volatility. They are for fun, not betting guidance.</p>
    <h3>Team golfers</h3>
    <div class="stats-list">${team.players.map(player => `<button data-modal-player="${player.name}"><span>${player.name}</span><strong>${fmt(player.score)} · ${progressText(player)}</strong></button>`).join('')}</div>
  `);
  document.querySelectorAll('[data-modal-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.modalPlayer));
}

function showModal(html) {
  document.querySelector('#modalContent').innerHTML = html;
  document.querySelector('#modal').classList.add('open');
  document.querySelector('#modal').setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
}

function closeModal() {
  document.querySelector('#modal').classList.remove('open');
  document.querySelector('#modal').setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
}

document.querySelectorAll('[data-close-modal]').forEach(el => el.onclick = closeModal);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

function renderEditor() {
  document.querySelector('#editor').innerHTML = Object.values(teams).flat().map(name => {
    const player = getPlayer(name);
    return `<div class="editrow"><span>${name}</span><input data-name="${name}" type="number" placeholder="Score" value="${overrides[name]?.score ?? ''}"><select data-status="${name}"><option value="active" ${player.status === 'active' ? 'selected' : ''}>Active</option><option value="cut" ${player.status === 'cut' ? 'selected' : ''}>Cut</option><option value="wd" ${player.status === 'wd' ? 'selected' : ''}>WD</option><option value="dq" ${player.status === 'dq' ? 'selected' : ''}>DQ</option><option value="finished" ${player.status === 'finished' ? 'selected' : ''}>Finished</option></select></div>`;
  }).join('');
  document.querySelectorAll('input[data-name]').forEach(element => element.onchange = () => save(element.dataset.name, element.value, document.querySelector(`[data-status="${element.dataset.name}"]`).value));
  document.querySelectorAll('select[data-status]').forEach(element => element.onchange = () => save(element.dataset.status, document.querySelector(`[data-name="${element.dataset.status}"]`).value, element.value));
}

function save(name,score,status) {
  overrides[name] = {score: score === '' ? undefined : Number(score), status};
  localStorage.setItem('draftOverrides', JSON.stringify(overrides));
  render();
}

function calculateHoleDelta(players) {
  let delta = 0;
  const next = {};
  for (const player of players) {
    const key = aliases(player.name);
    const holes = Number(player.holesPlayed || 0);
    next[key] = holes;
    if (previousHoles[key] != null) delta += Math.max(0, holes - Number(previousHoles[key]));
  }
  previousHoles = next;
  localStorage.setItem('draftPreviousHoles', JSON.stringify(previousHoles));
  return delta;
}

async function refresh() {
  const statusText = document.querySelector('#statusText');
  const dot = document.querySelector('#dot');
  statusText.textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/leaderboard');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const drafted = (data.players || []).filter(player => Object.values(teams).flat().some(name => aliases(name) === aliases(player.name)));
    const delta = calculateHoleDelta(drafted);
    live = Object.fromEntries((data.players || []).map(player => [aliases(player.name), player]));
    coursePars = Array.isArray(data.coursePars) ? data.coursePars : [];
    lastUpdated = new Date(data.updatedAt);
    const updatedText = lastUpdated.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    statusText.textContent = `Live · ${data.source}`;
    dot.style.background = 'var(--accent)';
    document.querySelector('#updated').textContent = updatedText;
    document.querySelector('#holesDelta').textContent = delta;
    document.querySelector('#mobileTicker').textContent = `Updated ${updatedText} · ${delta} drafted-player holes since last refresh`;
    if (data.eventName) document.querySelector('#eventName').textContent = data.eventName;
    render();
  } catch (error) {
    statusText.textContent = 'Manual mode · live feed unavailable';
    dot.style.background = 'var(--red)';
    document.querySelector('#updated').textContent = 'Feed unavailable';
    document.querySelector('#mobileTicker').textContent = `Live feed unavailable · ${error.message}`;
    render();
  }
}

document.querySelector('#refresh').onclick = refresh;
document.querySelector('#clearOverrides').onclick = () => { overrides = {}; localStorage.removeItem('draftOverrides'); render(); };

render();
refresh();
setInterval(refresh, 60000);
