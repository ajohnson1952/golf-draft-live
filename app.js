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
const eliminatedStatuses = new Set(['cut','wd','dq']);
const aliases = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
let live = {};
let overrides = JSON.parse(localStorage.getItem('draftOverrides') || '{}');

const fmt = score => score == null ? '—' : score === 0 ? 'E' : score > 0 ? `+${score}` : `${score}`;
const scoreSort = (a,b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name);

function getPlayer(name) {
  const found = live[aliases(name)] || {};
  const manual = overrides[name] || {};
  return {
    ...found,
    ...manual,
    name,
    score: manual.score ?? found.score ?? null,
    status: manual.status ?? found.status ?? 'active'
  };
}

function compute() {
  return Object.entries(teams).map(([name,names]) => {
    const players = names.map(getPlayer);
    const eligible = players.filter(player => !eliminatedStatuses.has(player.status) && player.score != null).sort(scoreSort);
    let counting;

    if (eligible.length >= COUNTING_PLAYERS) {
      counting = eligible.slice(0, COUNTING_PLAYERS);
    } else {
      const frozen = players
        .filter(player => eliminatedStatuses.has(player.status) && player.score != null)
        .sort(scoreSort);
      counting = [...eligible, ...frozen.slice(0, COUNTING_PLAYERS - eligible.length)];
    }

    const total = counting.length === COUNTING_PLAYERS
      ? counting.reduce((sum,player) => sum + player.score, 0)
      : null;

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

function render() {
  const standings = compute();
  const leader = standings[0];
  document.querySelector('#leaderName').textContent = leader.total == null ? 'Waiting for scores' : leader.name;
  document.querySelector('#leaderScore').textContent = fmt(leader.total);

  document.querySelector('#teams').innerHTML = standings.map((team,index) => `
    <article class="team ${index === 0 && team.total != null ? 'leader' : ''}">
      <div class="teamhead">
        <div class="rank">${index + 1}</div>
        <div class="teamname">${team.name}</div>
        <div class="teamscore">${fmt(team.total)}</div>
      </div>
      <div class="players">
        ${team.players.map(player => {
          const counts = team.counting.some(counting => counting.name === player.name);
          const eliminated = eliminatedStatuses.has(player.status);
          return `<div class="player ${counts ? 'counting' : 'dropped'} ${eliminated ? 'cut' : ''}">
            <div class="player-topline">
              <div class="pname">${player.name}</div>
              <div class="pscore">${fmt(player.score)}</div>
            </div>
            <div class="meta">${progressText(player)}${player.round ? ` · R${player.round}` : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </article>`).join('');

  renderEditor();
}

function renderEditor() {
  document.querySelector('#editor').innerHTML = Object.values(teams).flat().map(name => {
    const player = getPlayer(name);
    return `<div class="editrow"><span>${name}</span><input data-name="${name}" type="number" placeholder="Score" value="${overrides[name]?.score ?? ''}"><select data-status="${name}"><option value="active" ${player.status === 'active' ? 'selected' : ''}>Active</option><option value="cut" ${player.status === 'cut' ? 'selected' : ''}>Cut</option><option value="wd" ${player.status === 'wd' ? 'selected' : ''}>WD</option><option value="dq" ${player.status === 'dq' ? 'selected' : ''}>DQ</option><option value="finished" ${player.status === 'finished' ? 'selected' : ''}>Finished</option></select></div>`;
  }).join('');

  document.querySelectorAll('input[data-name]').forEach(element => {
    element.onchange = () => save(element.dataset.name, element.value, document.querySelector(`[data-status="${element.dataset.name}"]`).value);
  });
  document.querySelectorAll('select[data-status]').forEach(element => {
    element.onchange = () => save(element.dataset.status, document.querySelector(`[data-name="${element.dataset.status}"]`).value, element.value);
  });
}

function save(name,score,status) {
  overrides[name] = {score: score === '' ? undefined : Number(score), status};
  localStorage.setItem('draftOverrides', JSON.stringify(overrides));
  render();
}

async function refresh() {
  const statusText = document.querySelector('#statusText');
  const dot = document.querySelector('#dot');
  statusText.textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/leaderboard');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    live = Object.fromEntries((data.players || []).map(player => [aliases(player.name), player]));
    statusText.textContent = `Live · ${data.source}`;
    dot.style.background = 'var(--accent)';
    document.querySelector('#updated').textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString()}`;
    if (data.eventName) document.querySelector('#eventName').textContent = data.eventName;
    render();
  } catch (error) {
    statusText.textContent = 'Manual mode · live feed unavailable';
    dot.style.background = 'var(--red)';
    document.querySelector('#updated').textContent = error.message;
    render();
  }
}

document.querySelector('#refresh').onclick = refresh;
document.querySelector('#clearOverrides').onclick = () => {
  overrides = {};
  localStorage.removeItem('draftOverrides');
  render();
};

render();
refresh();
setInterval(refresh, 60000);
