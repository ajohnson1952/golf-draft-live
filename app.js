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
const aliases = value => String(value || '')
  .toLowerCase()
  // Some letters, especially Danish/Norwegian ø, do not decompose under NFD.
  // Transliterate them before removing accents and punctuation so ESPN's
  // "Nicolai Højgaard" matches the drafted "Nicolai Hojgaard".
  .replace(/[øö]/g, 'o')
  .replace(/æ/g, 'ae')
  .replace(/å/g, 'a')
  .replace(/ł/g, 'l')
  .replace(/ð/g, 'd')
  .replace(/þ/g, 'th')
  .replace(/ß/g, 'ss')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z]/g, '');
let live = {};
let lastUpdated = null;
let overrides = JSON.parse(localStorage.getItem('draftOverrides') || '{}');
let previousHoles = JSON.parse(localStorage.getItem('draftPreviousHoles') || '{}');
let projections = {};
let coursePars = [];
let previousTeamRanks = {};
let previousTeamOrder = Object.keys(teams);
let recentHighlights = JSON.parse(localStorage.getItem('draftRecentHighlights') || '[]');
let previousLiveSnapshot = JSON.parse(localStorage.getItem('draftPreviousLiveSnapshot') || '{}');
let previousRefreshStandings = JSON.parse(localStorage.getItem('draftPreviousRefreshStandings') || '{}');

const fmt = score => score == null || score === '' ? '—' : Number(score) === 0 ? 'E' : Number(score) > 0 ? `+${Number(score)}` : `${Number(score)}`;
const hasValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const todayLabel = player => hasValue(player.today) ? `Today ${fmt(player.today)}` : '';
const scoreSort = (a,b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name);

function getPlayer(name) {
  const found = live[aliases(name)] || {};
  const manual = overrides[name] || {};
  return {...found, ...manual, name, score: manual.score ?? found.score ?? null, status: manual.status ?? found.status ?? 'active'};
}

function compute() {
  const priorOrder = new Map(previousTeamOrder.map((name,index) => [name,index]));
  return Object.entries(teams).map(([name,names],draftIndex) => {
    const players = names.map(getPlayer);
    const eligible = players.filter(player => !eliminatedStatuses.has(player.status) && player.score != null).sort(scoreSort);
    const frozen = players.filter(player => eliminatedStatuses.has(player.status) && player.score != null).sort(scoreSort);
    const counting = eligible.length >= COUNTING_PLAYERS ? eligible.slice(0, COUNTING_PLAYERS) : [...eligible, ...frozen.slice(0, COUNTING_PLAYERS - eligible.length)];
    const total = counting.length === COUNTING_PLAYERS ? counting.reduce((sum,player) => sum + player.score, 0) : null;
    return {name, players:[...players].sort(scoreSort), counting, total, draftIndex};
  }).sort((a,b) => {
    const scoreDifference = (a.total ?? Number.POSITIVE_INFINITY) - (b.total ?? Number.POSITIVE_INFINITY);
    if (scoreDifference) return scoreDifference;
    // Preserve the existing screen order while teams are tied. This prevents
    // tied cards from swapping places on routine data refreshes.
    return (priorOrder.get(a.name) ?? a.draftIndex) - (priorOrder.get(b.name) ?? b.draftIndex);
  });
}

function progressText(player) {
  if (player.status === 'cut') return 'Missed cut';
  if (player.status === 'wd') return 'Withdrawn';
  if (player.status === 'dq') return 'Disqualified';
  // Trust the server's current-round start flag before stale ESPN thru values.
  if (player.started === false || player.scheduledNotStarted) return player.teeTime ? `Tee time ${player.teeTime}` : 'Not started';
  if (player.thru === 'F' || player.thru === 18 || player.thru === '18') return 'Finished round';
  if (player.thru !== '' && player.thru != null && Number(player.thru) > 0) return `Thru ${player.thru}`;
  if (player.status === 'finished') return 'Finished';
  return player.teeTime ? `Tee time ${player.teeTime}` : 'Not started';
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

function competitionRankMap(standings) {
  const ranks = {};
  let lastTotal = null;
  let lastRank = 0;
  standings.forEach((team,index) => {
    const rank = index === 0 || team.total !== lastTotal ? index + 1 : lastRank;
    ranks[team.name] = rank;
    lastTotal = team.total;
    lastRank = rank;
  });
  return ranks;
}

function currentTournamentRound() {
  const rounds = Object.values(teams).flat().map(getPlayer).map(player => Number(player.round || 0)).filter(Boolean);
  return rounds.length ? Math.max(...rounds) : 1;
}

function playerScoreThroughRound(player, throughRound) {
  if (throughRound < 1) return null;
  const rounds = Array.isArray(player.rounds) ? player.rounds : [];
  const completed = rounds.filter(round => Number(round.round) <= throughRound && hasValue(round.score));
  if (completed.length >= throughRound) return completed.reduce((sum,round) => sum + Number(round.score),0);

  const currentRound = Number(player.round || 0);
  if (currentRound === throughRound + 1 && hasValue(player.score) && hasValue(player.today)) {
    return Number(player.score) - Number(player.today);
  }
  if (currentRound <= throughRound && hasValue(player.score)) return Number(player.score);
  return null;
}

function historicalStandings(throughRound) {
  if (throughRound < 1) return [];
  return Object.entries(teams).map(([name,names]) => {
    const players = names.map(getPlayer).map(player => ({...player, historicalScore:playerScoreThroughRound(player,throughRound)}));
    let eligible;
    let frozen = [];
    if (throughRound >= 2) {
      eligible = players.filter(player => !eliminatedStatuses.has(player.status) && player.historicalScore != null).sort((a,b)=>a.historicalScore-b.historicalScore);
      frozen = players.filter(player => eliminatedStatuses.has(player.status) && player.historicalScore != null).sort((a,b)=>a.historicalScore-b.historicalScore);
    } else {
      eligible = players.filter(player => player.historicalScore != null).sort((a,b)=>a.historicalScore-b.historicalScore);
    }
    const counting = eligible.length >= COUNTING_PLAYERS ? eligible.slice(0,COUNTING_PLAYERS) : [...eligible,...frozen.slice(0,COUNTING_PLAYERS-eligible.length)];
    const total = counting.length === COUNTING_PLAYERS ? counting.reduce((sum,player)=>sum+player.historicalScore,0) : null;
    return {name,total};
  }).sort((a,b)=>(a.total??Number.POSITIVE_INFINITY)-(b.total??Number.POSITIVE_INFINITY)||a.name.localeCompare(b.name));
}

function teamMovement(teamName,currentRank) {
  const round = currentTournamentRound();
  if (round <= 1) return {value:0,label:'— Opening round',className:'same'};
  const baseline = historicalStandings(round-1);
  const priorRank = competitionRankMap(baseline)[teamName];
  if (priorRank == null || currentRank == null) return {value:0,label:'— No change',className:'same'};
  const value = priorRank-currentRank;
  if (value > 0) return {value,label:`↑ ${value} Today`,className:'up'};
  if (value < 0) return {value,label:`↓ ${Math.abs(value)} Today`,className:'down'};
  return {value:0,label:'— No change',className:'same'};
}

function render() {
  const standings = compute();
  projections = buildProjections(standings);

  const oldRects = {};
  document.querySelectorAll('.team[data-team-card]').forEach(card => {
    oldRects[card.dataset.teamCard] = card.getBoundingClientRect();
  });
  const oldRanks = previousTeamRanks;
  const currentRanks = competitionRankMap(standings);

  document.querySelector('#teams').innerHTML = standings.map((team,index) => {
    const currentRank = currentRanks[team.name];
    const move = teamMovement(team.name,currentRank);
    const rankChanged = oldRanks[team.name] != null && oldRanks[team.name] !== currentRank;
    return `<article class="team place-${index+1} ${rankChanged ? (oldRanks[team.name] > currentRank ? 'rank-up-flash' : 'rank-down-flash') : ''}" data-team-card="${team.name}">
      <button class="teamhead" data-team="${team.name}">
        <div class="rank">${index + 1}</div>
        <div class="team-copy"><div class="teamname">${team.name}</div><div class="team-movement ${move.className}">${move.label}</div></div>
        <div class="teamscore">${fmt(team.total)}</div>
      </button>
      <div class="players">
        ${team.players.map(player => {
          const counts = team.counting.some(counting => counting.name === player.name);
          return `<button class="player ${counts ? 'counting' : 'dropped'} ${eliminatedStatuses.has(player.status) ? 'cut' : ''}" data-player="${player.name}">
            <span class="player-main"><span class="pname">${player.name}</span><span class="pscore">${fmt(player.score)}</span></span>
            <span class="meta">${progressText(player)}${player.round ? ` · R${player.round}` : ''}${todayLabel(player) ? ` · ${todayLabel(player)}` : ''}</span>
          </button>`;
        }).join('')}
      </div>
    </article>`;
  }).join('');

  const teamsWithRealRankChanges = new Set(
    standings
      .filter(team => oldRanks[team.name] != null && oldRanks[team.name] !== currentRanks[team.name])
      .map(team => team.name)
  );

  requestAnimationFrame(() => {
    document.querySelectorAll('.team[data-team-card]').forEach(card => {
      const teamName = card.dataset.teamCard;
      // Do not animate routine refresh layout changes. Only animate when the
      // team's actual competition rank changed since the prior refresh.
      if (!teamsWithRealRankChanges.has(teamName)) return;
      const old = oldRects[teamName];
      if (!old) return;
      const now = card.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.animate([
        {transform:`translate(${dx}px, ${dy}px)`},
        {transform:'translate(0, 0)'}
      ], {duration:320,easing:'cubic-bezier(.22,.75,.25,1)'});
    });
  });
  previousTeamRanks = currentRanks;
  previousTeamOrder = standings.map(team => team.name);

  document.querySelectorAll('[data-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.player));
  document.querySelectorAll('[data-team]').forEach(el => el.onclick = () => openTeam(el.dataset.team));
  renderPayouts(standings);
  renderMovers();
  renderGroupsToWatch();
  renderRecentHighlights();
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

function moverCard(player, value, detail) {
  return `<button class="mover-player" data-player="${player.name}">
    <span class="mover-copy"><strong>${player.name}</strong><small>${detail}</small></span>
    <span class="mover-score">${value}</span>
  </button>`;
}


function renderMovers() {
  const allPlayers = Object.values(teams).flat().map(getPlayer);
  const players = allPlayers.filter(player => hasValue(player.today));
  const sorted = [...players].sort((a,b) => Number(a.today)-Number(b.today));

  document.querySelector('#hotPlayers').innerHTML = sorted.slice(0,5)
    .map(player => moverCard(player, fmt(player.today), `${progressText(player)} · ${player.position || '—'}`)).join('') || '<p class="empty">Round scoring is not available yet.</p>';
  document.querySelector('#coldPlayers').innerHTML = sorted.slice(-5).reverse()
    .map(player => moverCard(player, fmt(player.today), `${progressText(player)} · ${player.position || '—'}`)).join('') || '<p class="empty">Round scoring is not available yet.</p>';

  document.querySelectorAll('.movers-section [data-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.player));
}

function renderGroupsToWatch() {
  const container = document.querySelector('#groupsToWatch');
  if (!container) return;
  const drafted = Object.values(teams).flat().map(getPlayer).filter(player => {
    const onCourse = player.status === 'active' && player.thru !== '' && player.thru !== 'F' && Number(player.thru) > 0;
    return onCourse && (player.groupId || player.groupKey);
  });
  const groups = new Map();
  drafted.forEach(player => {
    const key = player.groupId || player.groupKey;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(player);
  });
  const watch = [...groups.values()].filter(group => group.length >= 2)
    .sort((a,b) => Math.max(...b.map(p=>Number(p.thru)||0)) - Math.max(...a.map(p=>Number(p.thru)||0)));

  if (!watch.length) {
    container.innerHTML = '<p class="empty">No drafted golfers are currently playing together.</p>';
    return;
  }
  container.innerHTML = watch.map((group,index) => `<article class="watch-group">
    <div class="watch-group-head"><strong>${group[0].groupLabel || `Group ${index+1}`}</strong><span>Thru ${Math.max(...group.map(p=>Number(p.thru)||0))}</span></div>
    ${group.sort((a,b)=>(a.score??99)-(b.score??99)).map(player => `<button class="watch-player" data-player="${player.name}">
      <span><strong>${player.name}</strong><small>${ownerOfGolfer(player.name)} · ${progressText(player)}</small></span><b>${fmt(player.score)}</b>
    </button>`).join('')}
  </article>`).join('');
  container.querySelectorAll('[data-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.player));
}

function ordinal(value) {
  const number = Number(value);
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  return `${number}${number % 10 === 1 ? 'st' : number % 10 === 2 ? 'nd' : number % 10 === 3 ? 'rd' : 'th'}`;
}

function highlightIcon(relative) {
  if (relative <= -2) return '🦅';
  if (relative === -1) return '🐦';
  if (relative === 1) return 'Bogey';
  if (relative >= 2) return 'Double';
  return 'Par';
}

function snapshotPlayer(player) {
  const holes = {};
  (player.rounds || []).forEach(round => (round.holes || []).forEach(hole => {
    holes[`${round.round}-${hole.hole}`] = {relative:hole.relative,strokes:hole.strokes,round:round.round,hole:hole.hole};
  }));
  return {score:player.score,today:player.today,thru:player.thru,round:player.round,status:player.status,holes};
}

function addHighlight(text,type='neutral',playerName='') {
  const duplicate = recentHighlights[0]?.text === text;
  if (duplicate) return;
  recentHighlights.unshift({text,type,playerName,time:new Date().toISOString()});
  recentHighlights = recentHighlights.slice(0,14);
  localStorage.setItem('draftRecentHighlights',JSON.stringify(recentHighlights));
}

function collectRecentHighlights(standings) {
  const drafted = Object.values(teams).flat().map(getPlayer);
  const hadPrevious = Object.keys(previousLiveSnapshot).length > 0;

  if (hadPrevious) {
    drafted.forEach(player => {
      const key = aliases(player.name);
      const before = previousLiveSnapshot[key];
      if (!before) return;
      const now = snapshotPlayer(player);
      const newHoles = Object.entries(now.holes).filter(([holeKey]) => !before.holes?.[holeKey]).map(([,hole])=>hole).sort((a,b)=>a.round-b.round||a.hole-b.hole);
      newHoles.forEach(hole => {
        const relative = Number(hole.relative);
        if (!Number.isFinite(relative) || relative === 0) return;
        const result = relative <= -2 ? 'Eagle' : relative === -1 ? 'Birdie' : relative === 1 ? 'Bogey' : relative >= 2 ? 'Double bogey' : '';
        if (result) addHighlight(`${player.name} makes ${result.toLowerCase()} on ${hole.hole}`,relative<0?'good':'bad',player.name);
      });

      if (!newHoles.length && Number(player.holesPlayed||0) === Number(before.holesPlayed||0)+1 && hasValue(player.today) && hasValue(before.today)) {
        const change = Number(player.today)-Number(before.today);
        if (change !== 0) {
          const result = change <= -2 ? 'eagle' : change === -1 ? 'birdie' : change === 1 ? 'bogey' : change >= 2 ? 'double bogey' : '';
          if (result) addHighlight(`${player.name} makes ${result}`,change<0?'good':'bad',player.name);
        }
      }
    });

    const ranks = competitionRankMap(standings);
    const oldRanks = previousRefreshStandings.ranks || {};
    Object.entries(ranks).forEach(([team,rank]) => {
      const oldRank = oldRanks[team];
      if (oldRank == null || oldRank === rank) return;
      if (rank === 1) addHighlight(`${team} takes the Caveman lead`,'good');
      else addHighlight(`${team} moves ${oldRank > rank ? 'up' : 'down'} to ${ordinal(rank)}`,oldRank > rank ? 'good' : 'bad');
    });
  }

  previousLiveSnapshot = Object.fromEntries(drafted.map(player => [aliases(player.name), {...snapshotPlayer(player),holesPlayed:Number(player.holesPlayed||0)}]));
  previousRefreshStandings = {ranks:competitionRankMap(standings),savedAt:new Date().toISOString()};
  localStorage.setItem('draftPreviousLiveSnapshot',JSON.stringify(previousLiveSnapshot));
  localStorage.setItem('draftPreviousRefreshStandings',JSON.stringify(previousRefreshStandings));
}

function renderRecentHighlights() {
  const container = document.querySelector('#recentHighlights');
  if (!container) return;
  if (!recentHighlights.length) {
    container.innerHTML = '<p class="empty">Highlights will appear as drafted golfers complete holes and teams change places.</p>';
    return;
  }
  container.innerHTML = recentHighlights.slice(0,8).map(item => {
    const time = new Date(item.time).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    const content = `<span class="highlight-dot ${item.type}"></span><span class="highlight-copy"><strong>${item.text}</strong><small>${time}</small></span>`;
    return item.playerName ? `<button class="highlight-row" data-player="${item.playerName}">${content}</button>` : `<div class="highlight-row">${content}</div>`;
  }).join('');
  container.querySelectorAll('[data-player]').forEach(el => el.onclick = () => openPlayer(el.dataset.player));
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
  const todayPlayers = team.players.filter(player => hasValue(player.today)).slice().sort((a,b)=>Number(a.today)-Number(b.today));
  const todayBestThree = todayPlayers.slice(0,COUNTING_PLAYERS);
  const todayTotal = todayBestThree.length === COUNTING_PLAYERS ? todayBestThree.reduce((sum,p)=>sum+Number(p.today),0) : null;
  const todayBreakdown = todayBestThree.length ? todayBestThree.map(player => `${player.name.split(' ').slice(-1)[0]} ${fmt(player.today)}`).join(' · ') : 'Waiting for scores';
  const completedHoles = team.players.reduce((sum,p)=>sum+Number(p.holesPlayed||0),0);

  showModal(`
    <p class="modal-eyebrow">Team detail</p>
    <h2 id="modalTitle">${team.name}</h2>
    <div class="detail-score">${fmt(team.total)}</div>
    <div class="detail-grid">
      <div><span>Projected finish</span><strong>${fmt(projection.projected)}</strong></div>
      <div><span>Chance to win</span><strong>${projection.winChance}%</strong></div>
      <div><span>Best golfer</span><strong>${best ? `${best.name} ${fmt(best.score)}` : '—'}</strong></div>
      <div><span>Today’s best 3</span><strong>${fmt(todayTotal)}</strong><small class="detail-sub">${todayBreakdown}</small></div>
      <div><span>Team average</span><strong>${average == null ? '—' : average.toFixed(1)}</strong></div>
      <div><span>Holes completed</span><strong>${completedHoles}</strong></div>
    </div>
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
    const ticker = document.querySelector('#mobileTicker');
    if (ticker) ticker.textContent = `Updated ${updatedText} · ${delta} hole${delta === 1 ? '' : 's'} since last refresh`;
    statusText.textContent = `Live · ${data.source}`;
    dot.style.background = 'var(--accent)';
    if (data.eventName) document.querySelector('#eventName').textContent = data.eventName;
    collectRecentHighlights(compute());
    render();
  } catch (error) {
    const ticker = document.querySelector('#mobileTicker');
    if (ticker) ticker.textContent = 'Live scores unavailable · showing last saved update';
    statusText.textContent = 'Manual mode · live feed unavailable';
    dot.style.background = 'var(--red)';
    render();
  }
}

document.querySelector('#refresh').onclick = refresh;
document.querySelector('#clearOverrides').onclick = () => { overrides = {}; localStorage.removeItem('draftOverrides'); render(); };

render();
refresh();
setInterval(refresh, 60000);
