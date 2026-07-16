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
const aliases = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
let live = {}, overrides = JSON.parse(localStorage.getItem('draftOverrides')||'{}');
const fmt=s=>s==null?'—':s===0?'E':s>0?`+${s}`:`${s}`;
function getPlayer(name){const key=aliases(name);const found=Object.values(live).find(p=>aliases(p.name)===key)||{};return {...found,...(overrides[name]||{}),name,score:(overrides[name]?.score ?? found.score ?? null),status:(overrides[name]?.status ?? found.status ?? 'active')};}
function compute(){return Object.entries(teams).map(([name,names])=>{
 const players=names.map(getPlayer); const survivors=players.filter(p=>!['cut','wd','dq'].includes(p.status));
 let counting;
 if(survivors.length>=4) counting=[...survivors].filter(p=>p.score!=null).sort((a,b)=>a.score-b.score).slice(0,4);
 else {const eliminated=players.filter(p=>['cut','wd','dq'].includes(p.status)&&p.score!=null).sort((a,b)=>a.score-b.score);counting=[...survivors.filter(p=>p.score!=null),...eliminated.slice(0,4-survivors.length)];}
 const total=counting.length===4?counting.reduce((a,p)=>a+p.score,0):null;
 return {name,players,counting,total};
 }).sort((a,b)=>(a.total??999)-(b.total??999));}
function render(){const standings=compute();document.querySelector('#leaderName').textContent=standings[0].total==null?'Waiting for scores':standings[0].name;document.querySelector('#leaderScore').textContent=fmt(standings[0].total);
 document.querySelector('#teams').innerHTML=standings.map((t,i)=>`<article class="team ${i===0&&t.total!=null?'leader':''}"><div class="teamhead"><div class="rank">${i+1}</div><div class="teamname">${t.name}</div><div class="teamscore">${fmt(t.total)}</div></div><div class="players">${t.players.map(p=>{const count=t.counting.some(c=>c.name===p.name);const cls=[count?'counting':'dropped',['cut','wd','dq'].includes(p.status)?'cut':''].join(' ');return `<div class="player ${cls}"><div><div class="pname">${p.name}</div><div class="meta">${p.status==='active'?(p.thru?`Thru ${p.thru}`:'In play'):p.status.toUpperCase()}${p.round?` · R${p.round}`:''}</div></div><div class="pscore">${fmt(p.score)}</div></div>`}).join('')}</div></article>`).join('');
 renderEditor();}
function renderEditor(){document.querySelector('#editor').innerHTML=Object.values(teams).flat().map(name=>{const p=getPlayer(name);return `<div class="editrow"><span>${name}</span><input data-name="${name}" type="number" placeholder="Score" value="${overrides[name]?.score??''}"><select data-status="${name}"><option value="active" ${p.status==='active'?'selected':''}>Active</option><option value="cut" ${p.status==='cut'?'selected':''}>Cut</option><option value="wd" ${p.status==='wd'?'selected':''}>WD</option><option value="dq" ${p.status==='dq'?'selected':''}>DQ</option><option value="finished" ${p.status==='finished'?'selected':''}>Finished</option></select></div>`}).join('');
 document.querySelectorAll('input[data-name]').forEach(el=>el.onchange=()=>save(el.dataset.name,el.value,document.querySelector(`[data-status="${el.dataset.name}"]`).value));
 document.querySelectorAll('select[data-status]').forEach(el=>el.onchange=()=>save(el.dataset.status,document.querySelector(`[data-name="${el.dataset.status}"]`).value,el.value));}
function save(name,score,status){overrides[name]={score:score===''?undefined:Number(score),status};localStorage.setItem('draftOverrides',JSON.stringify(overrides));render();}
async function refresh(){const st=document.querySelector('#statusText'),dot=document.querySelector('#dot');st.textContent='Refreshing…';try{const r=await fetch('/api/leaderboard');const d=await r.json();if(!r.ok)throw new Error(d.error);live=Object.fromEntries((d.players||[]).map(p=>[aliases(p.name),p]));st.textContent=`Live · ${d.source}`;dot.style.background='var(--accent)';document.querySelector('#updated').textContent=`Updated ${new Date(d.updatedAt).toLocaleTimeString()}`;render();}catch(e){st.textContent='Manual mode · live feed unavailable';dot.style.background='var(--red)';document.querySelector('#updated').textContent=e.message;render();}}
document.querySelector('#refresh').onclick=refresh;document.querySelector('#clearOverrides').onclick=()=>{overrides={};localStorage.removeItem('draftOverrides');render()};render();refresh();setInterval(refresh,60000);
