
/* ---------- 5. ИНТЕРФЕЙС ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UI = { tab: 'map', sel: null, selArmy: null, view: { x: 0, y: 0, z: 0.6 }, ridgeA: 85, mapMode: 'pol', sborder: 'black', passcol: 'black' };
// хребты: в цвет владельца (по умолчанию) или всегда своего, коричневого цвета — настройка в меню
try { if (localStorage.getItem('poly_ridge') === 'own') UI.ridgeA = 190; UI.sborder = localStorage.getItem('poly_sborder') || 'black'; UI.passcol = localStorage.getItem('poly_passcol') || 'black'; } catch (e) { }
// граница держав: чёрная, красная или без неё (настройка в меню)
// перевал: [цвет пунктира, цвет подложки]
const PASSCOL = { black: ['#140c10', 'rgba(240,226,190,.75)'], red: ['#d21c1c', 'rgba(255,240,215,.7)'], brown: ['#4a2408', 'rgba(240,214,160,.8)'] };
const SBORDER = { black: 'rgba(12,4,12,.95)', red: 'rgba(205,22,22,.95)', none: null };
function toast(t) { const d = document.createElement('div'); d.textContent = t; $('toast').appendChild(d); setTimeout(() => d.remove(), 4200); while ($('toast').children.length > 4) $('toast').firstChild.remove(); }
function bar(v, max = 100, col) { return `<div class="bar"><i style="width:${clamp(v / max * 100, 0, 100)}%;${col ? 'background:' + col : ''}"></i></div>`; }
function sign(n) { n = Math.round(n); return (n >= 0 ? '+' : '') + n; }
function moodCol(m) { return m > 60 ? 'var(--good)' : m > 35 ? 'var(--warn)' : 'var(--bad)'; }

function renderAll() { if (!G) return; syncProv(); applyNames(); renderTop(); renderTabs(); if (UI.tab === 'map') { drawOverlay(); SELP.key = ''; drawVector(); renderMarkers(); renderSide(); } if (UI.tab === 'court') renderCourt(); if (UI.tab === 'state') renderState(); if (UI.tab === 'log') renderLog(); }

function renderTop() {
  const I = computeIncome();
  $('top').innerHTML = `<span class="date" id="tdate" title="${SEASONS[G.season]} ${G.year}">${dayDate()}</span>
   <span class="stat rul" title="${esc(ruler().desc)}">♛ ${esc(ruler().name)}</span>
   <span class="stat" title="Казна (тыс. иперпиров) и ожидаемый итог за сезон">⛁ ${fmt(G.treasury)} <span class="${I.total >= 0 ? 'good' : 'bad'}">(${sign(I.total)})</span></span>
   <span class="stat" title="Порядок в державе">⚖ Порядок ${Math.round(G.order)}</span>
   <span class="stat" title="Единство Церкви">☦ Церковь ${Math.round(G.church)}</span>
   <span class="stat" title="Престиж императора">✦ Престиж ${Math.round(G.prestige)}</span>
   <span class="stat" title="Областей у ромеев">▦ ${myRegions().length}</span>
   <span class="sp"></span>
   <span class="clock">${[['0', '❚❚', 'Пауза (пробел)'], ['1', '1', 'Скорость 1: день за 2 секунды (клавиша 1)'], ['2', '2', 'Скорость 2: день за секунду (2)'], ['3', '3', 'Скорость 3: день за полсекунды (3)'], ['4', '4', 'Скорость 4: 5 дней в секунду (4)'], ['5', '5', 'Скорость 5: 10 дней в секунду (5)']].map(([v, t, ti]) => `<button class="spd ${UI.speed === +v ? 'on' : ''}" data-spd="${v}" title="${ti}">${t}</button>`).join('')}</span>
   <button id="bMenu">Меню</button>`;
  $('top').querySelectorAll('[data-spd]').forEach(b => b.onclick = () => setSpeed(+b.dataset.spd));
  $('bMenu').onclick = showMenu;
}
function renderTabs() {
  const tabs = [['map', 'Карта'], ['court', 'Двор'], ['state', 'Государство'], ['log', 'Летопись']];
  $('tabs').innerHTML = tabs.map(([k, n]) => `<button class="${UI.tab === k ? 'sel' : ''}" data-t="${k}">${n}</button>`).join('') + `<span class="small muted" style="margin-left:auto;align-self:center">${G.autoBattle ? 'Бои: автоматически' : ''}</span>`;
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { UI.tab = b.dataset.t; ['map', 'court', 'state', 'log'].forEach(k => $('view-' + k).classList.toggle('hidden', k !== UI.tab)); renderAll(); });
}
async function doEndTurn(n) {
  if (busy || G.over) return;
  SFX.play('turn');
  for (let i = 0; i < n; i++) {
    const before = G.log.length ? G.log[0] : null;
    await endTurn();
    save();
    renderAll();
    if (G.over) { showFinale(); return; }
    const imp = G.log.slice(0, Math.max(0, G.log.indexOf(before))).some(l => l.k === 'imp');
    const threat = myRegions().some(r => G.armies.some(a => a.region === r.id && atWar('byz', a.owner)));
    if (n > 1 && (imp || threat)) break;
  }
}


/* --- звуки (синтез Web Audio, без файлов и без музыки) --- */
const SFX = (() => {
  let ctx = null, master = null;
  let on = true; try { on = localStorage.getItem('poly_sound') !== 'off'; } catch (e) { }
  function ac() {
    if (!on) return null;
    try {
      if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { return null; }
    return ctx;
  }
  function tone(f, dur, type = 'sine', vol = 0.08, delay = 0, f2 = null, lp = null) {
    const c = ac(); if (!c) return; const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o; if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, freq, vol = 0.1, delay = 0, type = 'bandpass', f2 = null) {
    const c = ac(); if (!c) return; const t = c.currentTime + delay;
    const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(freq, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(master); src.start(t);
  }
  const last = {};
  const S = {
    click: () => tone(1300, 0.035, 'square', 0.025, 0, 900, 3000),
    select: () => { tone(660, 0.09, 'sine', 0.07); tone(990, 0.12, 'sine', 0.045, 0.05); },
    army: () => { tone(196, 0.22, 'sawtooth', 0.05, 0, null, 900); tone(294, 0.3, 'sawtooth', 0.045, 0.1, null, 900); },
    turn: () => { tone(392, 1.1, 'sine', 0.11); tone(784, 0.7, 'sine', 0.035); tone(1176, 0.4, 'sine', 0.015); },
    event: () => { tone(523, 0.35, 'triangle', 0.06); tone(659, 0.4, 'triangle', 0.05, 0.09); tone(784, 0.55, 'triangle', 0.045, 0.18); },
    coin: () => { tone(1760, 0.07, 'square', 0.03, 0, null, 5000); tone(2350, 0.12, 'square', 0.025, 0.06, null, 5000); },
    hit: () => { noise(0.14, 900, 0.22); tone(150, 0.12, 'square', 0.05, 0, 70, 600); },
    arrow: () => { noise(0.22, 2500, 0.07, 0, 'bandpass', 6000); },
    rout: () => tone(330, 0.5, 'sawtooth', 0.045, 0, 140, 1200),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, 'triangle', 0.07, i * 0.11)),
    lose: () => [440, 349, 294, 220].forEach((f, i) => tone(f, 0.5, 'sine', 0.07, i * 0.15)),
    alert: () => { tone(880, 0.12, 'sine', 0.06); tone(660, 0.16, 'sine', 0.05, 0.11); },
    error: () => tone(170, 0.16, 'square', 0.04, 0, null, 900),
    bell: () => { tone(262, 2.2, 'sine', 0.12); tone(523, 1.6, 'sine', 0.05); tone(659, 1.2, 'sine', 0.025); },
  };
  return {
    play(k) { try { const now = Date.now(); if (!on || !S[k] || (last[k] && now - last[k] < 350)) return; last[k] = now; S[k](); } catch (e) { } },
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('poly_sound', on ? 'on' : 'off'); } catch (e) { } if (on) S.select(); return on; },
  };
})();
if (!HEADLESS) document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button') && !e.target.closest('.nosfx')) SFX.play('click'); }, true);

/* --- заранее загружаем карту (с самого титульного экрана), со шкалой загрузки --- */
const PRE = { got: {}, total: { img: 3300000, ids: 600000 }, p: null, ready: false, imgOk: false };
function prefetch(url, key) {
  if (typeof fetch === 'undefined' || location.protocol === 'file:') return Promise.resolve(url);
  return fetch(url).then(r => {
    if (!r.ok || !r.body) return url;
    const len = +r.headers.get('content-length'); if (len) PRE.total[key] = len;
    const rd = r.body.getReader(), parts = []; let got = 0;
    const pump = () => rd.read().then(({ done, value }) => {
      if (done) { PRE.got[key] = PRE.total[key] = got; loadProgress(); return URL.createObjectURL(new Blob(parts)); }
      parts.push(value); got += value.length; PRE.got[key] = got; loadProgress(); return pump();
    });
    return pump();
  }).catch(() => url);
}
function loadProgress() {
  if (HEADLESS) return;
  const got = (PRE.got.img || 0) + (PRE.got.ids || 0), tot = PRE.total.img + PRE.total.ids;
  const pct = Math.min(100, Math.round(got / tot * 100)), done = PRE.ready && PRE.imgOk;
  const txt = got >= tot ? 'Подготовка карты…' : `Загрузка карты: ${pct}%`;
  const tf = document.getElementById('tfill'); if (tf) tf.style.width = pct + '%';
  const tt = document.getElementById('ttxt'); if (tt) tt.textContent = got >= tot ? 'Карта загружена' : txt;
  if (got >= tot && document.getElementById('tload')) document.getElementById('tload').classList.add('done');
  const ml = document.getElementById('maploading');
  if (ml) { ml.querySelector('.lfill').style.width = pct + '%'; ml.querySelector('.ltxt').textContent = txt; ml.classList.toggle('done', done); }
}
// стиль подложки: акварель (по умолчанию) или прежняя «снимок»; выбор — в меню, запоминается
const MAPSTYLE = (() => { try { return localStorage.getItem('poly_style') || 'wc'; } catch (e) { return 'wc'; } })();
const WCV = MAPSTYLE === 'wc2' ? '2' : '', ISWC = MAPSTYLE === 'wc' || MAPSTYLE === 'wc2';
const MAPSRC = ISWC ? `map_wc${WCV}.jpg` : 'map.jpg', HIDIR = ISWC ? `hi_wc${WCV}` : 'hi';
const STYLENAMES = { wc: 'акварель, крупные значки', wc2: 'акварель, мелкие значки', sat: 'прежний' };
if (!HEADLESS) PRE.p = { img: prefetch(MAPSRC, 'img'), ids: prefetch('ids.png', 'ids') };
/* --- версия игры: номер сборки; раз в минуту проверяем, не вышла ли новая --- */
function versionText(v) { return v ? `версия ${v.v} · ${v.date}` : ''; }
function checkVersion() {
  if (HEADLESS || typeof fetch === 'undefined' || location.protocol === 'file:' || typeof GAME_VERSION === 'undefined') return;
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => {
    if (!v || v.v <= GAME_VERSION.v || document.getElementById('newver')) return;
    const d = document.createElement('div'); d.id = 'newver';
    d.innerHTML = `Вышла новая ${esc(versionText(v))}. <button class="small main">Обновить</button>`;
    d.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(d);
  }).catch(() => { });
}
if (!HEADLESS) { setTimeout(checkVersion, 4000); setInterval(checkVersion, 60000); }

/* --- названия: базовые, свои (переименованные игроком) и динамические (зависят от хозяина) --- */
let BASE_RNAME = null, BASE_PNAME = null;
// группа державы для динамических названий: '*greek', '*turk', '*latin' и т. п. (см. DYN_NAMES в данных)
function nameGroup(f) { const F = FACTIONS[f] || {}; return F.greek ? 'greek' : (['seljuk', 'rum_east', 'osman', 'germiyan', 'menteshe', 'denizli', 'aydin', 'karasi', 'candar', 'karaman', 'mengujek'].includes(f) ? 'turk' : ''); }
function dynName(e, owner) { return e ? (e[owner] || e['*' + nameGroup(owner)] || null) : null; }
function applyNames() {
  if (!BASE_RNAME) { BASE_RNAME = Object.assign({}, RNAME); BASE_PNAME = (MAPINFO.provs || []).map(p => p[4]); }
  if (!G.names) G.names = { r: {}, p: {} };
  const DN = typeof DYN_NAMES !== 'undefined' ? DYN_NAMES : { regions: {}, provs: {} };
  for (const id in G.regions) RNAME[id] = G.names.r[id] || dynName(DN.regions[id], G.regions[id].owner) || BASE_RNAME[id];
  for (const k in ALIAS) RNAME[k] = RNAME[ALIAS[k]];
  if (MAPINFO.provs) MAPINFO.provs.forEach((p, k) => { p[4] = G.names.p[k] || dynName(DN.provs[k] || DN.provs[BASE_PNAME[k]], G.prov && G.prov[k]) || BASE_PNAME[k]; });
}
function renameAsk(kind, key) {
  if (key == null) return;
  const cur = kind === 'r' ? RNAME[key] : MAPINFO.provs[key][4], base = kind === 'r' ? BASE_RNAME[key] : BASE_PNAME[key];
  const v = prompt(`Новое название ${kind === 'r' ? 'региона' : 'провинции'} (пусто — вернуть «${base}»):`, cur);
  if (v === null) return;
  const t = v.trim().slice(0, 60);
  if (t && t !== base) G.names[kind][key] = t; else delete G.names[kind][key];
  renderAll(); toast(t && t !== base ? `Переименовано: «${t}».` : `Возвращено название «${base}».`);
}
// свои названия — в файл (его можно прислать автору карты, чтобы названия вошли в игру)
function exportNames() {
  applyNames();
  const out = { regions: Object.keys(G.names.r).map(id => ({ id, base: BASE_RNAME[id], name: G.names.r[id] })), provinces: Object.keys(G.names.p).map(k => ({ i: +k, base: BASE_PNAME[k], name: G.names.p[k] })) };
  if (!out.regions.length && !out.provinces.length) { toast('Вы ещё ничего не переименовали.'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })); a.download = 'polychronion-names.json'; a.click();
}

/* --- поиск по карте: регионы, провинции, земли за краем карты --- */
function searchMap(q) {
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const res = [], M = MAPINFO, OLD = M.oldnames || {};
  const hit = n => n && (n.toLowerCase().includes(q) || (OLD[n] && OLD[n].toLowerCase().includes(q)));
  const was = n => OLD[n] && !n.toLowerCase().includes(q) ? ` (прежде: ${OLD[n]})` : '';
  (ID_BY_IDX || []).forEach(id => { if (hit(RNAME[id])) res.push({ t: 'Регион' + was(RNAME[id]), n: RNAME[id], go: () => focusOn(M.pos[id], () => { UI.selOuter = -1; UI.selProv = null; clickRegion(id); }) }); });
  (M.provs || []).forEach((p, k) => { if (p[0] >= 0 && hit(p[4])) res.push({ t: 'Провинция · ' + RNAME[ID_BY_IDX[p[0]]] + was(p[4]), n: p[4], go: () => focusOn([p[1], p[2]], () => { UI.selOuter = -1; UI.selProv = k; clickRegion(ID_BY_IDX[p[0]]); }) }); });
  (M.outer || []).forEach((o, i) => { if (hit(o[0])) res.push({ t: 'За пределами карты' + was(o[0]), n: o[0], go: () => focusOn([o[1], o[2]], () => { UI.sel = null; UI.selArmy = null; UI.selOuter = i; renderAll(); }) }); });
  const starts = r => r.n.toLowerCase().startsWith(q) ? 0 : 1;
  return res.sort((a, b) => starts(a) - starts(b) || (a.t[0] === 'Р' ? -1 : 1) - (b.t[0] === 'Р' ? -1 : 1)).slice(0, 14);
}
function focusOn(pt, then) {
  if (!pt) { then(); return; }
  const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight, z = Math.max(UI.view.z, 1.4);
  UI.view.z = z; UI.view.x = w / 2 - pt[0] * z; UI.view.y = h / 2 - pt[1] * z; clampView(); applyView(); then();
}
function setupSearch() {
  const inp = $('msearch'), box = $('msres'); let list = [], on = 0;
  const show = () => { box.innerHTML = list.map((r, i) => `<div data-i="${i}" class="${i === on ? 'on' : ''}">${esc(r.n)} <span class="k">${esc(r.t)}</span></div>`).join('') || '<div class="k">Ничего не найдено</div>'; box.classList.toggle('hidden', inp.value.trim().length < 2); };
  const sb = $('msearchbox'), open = v => { sb.classList.toggle('hidden', !v); if (v) { inp.value = ''; list = []; box.classList.add('hidden'); setTimeout(() => inp.focus(), 0); } };
  $('zsearch').onclick = e => { e.stopPropagation(); open(sb.classList.contains('hidden')); };
  document.addEventListener('keydown', e => { if (e.key === '/' && UI.tab === 'map' && document.activeElement !== inp && !$('app').classList.contains('hidden')) { e.preventDefault(); open(true); } });
  const pickI = i => { const r = list[i]; if (!r) return; open(false); inp.blur(); SFX.play('select'); r.go(); };
  inp.addEventListener('input', () => { list = searchMap(inp.value); on = 0; show(); });
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'ArrowDown') { on = Math.min(list.length - 1, on + 1); show(); e.preventDefault(); } else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); show(); e.preventDefault(); } else if (e.key === 'Enter') pickI(on); else if (e.key === 'Escape') { open(false); inp.blur(); } });
  box.addEventListener('pointerdown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pickI(+d.dataset.i); } });
  ['pointerdown', 'wheel'].forEach(ev => $('msearchbox').addEventListener(ev, e => e.stopPropagation()));
  inp.addEventListener('blur', () => setTimeout(() => { if (!inp.value.trim()) open(false); else box.classList.add('hidden'); }, 150));
}

/* --- карта --- */
let regionGrid = null, borderSegs = null, ID_BY_IDX = null;
// Попиксельная карта провинций: ids.png (номер провинции в цвете пикселя). Если браузер не даёт прочитать
// пиксели (файл открыт с диска), остаётся запасная грубая сетка регионов.
const PIX = { ids: null, w: 0, h: 0, s: 2, buf: null, provReg: null };
const MAXZ = 6;   // запас приближения — под будущие объекты на карте
function initMap() {
  const M = MAPINFO;
  ID_BY_IDX = M.ids;
  regionGrid = new Int16Array(M.GW * M.GH).fill(-1);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let i = 0, p = 0; const s = M.rle;
  while (p < s.length) { let n = 0; while (s[p] >= '0' && s[p] <= '9') n = n * 10 + (s.charCodeAt(p++) - 48); const ch = s[p++]; const v = ch === '.' ? -1 : (M.abase ? ch.charCodeAt(0) - M.abase : alpha.indexOf(ch)); for (let k = 0; k < (n || 1); k++) regionGrid[i++] = v; }
  borderSegs = [];
  for (let y = 0; y < M.GH; y++) for (let x = 0; x < M.GW; x++) {
    const a = regionGrid[y * M.GW + x];
    if (x + 1 < M.GW) { const b = regionGrid[y * M.GW + x + 1]; if (a !== b && a >= 0 && b >= 0) borderSegs.push([a, b, (x + 1) * M.C, y * M.C, (x + 1) * M.C, (y + 1) * M.C]); }
    if (y + 1 < M.GH) { const b = regionGrid[(y + 1) * M.GW + x]; if (a !== b && a >= 0 && b >= 0) borderSegs.push([a, b, x * M.C, (y + 1) * M.C, (x + 1) * M.C, (y + 1) * M.C]); }
  }
  const cv = document.createElement('canvas'); PIX.tint = cv; cv.width = Math.ceil(M.W / 2); cv.height = Math.ceil(M.H / 2);
  $('mapinner').style.width = M.W + 'px'; $('mapinner').style.height = M.H + 'px';
  $('mapover').style.width = M.W + 'px'; $('mapover').style.height = M.H + 'px';
  $('mapimg').width = M.W; $('mapimg').height = M.H;
  $('mapimg').onload = () => { PIX.bgHalf = null; PRE.imgOk = true; loadProgress(); scheduleVector(); };
  $('mapimg').onerror = () => { PIX.noImg = true; PRE.imgOk = true; loadProgress(); scheduleVector(); };
  PRE.p.img.then(u => { $('mapimg').src = u; });
  if (M.provs) {
    PIX.provReg = new Int16Array(M.provs.length + 1).fill(-1);
    M.provs.forEach((p, k) => PIX.provReg[k + 1] = p[0]);
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, im.width, im.height).data;
        const ids = new Uint16Array(im.width * im.height);
        const mtn = new Uint8Array(ids.length), outer = new Uint8Array(ids.length);
        for (let k = 0; k < ids.length; k++) { ids[k] = (d[k * 4] << 8) | d[k * 4 + 1]; const b = d[k * 4 + 2]; mtn[k] = b > 200 ? 1 : b >= 170 && b <= 190 ? 2 : b >= 162 && b <= 168 ? 3 : 0; if (b >= 100 && b < 160) outer[k] = b - 99; }   // 1 — горы, 2 — река
        PIX.mtn = mtn; PIX.outer = outer;
        if (ISWC) {   // акварель: прозрачнее цвет державы ровно там, где нарисованы горы, леса и реки
          const rm = new Image(); rm.onload = () => { try { const c2 = document.createElement('canvas'); c2.width = rm.width; c2.height = rm.height; const x2 = c2.getContext('2d'); x2.drawImage(rm, 0, 0); const q = x2.getImageData(0, 0, rm.width, rm.height).data; for (let k2 = 0; k2 < mtn.length; k2++) { const b = q[k2 * 4]; mtn[k2] = b > 200 ? 1 : b >= 170 && b <= 190 ? 2 : b >= 162 && b <= 168 ? 3 : 0; } if (G) { drawOverlay(); PIX.vtKey = ''; scheduleVector(); } } catch (e) { } }; rm.src = `relief_wc${WCV}.png`;
        }
        PIX.ids = ids; PIX.w = im.width; PIX.h = im.height; PIX.s = M.idsScale || 2;
        const np = M.provs.length + 1, bb = new Int32Array(np * 4);
        for (let k = 0; k < np; k++) { bb[k * 4] = 1e9; bb[k * 4 + 1] = 1e9; bb[k * 4 + 2] = -1; bb[k * 4 + 3] = -1; }
        for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const v = ids[y * im.width + x]; if (!v) continue; const o = v * 4; if (x < bb[o]) bb[o] = x; if (y < bb[o + 1]) bb[o + 1] = y; if (x > bb[o + 2]) bb[o + 2] = x; if (y > bb[o + 3]) bb[o + 3] = y; }
        PIX.bb = bb;
        cv.width = PIX.w; cv.height = PIX.h; PIX.buf = null;
        PRE.ready = true; loadProgress();
        if (G) renderAll();
      } catch (e) { PIX.idsFailed = true; if (G) renderAll(); /* файл открыт с диска: работает запасная сетка */ }
    };
    im.onerror = () => { PIX.idsFailed = true; if (G) renderAll(); };
    PRE.p.ids.then(u => { im.src = u; });
  }
  setupPanZoom(); setupSearch(); loadProgress();
  fitMap();
}
function fitMap() {
  const w = $('mapwrap').clientWidth || 800, h = $('mapwrap').clientHeight || 600;
  const f = MAPINFO.focus || [0, 0, MAPINFO.W, MAPINFO.H];
  const z = clamp(Math.min(w / (f[2] - f[0]), h / (f[3] - f[1])), minZoom(), MAXZ);
  UI.view.z = z; UI.view.x = w / 2 - (f[0] + f[2]) / 2 * z; UI.view.y = h / 2 - (f[1] + f[3]) / 2 * z; clampView(); applyView();
}
function minZoom() { const w = $('mapwrap').clientWidth || 800, h = $('mapwrap').clientHeight || 600; return Math.max(w / MAPINFO.W, h / MAPINFO.H); }   // карта всегда закрывает окно — без полос по краям
function clampView() { const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight, v = UI.view; const mw = MAPINFO.W * v.z, mh = MAPINFO.H * v.z; v.x = mw < w ? (w - mw) / 2 : clamp(v.x, w - mw, 0); v.y = mh < h ? (h - mh) / 2 : clamp(v.y, h - mh, 0); }
function applyView() {
  const z = UI.view.z, k = MAPINFO.W / 4000; // подписи держат читаемый размер при отдалении

  $('markers').style.setProperty('--s', clamp(1.2 / (z * k), 0.3, 2.2).toFixed(3));
  $('markers').classList.toggle('far', z * k < 0.5 && REGION_DEFS.length > 40);
  $('markers').classList.toggle('near', z * k >= 1.5);
  const tp = $('ptip'); if (tp) tp.classList.add('hidden');
  UI.lastMove = performance.now();
  if (typeof scheduleVector === 'function') scheduleVector();
}
function zoomAt(f, cx, cy) { const v = UI.view; const nz = clamp(v.z * f, minZoom(), MAXZ); v.x = cx - (cx - v.x) * nz / v.z; v.y = cy - (cy - v.y) * nz / v.z; v.z = nz; clampView(); applyView(); }
function setupPanZoom() {
  const w = $('mapwrap'); let drag = null; const pts = new Map(); let pinch = null;
  w.addEventListener('wheel', e => { e.preventDefault(); const r = w.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  w.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return;   // правая кнопка — отмена приказа, не щелчок
    pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, vx: UI.view.x, vy: UI.view.y, moved: false }; else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: UI.view.z }; } });
  w.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const r = w.getBoundingClientRect(); zoomAt(pinch.z * d / pinch.d / UI.view.z, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); if (drag) drag.moved = true; return; }
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) { UI.view.x = drag.vx + dx; UI.view.y = drag.vy + dy; clampView(); applyView(); w.style.cursor = 'grabbing'; }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; w.style.cursor = ''; if (pts.size === 0) { const d = drag; drag = null; if (d && !d.moved && e.type === 'pointerup') mapClick(e); } };
  w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
  let tipRaf = 0;
  w.addEventListener('pointermove', e => {
    if (drag && drag.moved) { $('ptip').classList.add('hidden'); return; }
    if (tipRaf) return; const cx = e.clientX, cy = e.clientY;
    tipRaf = requestAnimationFrame(() => { tipRaf = 0; provTip(cx, cy); });
  });
  w.addEventListener('pointerleave', () => $('ptip').classList.add('hidden'));
  $('zin').onclick = e => { e.stopPropagation(); zoomAt(1.3, w.clientWidth / 2, w.clientHeight / 2); };
  $('zout').onclick = e => { e.stopPropagation(); zoomAt(1 / 1.3, w.clientWidth / 2, w.clientHeight / 2); };
  $('zfit').onclick = e => { e.stopPropagation(); fitMap(); };
  w.addEventListener('contextmenu', e => {
    e.preventDefault();
    const t = e.target.closest && e.target.closest('.ar'), a = G && G.armies.find(x => x.id === (t ? +t.dataset.army : UI.selArmy));
    if (a && a.owner === 'byz' && (a.path.length || a.leg)) { a.path = []; SFX.play('click'); toast(`${a.name}: приказ отменён${a.leg ? ', войско возвращается' : ''}.`); renderAll(); }
  });
  $('zmode').onclick = e => { e.stopPropagation(); setMapMode(UI.mapMode === 'geo' ? 'pol' : 'geo'); };
  ['zin', 'zout', 'zfit', 'zsearch', 'zmode'].forEach(id => $(id).addEventListener('pointerdown', e => e.stopPropagation()));
  window.addEventListener('resize', () => { clampView(); applyView(); });
}
function provAt(clientX, clientY) {
  if (!PIX.ids) return -1;
  const r = $('mapwrap').getBoundingClientRect();
  const mx = (clientX - r.left - UI.view.x) / UI.view.z, my = (clientY - r.top - UI.view.y) / UI.view.z;
  const px = Math.floor(mx / PIX.s), py = Math.floor(my / PIX.s);
  if (px < 0 || py < 0 || px >= PIX.w || py >= PIX.h) return -1;
  return idsNear(px, py) - 1;
}
// земля за краем игровой карты под точкой: индекс в MAPINFO.outer или -1
function outerAt(px, py) {
  if (!PIX.outer || !MAPINFO.outer) return -1;
  return PIX.outer[py * PIX.w + px] - 1;   // номер земли записан в карте провинций (синий канал)
}
// номер провинции под точкой; если там море — ближайший клочок суши в радиусе ~9 экранных пикселей (мелкие острова)
function idsNear(px, py) {
  const W = PIX.w, H = PIX.h, ids = PIX.ids, v = ids[py * W + px];
  if (v) return v;
  const r = Math.min(14, Math.ceil(9 / UI.view.z / PIX.s)); let best = 0, bd = 1e9;
  for (let y = Math.max(0, py - r); y <= Math.min(H - 1, py + r); y++) for (let x = Math.max(0, px - r); x <= Math.min(W - 1, px + r); x++) {
    const u = ids[y * W + x]; if (!u) continue; const d = (x - px) * (x - px) + (y - py) * (y - py); if (d < bd && d <= r * r) { bd = d; best = u; }
  }
  return best;
}
function outerAtClient(clientX, clientY) {
  if (!PIX.ids) return -1;
  const r = $('mapwrap').getBoundingClientRect();
  const px = Math.floor((clientX - r.left - UI.view.x) / UI.view.z / PIX.s), py = Math.floor((clientY - r.top - UI.view.y) / UI.view.z / PIX.s);
  if (px < 0 || py < 0 || px >= PIX.w || py >= PIX.h) return -1;
  return outerAt(px, py);
}
function provTip(cx, cy) {
  const t = $('ptip'), k = provAt(cx, cy);
  if (k < 0 && G) { const oi = outerAtClient(cx, cy); if (oi >= 0) { t.innerHTML = `<b>${esc(MAPINFO.outer[oi][0])}</b> <span class="muted">· за пределами карты</span>`; t.style.left = (cx + 14) + 'px'; t.style.top = (cy + 16) + 'px'; t.classList.remove('hidden'); return; } }
  if (k < 0 || !G) { t.classList.add('hidden'); return; }
  const p = MAPINFO.provs[k], o = (G.prov && G.prov[k]) || null, reg = p[0] >= 0 ? R(ID_BY_IDX[p[0]]) : null;
  t.innerHTML = `<b>${esc(p[4])}</b> · <span style="color:${o && FACTIONS[o] ? FACTIONS[o].color : '#ccc'}">■</span> ${o ? esc(fshort(o)) : '—'}${reg ? ` <span class="muted">· ${esc(RNAME[reg.id])}</span>` : ''}`;
  t.style.left = (cx + 14) + 'px'; t.style.top = (cy + 16) + 'px'; t.classList.remove('hidden');
}
function mapClick(e) {
  const t = e.target.closest('.ar,.rm');
  if (t) { if (t.dataset.army) clickArmy(+t.dataset.army); else if (t.dataset.reg) { UI.selProv = null; clickRegion(t.dataset.reg); } return; }
  const r = $('mapwrap').getBoundingClientRect();
  const mx = (e.clientX - r.left - UI.view.x) / UI.view.z, my = (e.clientY - r.top - UI.view.y) / UI.view.z;
  let idx = -1, prov = null;
  if (PIX.ids) {
    const px = Math.floor(mx / PIX.s), py = Math.floor(my / PIX.s);
    if (px >= 0 && py >= 0 && px < PIX.w && py < PIX.h) { const v = idsNear(px, py); if (v) { prov = v - 1; idx = PIX.provReg[v]; } }
  } else {
    const gx = Math.floor(mx / MAPINFO.C), gy = Math.floor(my / MAPINFO.C);
    if (gx >= 0 && gy >= 0 && gx < MAPINFO.GW && gy < MAPINFO.GH) idx = regionGrid[gy * MAPINFO.GW + gx];
  }
  if (idx >= 0) { UI.selOuter = -1; UI.selProv = prov; UI.addWay = e.ctrlKey || e.metaKey || e.shiftKey; SFX.play('select'); clickRegion(ID_BY_IDX[idx]); }
  else if (outerAtClient(e.clientX, e.clientY) >= 0) { UI.selOuter = outerAtClient(e.clientX, e.clientY); UI.sel = null; UI.selArmy = null; UI.selProv = null; SFX.play('select'); renderAll(); }
  else { UI.selOuter = -1; UI.sel = null; UI.selArmy = null; UI.selProv = null; renderAll(); }
}
function clickRegion(id) {
  const a = UI.selArmy && G.armies.find(x => x.id === UI.selArmy);
  const tp = UI.selProv != null && provReg(UI.selProv) === RID(id) ? UI.selProv : null;
  if (a && a.owner === 'byz' && UI.addWay && tp != null && (a.path.length || a.leg)) {
    UI.addWay = false;
    if (addWaypoint(a, id, tp)) { toast(`Маршрут продлён до «${MAPINFO.provs[tp][4]}» — всего ≈ ${pathDays(a)} дн.`); UI.selProv = null; renderAll(); }
    else toast('Туда от последней точки маршрута не пройти.');
    return;
  }
  UI.addWay = false;
  if (a && a.owner === 'byz' && (RID(id) !== RID(a.region) || (tp != null && tp !== armyProv(a)))) {
    if (setArmyPath(a, id, tp)) { const last = a.path[a.path.length - 1]; toast(`${a.name}: поход в «${MAPINFO.provs[last][4]}» (${RNAME[provReg(last)]}) — около ${pathDays(a)} дн.${UI.speed ? '' : ' Время на паузе: нажмите 1–5.'}`); UI.selProv = null; renderAll(); return; }
    else toast(canEnter('byz', id) ? 'Туда не пройти (нужен флот или путь через чужие земли).' : `С державой «${fshort(R(id).owner)}» нет войны — войти нельзя.`);
  }
  UI.sel = id; UI.selArmy = null; renderAll();
}
function clickArmy(id) {
  const a = G.armies.find(x => x.id === id); if (!a) return;
  if (UI.selArmy !== id) SFX.play('army');
  if (UI.selArmy === id) { UI.selArmy = null; UI.sel = a.region; } else { UI.selArmy = id; UI.sel = a.region; }
  renderAll();
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function drawOverlay() {
  const M = MAPINFO, cv = PIX.tint, ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  const selIdx = UI.sel ? ID_BY_IDX.indexOf(R(UI.sel) ? R(UI.sel).id : UI.sel) : -1;
  const ownIdx = {}; let on = 0; const oi = o => (o in ownIdx) ? ownIdx[o] : (ownIdx[o] = on++);
  const hex = f => { const n = parseInt(((FACTIONS[f] || {}).color || '#808080').slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const regOwn = new Int16Array(ID_BY_IDX.length), regCol = ID_BY_IDX.map((id, k) => { const o = R(id).owner; regOwn[k] = oi(o); return hex(o); });
  const NP = (MAPINFO.provs || []).length;
  const pOwn = new Int16Array(NP + 1).fill(-1), pCol = new Array(NP + 1);
  for (let k = 0; k < NP; k++) { const o = (G.prov && G.prov[k]) || (MAPINFO.provs[k][0] >= 0 ? R(ID_BY_IDX[MAPINFO.provs[k][0]]).owner : null); if (!o) continue; pOwn[k + 1] = oi(o); pCol[k + 1] = hex(o); }
  const pFree = new Uint8Array(NP + 1);
  for (let k = 0; k < NP; k++) if (G.prov && G.prov[k] === 'free') { pFree[k + 1] = 1; pCol[k + 1] = [40, 40, 40]; }
  PIX.pColD = pCol.map(c => c && [c[0] * 0.5 | 0, c[1] * 0.5 | 0, c[2] * 0.5 | 0]);
  PIX.pCol = pCol; PIX.pOwn = pOwn; PIX.pFree = pFree; PIX.vtKey = '';
  if (PIX.ids) {
    // раскраска для отдалённого вида: вполовину разрешения (выборка каждого второго пикселя карты провинций)
    const tw = cv.width, th = cv.height, W = PIX.w, ids = PIX.ids, pr = PIX.provReg, st = W / tw;
    if (!PIX.buf || PIX.buf.width !== tw) PIX.buf = ctx.createImageData(tw, th);
    const d = PIX.buf.data; d.fill(0);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(PIX.h - 1, Math.floor(y * st)) * W;
      for (let x = 0; x < tw; x++) {
        const i = sy + Math.min(W - 1, Math.floor(x * st)), v = ids[i];
        if (!v) { if (PIX.outer && PIX.outer[i]) { const o = (y * tw + x) * 4; d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175; } continue; }   // земли за краем зоны — серая вуаль
        if (pr[v] < 0 || pOwn[v] < 0) continue;
        const m = PIX.mtn && PIX.mtn[i] && !pFree[v], c = pCol[v], o = (y * tw + x) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = pFree[v] ? (((x + y) % 5 === 0 || (x - y + 9999) % 5 === 0) ? 110 : 0) : (m ? (PIX.mtn[i] === 2 ? 20 : PIX.mtn[i] === 3 ? 115 : UI.ridgeA) : 190);
      }
    }
    ctx.putImageData(PIX.buf, 0, 0);
  } else if (PIX.idsFailed || !M.provs) {
    // запасной режим: грубая сетка регионов (только если точная карта провинций недоступна)
    const off = document.createElement('canvas'); off.width = M.GW; off.height = M.GH;
    const oc = off.getContext('2d'); const img = oc.createImageData(M.GW, M.GH);
    for (let i = 0; i < regionGrid.length; i++) { const v = regionGrid[i]; if (v < 0) continue; const c = regCol[v]; img.data.set([c[0], c[1], c[2], v === selIdx ? 160 : 112], i * 4); }
    oc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, cv.width, cv.height);
    ctx.setTransform(cv.width / M.W, 0, 0, cv.height / M.H, 0, 0);
    const thick = new Path2D();
    if (typeof BORDERS === 'undefined') for (const [a, b, x1, y1, x2, y2] of borderSegs) if (regOwn[a] !== regOwn[b]) { thick.moveTo(x1, y1); thick.lineTo(x2, y2); }
    ctx.strokeStyle = 'rgba(15,5,15,.85)'; ctx.lineWidth = 3; ctx.stroke(thick);
  }
}
/* --- чёткий векторный контур выделения (SVG поверх карты) ---
   Берём пиксели провинции (или региона) из ids.png, обходим их границу,
   сглаживаем углы (алгоритм Чайкина) и рисуем линией постоянной толщины на экране. */
const SEL_CACHE = {};
function traceOutline(test, x0, y0, x1, y1) {
  const W = PIX.w, ids = PIX.ids, next = new Map();
  const add = (ax, ay, bx, by) => { const k = ax * 65536 + ay; (next.get(k) || next.set(k, []).get(k)).push(bx * 65536 + by); };
  const inS = (x, y) => x >= 0 && y >= 0 && x < W && y < PIX.h && test(ids[y * W + x]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!test(ids[y * W + x])) continue;
    if (!inS(x, y - 1)) add(x, y, x + 1, y);
    if (!inS(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inS(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inS(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [start] of next) {
    if (!next.get(start) || !next.get(start).length) continue;
    const pts = []; let k = start, guard = 0;
    while (guard++ < 200000) {
      const lst = next.get(k); if (!lst || !lst.length) break;
      const n = lst.pop(); pts.push([k >> 16 & 0xffff, k & 0xffff]); k = n;
      if (k === start) break;
    }
    if (pts.length >= 4) loops.push(pts);
  }
  const S = PIX.s;
  return loops.map(pts => {
    // убрать промежуточные точки на прямых, затем два прохода сглаживания
    let p = pts.filter((q, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return !((a[0] === q[0] && q[0] === b[0]) || (a[1] === q[1] && q[1] === b[1])); });
    if (p.length < 3) p = pts;
    for (let it = 0; it < 2; it++) { const r = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; r.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } p = r; }
    return 'M' + p.map(q => (q[0] * S).toFixed(1) + ' ' + (q[1] * S).toFixed(1)).join('L') + 'Z';
  }).join('');
}
function provOutline(k) {
  const key = 'p' + k; if (SEL_CACHE[key]) return SEL_CACHE[key];
  const v = k + 1, o = v * 4, bb = PIX.bb; if (bb[o + 2] < 0) return '';
  return SEL_CACHE[key] = traceOutline(x => x === v, bb[o], bb[o + 1], bb[o + 2], bb[o + 3]);
}
function regionOutline(ri) {
  const key = 'r' + ri; if (SEL_CACHE[key]) return SEL_CACHE[key];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const bb = PIX.bb, pr = PIX.provReg;
  for (let v = 1; v < pr.length; v++) if (pr[v] === ri && bb[v * 4 + 2] >= 0) { x0 = Math.min(x0, bb[v * 4]); y0 = Math.min(y0, bb[v * 4 + 1]); x1 = Math.max(x1, bb[v * 4 + 2]); y1 = Math.max(y1, bb[v * 4 + 3]); }
  if (x1 < 0) return '';
  return SEL_CACHE[key] = traceOutline(x => x > 0 && pr[x] === ri, x0, y0, x1, y1);
}
/* --- подложка высокого разрешения: плитки hi/X_Y.jpg (512×512 карты в 1024×1024), грузятся только видимые --- */
const HI = { idx: null, img: new Map(), use: 0 };
if (!HEADLESS && typeof fetch !== 'undefined' && location.protocol !== 'file:') fetch(HIDIR + '/index.json').then(r => r.ok ? r.json() : null).then(j => { if (j) { HI.idx = j; HI.has = new Set(j.tiles.map(t => t[0] + '_' + t[1])); } }).catch(() => { });
function drawHiTiles(ctx, vx0, vy0, vx1, vy1, toS) {
  const T = HI.idx.T, tx0 = Math.floor(vx0 / T), ty0 = Math.floor(vy0 / T), tx1 = Math.floor((vx1 - 1) / T), ty1 = Math.floor((vy1 - 1) / T);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingQuality = 'high';
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const key = tx + '_' + ty; if (!HI.has.has(key)) continue;
    let e = HI.img.get(key);
    if (!e) { const im = new Image(); e = { im, ok: false }; im.onload = () => { e.ok = true; scheduleVector(); }; im.src = HIDIR + '/' + key + '.jpg'; HI.img.set(key, e); }
    e.use = ++HI.use;
    if (!e.ok) continue;
    const [a, b] = toS(tx * T, ty * T), [c, d] = toS(tx * T + e.im.naturalWidth / 2, ty * T + e.im.naturalHeight / 2);
    ctx.drawImage(e.im, a, b, c - a, d - b);
  }
  ctx.restore();
  if (HI.img.size > 40) { const old = [...HI.img.entries()].sort((p, q) => p[1].use - q[1].use).slice(0, HI.img.size - 40); for (const [k] of old) HI.img.delete(k); }   // держим в памяти не больше 40 плиток
}

/* --- векторные границы (borders.js): рисуются на холсте размером с экран, только видимая часть ---
   (раньше это был один огромный SVG — при сильном приближении браузер его не тянул) */
const VEC = { segs: null, key: '', cls: null, raf: 0 };
function vecInit() {
  if (typeof BORDERS === 'undefined' || VEC.segs) return;
  VEC.segs = BORDERS.map(b => {
    const n = (b.length - 2) / 2, pts = new Float32Array(n * 2); let x = 0, y = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { x += b[2 + i * 2]; y += b[3 + i * 2]; const X = x / 2, Y = y / 2; pts[i * 2] = X; pts[i * 2 + 1] = Y; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    return { a: b[0], b: b[1], pts, x0, y0, x1, y1 };
  });
}
function vecClassify() {
  const P = MAPINFO.provs, own = k => (G.prov && G.prov[k]) || (P[k][0] >= 0 ? R(ID_BY_IDX[P[k][0]]).owner : null);
  const key = (G.prov || []).join(',');
  if (key === VEC.key && VEC.cls) return; VEC.key = key;
  const c = [], p = [], r = [], s = [], e = [];
  for (const g of VEC.segs) {
    const a = g.a, b = g.b;
    if (a === -1 || b === -1) { c.push(g); continue; }
    if (a < 0 || b < 0) { e.push(g); continue; }
    if (own(a) !== own(b)) s.push(g); else if (P[a][0] !== P[b][0]) r.push(g); else p.push(g);
  }
  VEC.cls = { c, p, r, s, e };
  VEC.cache = null;   // картинку границ пересоберём при следующей отрисовке
}
// готовая картинка всех границ (вполовину разрешения): ею карта рисуется, пока её двигают, и на отдалении
function vecCache() {
  if (VEC.cache || !VEC.cls) return VEC.cache;
  const M = MAPINFO, s = 0.5, cv = document.createElement('canvas');
  cv.width = Math.ceil(M.W * s); cv.height = Math.ceil(M.H * s);
  const ctx = cv.getContext('2d'); ctx.setTransform(s, 0, 0, s, 0, 0); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  const st = (list, color, px) => { ctx.beginPath(); for (const g of list) { const q = g.pts; ctx.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]); } ctx.strokeStyle = color; ctx.lineWidth = px / s; ctx.stroke(); };
  const C = VEC.cls;
  st(C.c, 'rgba(14,22,38,1)', 1.2); st(C.p, 'rgba(255,255,255,.35)', 0.6); st(C.r, 'rgba(40,28,40,.75)', 0.9);
  st(C.e, 'rgba(18,12,18,.95)', 1.4); if (SBORDER[UI.sborder]) st(C.s, SBORDER[UI.sborder], 1.4);
  return VEC.cache = cv;
}
function drawVector() { vecInit(); if (VEC.segs && G) vecClassify(); paintVector(); }
function paintVector() {
  const cv = $('veccv'), wrap = $('mapwrap'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const ctx = cv.getContext('2d'), v = UI.view, z = v.z, M = MAPINFO;
  $('mapover').style.transform = `translate(${v.x}px,${v.y}px) scale(${z})`;   // подписи — в том же кадре, что и карта
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#011f49'; ctx.fillRect(0, 0, cv.width, cv.height);
  // видимая область в координатах карты
  const vx0 = Math.max(0, -v.x / z), vy0 = Math.max(0, -v.y / z), vx1 = Math.min(M.W, (W - v.x) / z), vy1 = Math.min(M.H, (H - v.y) / z);
  if (vx1 <= vx0 || vy1 <= vy0) return;
  const toS = (x, y) => [(v.x + x * z) * dpr, (v.y + y * z) * dpr];
  const [dx0, dy0] = toS(vx0, vy0), [dx1, dy1] = toS(vx1, vy1);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = z < 1 ? 'high' : 'low';   // при увеличении качество фильтра не видно, а время стоит
  // фон: только видимый кусок картинки
  let img = $('mapimg');
  if (img && img.complete && img.naturalWidth && !PIX.noImg) {
    if (z < 0.55) {   // на отдалении — уменьшенная копия фона (в 4 раза меньше работы)
      if (!PIX.bgHalf) { const h2 = document.createElement('canvas'); h2.width = Math.ceil(img.naturalWidth / 2); h2.height = Math.ceil(img.naturalHeight / 2); h2.getContext('2d').drawImage(img, 0, 0, h2.width, h2.height); PIX.bgHalf = h2; }
      img = PIX.bgHalf;
    }
    const k = (img.naturalWidth || img.width) / M.W;
    ctx.drawImage(img, vx0 * k, vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k, dx0, dy0, dx1 - dx0, dy1 - dy0);
    if (z * dpr >= 1.15 && HI.idx) drawHiTiles(ctx, vx0, vy0, vx1, vy1, toS);   // вблизи — плитки вдвое чётче
  } else { ctx.fillStyle = '#808080'; ctx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0); }
  // раскраска держав: вблизи — видимая часть в полном разрешении, на отдалении — общий холст вполовину разрешения
  if (UI.mapMode === 'geo') { /* режим «Местность»: без заливки держав */ }
  else if (PIX.ids && PIX.pCol && z >= 1.1) {
    const X0 = Math.floor(vx0), Y0 = Math.floor(vy0), X1 = Math.min(PIX.w, Math.ceil(vx1)), Y1 = Math.min(PIX.h, Math.ceil(vy1));
    const vw = X1 - X0, vh = Y1 - Y0, key = X0 + ',' + Y0 + ',' + vw + ',' + vh;
    if (!PIX.vt) PIX.vt = document.createElement('canvas');
    if (PIX.vtKey !== key) {
      const vt = PIX.vt; if (vt.width !== vw || vt.height !== vh) { vt.width = vw; vt.height = vh; }
      const vc = vt.getContext('2d'), im = vc.createImageData(vw, vh), d = im.data, ids = PIX.ids, pr = PIX.provReg, pc = PIX.pCol, po = PIX.pOwn, mt = PIX.mtn, W = PIX.w;
      for (let y = 0; y < vh; y++) { const row = (Y0 + y) * W + X0; for (let x = 0; x < vw; x++) { const i = row + x, v = ids[i]; if (!v) { if (PIX.outer && PIX.outer[i]) { const o = (y * vw + x) * 4; d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175; } continue; } if (pr[v] < 0 || po[v] < 0) continue; const m = mt && mt[i] && !PIX.pFree[v], c = pc[v], o = (y * vw + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; const gx = X0 + x, gy = Y0 + y; d[o + 3] = PIX.pFree[v] ? (((gx + gy) % 10 < 1 || (gx - gy + 99999) % 10 < 1) ? 120 : 0) : (m ? (mt[i] === 2 ? 20 : mt[i] === 3 ? 115 : UI.ridgeA) : 190); } }
      vc.putImageData(im, 0, 0); PIX.vtKey = key;
    }
    const [sx0, sy0] = toS(X0, Y0), [sx1, sy1] = toS(X1, Y1);
    ctx.drawImage(PIX.vt, sx0, sy0, sx1 - sx0, sy1 - sy0);
  } else if (PIX.tint) { const t = PIX.tint, k = t.width / M.W; ctx.drawImage(t, vx0 * k, vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k, dx0, dy0, dx1 - dx0, dy1 - dy0); }
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  // границы
  const moving = performance.now() - (UI.lastMove || 0) < 140;
  if (VEC.cls && (z < 0.6 || (moving && z < 1.1)) && vecCache()) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const t = VEC.cache, k = t.width / M.W;
    ctx.drawImage(t, vx0 * k, vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k, dx0, dy0, dx1 - dx0, dy1 - dy0);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y);
    if (moving) clearTimeout(VEC.settle), VEC.settle = setTimeout(scheduleVector, 160);
  } else if (VEC.cls) {
    const far = z * M.W / 4000 < 0.55;
    const stroke = (list, color, px) => {
      ctx.beginPath();
      for (const g of list) {
        if (g.x1 < vx0 || g.x0 > vx1 || g.y1 < vy0 || g.y0 > vy1) continue;
        const q = g.pts; ctx.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
      }
      ctx.strokeStyle = color; ctx.lineWidth = px / z; ctx.stroke();
    };
    const C = VEC.cls;
    stroke(C.c, 'rgba(150,170,190,.28)', 3.2);
    stroke(C.c, 'rgba(14,22,38,1)', 1.9);
    if (!far) stroke(C.p, 'rgba(255,255,255,.42)', 0.8);
    stroke(C.r, 'rgba(40,28,40,.75)', 1.4);
    stroke(C.e, 'rgba(18,12,18,.95)', 2.2);
    if (SBORDER[UI.sborder]) stroke(C.s, SBORDER[UI.sborder], 2.6);
    // перевалы: пунктир поперёк хребта
    if (M.passes && M.passes.length && !far) {
      const pc = PASSCOL[UI.passcol] || PASSCOL.black;
      ctx.lineCap = 'round';
      for (const q of M.passes) {
        if (Math.max(q[2], q[4]) < vx0 - 20 || Math.min(q[2], q[4]) > vx1 + 20 || Math.max(q[3], q[5]) < vy0 - 20 || Math.min(q[3], q[5]) > vy1 + 20) continue;
        const dx = q[4] - q[2], dy = q[5] - q[3], L = Math.hypot(dx, dy) || 1, ext = Math.max(7, (26 - L) / 2), ex = dx / L * ext, ey = dy / L * ext;   // тропа выходит за края хребта (не короче 26 px)
        ctx.beginPath(); ctx.moveTo(q[2] - ex, q[3] - ey); ctx.lineTo(q[4] + ex, q[5] + ey);
        ctx.setLineDash([]); ctx.strokeStyle = pc[1]; ctx.lineWidth = Math.max(5.5 / z, 2.2); ctx.stroke();
        ctx.setLineDash([Math.max(5 / z, 2.2), Math.max(3.5 / z, 1.5)]); ctx.strokeStyle = pc[0]; ctx.lineWidth = Math.max(3 / z, 1.2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineCap = 'butt';
    }
  }
  if (G) paintSelection(ctx, z);
}
// выделение региона и провинции, морские пути, маршруты войск — тоже на камере
const SELP = { key: '', reg: null, prov: null };
function paintSelection(ctx, z) {
  const M = MAPINFO;
  const ri = UI.sel ? ID_BY_IDX.indexOf(R(UI.sel) ? R(UI.sel).id : UI.sel) : -1;
  const key = ri + '|' + UI.selProv;
  if (key !== SELP.key && PIX.bb) {
    SELP.key = key;
    SELP.reg = ri >= 0 ? new Path2D(regionOutline(ri) || 'M0 0') : null;
    SELP.prov = UI.selProv != null && M.provs[UI.selProv] ? new Path2D(provOutline(UI.selProv) || 'M0 0') : null;
  }
  const w = px => px / z;
  if (SELP.reg && ri >= 0) {
    ctx.fillStyle = 'rgba(255,225,140,.10)'; ctx.fill(SELP.reg);
    ctx.setLineDash([w(6), w(4)]); ctx.strokeStyle = 'rgba(255,216,74,.9)'; ctx.lineWidth = w(1.6); ctx.stroke(SELP.reg); ctx.setLineDash([]);
  }
  if (SELP.prov && UI.selProv != null) {
    ctx.fillStyle = 'rgba(255,235,160,.16)'; ctx.fill(SELP.prov);
    ctx.strokeStyle = 'rgba(255,215,90,.35)'; ctx.lineWidth = w(9); ctx.stroke(SELP.prov);
    ctx.strokeStyle = '#ffe37a'; ctx.lineWidth = w(2.2); ctx.stroke(SELP.prov);
  }
  const focusR = UI.selArmy ? (G.armies.find(x => x.id === UI.selArmy) || {}).region : (UI.sel && R(UI.sel) ? R(UI.sel).id : null);
  ctx.setLineDash([w(7), w(6)]); ctx.lineWidth = w(1.6);
  LINKS.forEach(([a, b, t]) => { if (t === 'land' || (a !== focusR && b !== focusR)) return; const pa = M.pos[a], pb = M.pos[b];
    ctx.strokeStyle = t === 'sea' ? 'rgba(200,225,255,.75)' : 'rgba(255,214,130,.9)'; ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); });
  ctx.setLineDash([]);
  const a = UI.selArmy && G.armies.find(x => x.id === UI.selArmy);
  // приказ: щелчок по любой провинции — войско идёт туда по провинциям (через хребты — только по перевалам)
  myArmies().forEach(x => {
    if (!x.path.length && !x.leg) return; const col = x === a ? 'rgba(200,30,30,.95)' : 'rgba(150,60,170,.85)';
    ctx.setLineDash(x === a ? [] : [w(10), w(6)]); ctx.strokeStyle = col; ctx.lineWidth = w(x === a ? 3.5 : 2.5);
    // маршрут по дорогам: остаток текущего перехода, затем переходы по пути
    ctx.beginPath(); let p = armyXY(x); p = [p[0], p[1] + 4]; ctx.moveTo(p[0], p[1]);
    let cur = armyProv(x);
    if (x.leg && typeof x.leg.from === 'number') {
      const rp = roadPts(x.leg.from, x.leg.to), f = legPos(x), cut = Math.floor(f * (rp.length - 1));
      for (let j = cut + 1; j < rp.length; j++) ctx.lineTo(rp[j][0], rp[j][1]);
      p = rp[rp.length - 1]; cur = x.leg.to;
    }
    for (const k of x.path) { if (typeof k !== 'number' || k === cur) continue; for (const q of roadPts(cur, k).slice(1)) ctx.lineTo(q[0], q[1]); p = [MAPINFO.provs[k][1], MAPINFO.provs[k][2]]; cur = k; }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 7); ctx.fillStyle = col; ctx.fill();
  });
}
function scheduleVector() { if (VEC.raf) return; VEC.raf = requestAnimationFrame(() => { VEC.raf = 0; paintVector(); }); }
function drawSelection() { SELP.key = ''; scheduleVector(); }
function scouted(f) { return courtHeroes().some(h => h.role === 'spy' && h.mission && h.mission.type === 'scout' && h.mission.target === f); }
function armyLabel(a) { const n = armyMen(a); if (a.owner === 'byz' || scouted(a.owner)) return fmt(n); return '~' + fmt(Math.round(n / 500) * 500 || 500); }
function renderMarkers() {
  const M = MAPINFO; let h = '';
  for (const d of REGION_DEFS) {
    const id = d[0], r = R(id), p = M.pos[id];
    const besieged = G.armies.some(a => a.region === id && atWar(a.owner, r.owner));
    h += `<div class="rm ${id === 'konst' ? 'cap' : ''} ${UI.sel === id ? 'selr' : ''} ${besieged ? 'siege' : ''}" data-reg="${id}" style="left:${p[0]}px;top:${p[1]}px">
      <span class="dot" style="background:${FACTIONS[r.owner].color}"></span> <span class="nm">${esc(RNAME[id])}</span><br><span class="fx">${'▮'.repeat(Math.min(6, r.fort))}${r.owner === 'byz' ? ' ' + Math.round(r.mood) + '☺' : ''}</span></div>`;
  }
  if (M.provs) M.provs.forEach((p, k) => { if (p[0] < 0 || (p[4].includes(', земля ') && UI.selProv !== k)) return; h += `<div class="pm ${UI.selProv === k ? 'selp' : ''}" style="left:${p[1]}px;top:${p[2]}px">${esc(p[4])}</div>`; });
  $('markers').innerHTML = h + '<div id="armymk"></div>';
  renderArmies();
}

// флажки войск (обновляются каждый игровой день, отдельно от остальных подписей)
function armyXY(a) {
  const P = MAPINFO.provs;
  if (a.leg && typeof a.leg.from === 'number') { const q = roadPoint(a.leg.from, a.leg.to, legPos(a)); return [q[0], q[1] - 4]; }
  const k = armyProv(a), i = Math.max(0, G.armies.filter(x => !x.leg && x.prov === k).indexOf(a));
  return [P[k][1] + i * 6, P[k][2] - 4 - i * 24];
}
function renderArmies() {
  const box = $('armymk'); if (!box || !G) return;
  box.innerHTML = G.armies.map(a => {
    const g = genOf(a), [x, y] = armyXY(a);
    return `<div class="ar ${a.owner === 'byz' ? 'mine' : ''} ${UI.selArmy === a.id ? 'sela' : ''} ${a.leg ? 'moving' : ''}" data-army="${a.id}" title="${esc(a.name)}${g ? ' — ' + esc(g.name) : ''}" style="left:${x}px;top:${y}px;background:${FACTIONS[a.owner].color}">${g ? '⚑' : '⚐'} ${armyLabel(a)}${a.siege ? ' ⚔' + a.siege : ''}${a.path.length ? ' ➜' : ''}</div>`;
  }).join('');
}

// режимы карты: «Политическая» (цвета держав поверх местности) и «Местность» (горы, реки, моря без заливки)
function setMapMode(m) { UI.mapMode = m; const b = $('zmode'); if (b) { b.classList.toggle('on', m === 'geo'); b.title = m === 'geo' ? 'Режим карты: местность (M — политическая)' : 'Режим карты: политическая (M — местность)'; } $('markers').classList.toggle('geo', m === 'geo'); PIX.vtKey = ''; VEC.cache = null; scheduleVector(); }

/* --- облака: отдельный холст поверх карты, медленно плывут по ветру (карта при этом не перерисовывается) --- */
const CL = { on: true, sprites: [], list: [], last: 0 };
try { CL.on = localStorage.getItem('poly_clouds') !== 'off'; } catch (e) { }
function cloudSprite(seed) {
  // пушистое облако: несколько крупных «тел» + много мелких клубов по верхнему краю; низ плоский и чуть серее
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  r(); r(); const kind = Math.floor(r() * 4);                                   // 0 — кучевое, 1 — вытянутое, 2 — башенка, 3 — клочки
  const w = 300, h = 200, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const span = [0.6, 0.82, 0.42, 0.7][kind] * w * (0.8 + r() * 0.35), dome = [0.5, 0.3, 0.85, 0.35][kind] * (0.7 + r() * 0.6), base = h * 0.7;
  // 1–3 «горба» в разных местах и разной высоты — облака не похожи друг на друга
  const hn = 1 + Math.floor(r() * 3), hs = Array.from({ length: hn }, () => [w / 2 + (r() - 0.5) * span * 0.7, 0.45 + r() * 0.75, span * (0.18 + r() * 0.25)]);
  const HUMP = px => 0.35 + hs.reduce((m, [c, a, wd]) => Math.max(m, a * Math.exp(-(((px - c) / wd) ** 2))), 0);
  const puffs = [];
  // тело: клубы вплотную вдоль основания, к середине крупнее и выше (купол)
  const R0 = [26, 20, 28, 18][kind];
  for (let px = w / 2 - span / 2; px <= w / 2 + span / 2; px += R0 * (0.55 + r() * 0.25)) {
    const t = (px - w / 2) / (span / 2), f = Math.max(0, 1 - t * t) * HUMP(px);
    const pr = R0 * (0.55 + 0.75 * f) * (0.85 + r() * 0.3);
    puffs.push([px + (r() - 0.5) * 6, base - pr * 0.55 - f * dome * 40 + (r() - 0.5) * 6, pr]);
  }
  // мелкие клубы по верхнему краю — «пушистость»
  const body = puffs.slice(), small = 30 + Math.floor(r() * 25);
  for (let i = 0; i < small; i++) {
    const p = body[Math.floor(r() * body.length)], a = -Math.PI * (0.12 + r() * 0.76), d = p[2] * (0.7 + r() * 0.25), pr = p[2] * (0.22 + r() * 0.3);
    const yy = p[1] + Math.sin(a) * d; if (yy + pr * 0.3 > base) continue; puffs.push([p[0] + Math.cos(a) * d, yy, pr]);
  }
  if (kind === 3) for (let i = 0; i < 5; i++) { const px = w / 2 + (r() - 0.5) * span * 1.3, pr = 7 + r() * 8; puffs.push([px, base - pr - r() * 14, pr]); }
  x.save(); x.beginPath(); x.rect(0, 0, w, base + 4); x.clip();     // плоское дно
  for (const [px, py, pr] of puffs) { const g = x.createRadialGradient(px, py + pr * 0.4, pr * 0.15, px, py + pr * 0.4, pr * 1.05); g.addColorStop(0, 'rgba(158,166,186,.5)'); g.addColorStop(1, 'rgba(158,166,186,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py + pr * 0.4, pr * 1.05, 0, 7); x.fill(); }
  for (const [px, py, pr] of puffs) { const g = x.createRadialGradient(px - pr * 0.3, py - pr * 0.35, pr * 0.05, px, py, pr); g.addColorStop(0, 'rgba(255,255,255,.98)'); g.addColorStop(0.55, 'rgba(250,251,253,.85)'); g.addColorStop(0.85, 'rgba(240,243,248,.35)'); g.addColorStop(1, 'rgba(236,240,246,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill(); }
  x.restore();
  const g2 = x.createLinearGradient(0, base - 30, 0, base + 4); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(120,130,152,.28)');   // серое дно
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = g2; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over';
  const sh = document.createElement('canvas'); sh.width = w; sh.height = h; const y = sh.getContext('2d');
  for (const [px, py, pr] of puffs) { if (pr < 12) continue; const g = y.createRadialGradient(px, py, pr * 0.2, px, py, pr * 1.15); g.addColorStop(0, 'rgba(20,24,40,.45)'); g.addColorStop(1, 'rgba(20,24,40,0)'); y.fillStyle = g; y.beginPath(); y.arc(px, py, pr * 1.15, 0, 7); y.fill(); }
  return { c, sh };
}
function cloudsInit() {
  if (CL.sprites.length || !MAPINFO) return;
  for (let i = 0; i < 16; i++) CL.sprites.push(cloudSprite(1261 + i * 977));
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) CL.list.push({ x: r() * MAPINFO.W, y: r() * MAPINFO.H, w: 120 + r() * 170, sp: CL.sprites[i % 16], v: 0.6 + r() * 0.7, fl: r() < 0.5 });
}
function cloudFrame(now) {
  requestAnimationFrame(cloudFrame);
  const cv = $('cloudcv'); if (!cv) return;
  const show = CL.on && G && UI.tab === 'map' && !$('app').classList.contains('hidden') && !document.hidden;
  if (!show) { if (cv.width) { cv.width = 0; } CL.last = now; return; }
  if (now - CL.last < 33) return;   // ~30 кадров/с
  const dt = Math.min(0.2, (now - CL.last) / 1000); CL.last = now;
  cloudsInit();
  const wrap = $('mapwrap'), dpr = Math.min(2, window.devicePixelRatio || 1), Wd = wrap.clientWidth, Hd = wrap.clientHeight;
  if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; }
  const x = cv.getContext('2d'), v = UI.view, z = v.z, M = MAPINFO;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
  x.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y);
  const fade = clamp(1.25 - (z * M.W / 5298 - 0.6) * 0.45, 0.35, 1);   // вблизи облака прозрачнее
  const vx0 = -v.x / z, vy0 = -v.y / z, vx1 = vx0 + Wd / z, vy1 = vy0 + Hd / z;
  for (const c of CL.list) {
    c.x += 9 * c.v * dt; c.y += 1.6 * c.v * dt;               // ветер с запада
    if (c.x > M.W + 200) c.x = -c.w - 200; if (c.y > M.H + 150) c.y = -150;
    const h = c.w * 200 / 300;
    if (c.x + c.w + 80 < vx0 || c.x - 80 > vx1 || c.y + h + 120 < vy0 || c.y > vy1) continue;
    const fx = c.fl ? -1 : 1;   // половина облаков зеркальна — больше разнообразия
    x.save(); x.translate(c.x + c.w / 2, c.y); x.scale(fx, 1);
    x.globalAlpha = 0.2 * fade; x.drawImage(c.sp.sh, -c.w / 2 + 40 * fx, 70, c.w, h);
    x.globalAlpha = 0.85 * fade; x.drawImage(c.sp.c, -c.w / 2, 0, c.w, h);
    x.restore();
  }
  x.globalAlpha = 1;
}
if (!HEADLESS) requestAnimationFrame(cloudFrame);

/* --- часы: реальное время с паузой и тремя скоростями --- */
// скорости как в Europa Universalis: день за 2 с, 1 с, 0,5 с, 0,2 с, 0,1 с
const DAYS_PER_SEC = [0, 0.5, 1, 2, 5, 10];
UI.speed = 0; UI.autoPause = true;
try { UI.autoPause = localStorage.getItem('poly_autopause') !== 'off'; } catch (e) { }
function setSpeed(v) { UI.speed = v; if (v) { UI.lastSpeed = v; SFX.play('turn'); } document.querySelectorAll('[data-spd]').forEach(b => b.classList.toggle('on', +b.dataset.spd === v)); }
let clockAcc = 0, clockLast = 0;
function clockFrame(now) {
  requestAnimationFrame(clockFrame);
  const dt = clockLast ? Math.min(0.25, (now - clockLast) / 1000) : 0; clockLast = now;
  if (!G || G.over || !UI.speed || busy || $('app').classList.contains('hidden') || !$('modal').classList.contains('hidden') || !$('battle').classList.contains('hidden')) return;
  clockAcc += dt * DAYS_PER_SEC[UI.speed];
  if (clockAcc >= 1) { clockAcc = Math.min(clockAcc - 1, 3); runDay(); }
}
async function runDay() {
  const before = G.log.length ? G.log[0] : null, season = G.season;
  const mineBefore = new Set(myRegions().filter(r => G.armies.some(a => a.region === r.id && atWar('byz', a.owner))).map(r => r.id));
  const changed = await advanceDay();
  if (!G) return;
  if (G.over) { save(); renderAll(); showFinale(); return; }
  const fresh = G.log.slice(0, Math.max(0, G.log.indexOf(before)));
  const threat = myRegions().filter(r => G.armies.some(a => a.region === r.id && atWar('byz', a.owner)) && !mineBefore.has(r.id));
  if (changed || fresh.length) { save(); renderAll(); } else { $('tdate') && ($('tdate').textContent = dayDate()); renderArmies(); if (G.day % 3 === 0 && myArmies().some(x => x.leg)) scheduleVector(); if (UI.selArmy && G.day % 2 === 0) renderSide(); }   // карта — только ради линий маршрутов, и не каждый день
  if (UI.autoPause && (threat.length || fresh.some(l => l.k === 'imp'))) {
    setSpeed(0); toast(threat.length ? `Враг вошёл в наши земли: ${threat.map(r => RNAME[r.id]).join(', ')}. Пауза.` : 'Важное событие — пауза.');
  }
}
if (!HEADLESS) requestAnimationFrame(clockFrame);

/* --- боковая панель --- */
function renderSide() {
  const S = $('side');
  const a = UI.selArmy && G.armies.find(x => x.id === UI.selArmy);
  if (a) { S.innerHTML = armyPanel(a); bindArmyPanel(a); return; }
  if (!UI.sel && UI.selOuter >= 0 && MAPINFO.outer) { const o = MAPINFO.outer[UI.selOuter]; S.innerHTML = `<h3>${esc(o[0])}</h3><p class="small">${esc(o[3])}</p><p class="small muted">Земли за пределами игровой карты. Войти туда пока нельзя; связи с этими землями появятся позже.</p><p><button class="small" id="outerBack">← К державе</button></p>`; $('outerBack').onclick = () => { UI.selOuter = -1; renderAll(); }; return; }
  if (!UI.sel) { S.innerHTML = introPanel(); bindIntro(); return; }
  const r = R(UI.sel); S.innerHTML = regionPanel(r); bindRegionPanel(r);
}
function introPanel() {
  const threats = myRegions().filter(r => G.armies.some(a => a.region === r.id && atWar('byz', a.owner)));
  const near = myRegions().filter(r => NEIGH[r.id].some(n => G.armies.some(a => a.region === n.to && atWar('byz', a.owner) && a.units.length >= 3)));
  return `<h3>Держава ромеев</h3>
  <p class="small">Нажмите на область, чтобы увидеть её; на флажок войска — чтобы выбрать его и затем нажать область, куда идти.</p>
  ${threats.length ? `<p class="bad">Враг в наших землях: ${threats.map(r => RNAME[r.id]).join(', ')}</p>` : ''}
  ${near.length ? `<p class="warn">Вражеские войска у границ: ${near.map(r => RNAME[r.id]).join(', ')}</p>` : ''}
  <h3>Наши войска</h3>${myArmies().map(a => `<div><button class="small" data-a="${a.id}">⚑ ${esc(a.name)}</button> <span class="small muted">${RNAME[a.region]}, ${fmt(armyMen(a))} чел.</span></div>`).join('') || '<p class="muted">Нет войск.</p>'}
  <h3>Войны</h3><p class="small">${Object.keys(FACTIONS).filter(f => f !== 'byz' && G.factions[f].war && factionAlive(f)).map(f => `<span class="tag" style="border-color:${FACTIONS[f].color}">${esc(fshort(f))}</span>`).join(' ') || 'Мир со всеми.'}</p>
  <h3>Последние вести</h3><div class="log small">${G.log.slice(0, 8).map(l => `<div><span class="d">${l.d}</span>${esc(l.t)}</div>`).join('')}</div>`;
}
function bindIntro() { $('side').querySelectorAll('[data-a]').forEach(b => b.onclick = () => clickArmy(+b.dataset.a)); }
function regionPanel(r) {
  const mine = r.owner === 'byz', gv = governorOf(r.id);
  const armies = G.armies.filter(a => a.region === r.id);
  const myHere = armies.filter(a => a.owner === 'byz');
  const besiegers = armies.filter(a => atWar(a.owner, r.owner));
  const M = MAPINFO, ri = ID_BY_IDX.indexOf(r.id);
  const provs = M.provs ? M.provs.map((p, k) => [k, p]).filter(([k, p]) => p[0] === ri) : [];
  const area = provs.reduce((s2, [k, p]) => s2 + p[3], 0) || 1;
  let ph = '';
  if (UI.selProv != null && M.provs && M.provs[UI.selProv] && M.provs[UI.selProv][0] === ri) {
    const p = M.provs[UI.selProv], sh = p[3] / area;
    const po = G.prov && G.prov[UI.selProv];
    ph = `<div class="card" style="margin:0 0 8px;padding:8px"><div class="small muted">Провинция</div><b>${esc(p[4])}</b> <button class="small" id="rnP" title="Переименовать провинцию">✎</button>
      ${po ? `<div style="margin:3px 0"><span style="color:${FACTIONS[po].color};font-size:18px">■</span> <b>${esc(fname(po))}</b>${po !== r.owner ? ' <span class="small warn">(не хозяин региона)</span>' : ''}</div>` : ''}
      <div class="small">${p[5] ? `Горы: ${Math.round(p[5] * 100)}%<br>` : ''}${Math.round(sh * 100)}% земель региона · население ≈ ${fmt(r.pop * sh)} тыс.${r.owner === 'byz' ? ` · доход ≈ ${(regionIncome(r) * sh).toFixed(1)}` : ''}</div></div>`;
  }
  let h = ph + `<h3>${esc(RNAME[r.id])} <button class="small" id="rnR" title="Переименовать регион">✎</button></h3>
  <div><span class="dot" style="display:inline-block;width:12px;height:12px;background:${FACTIONS[r.owner].color}"></span> ${esc(fname(r.owner))}${FACTIONS[r.owner].house ? ` <span class="muted">· дом: ${esc(FACTIONS[r.owner].house)}</span>` : ''}</div>
  <table class="small">
  <tr><td>Местность</td><td>${TERRAIN_NAMES[r.ter]}</td></tr>
  ${provs.length ? `<tr><td>Провинций</td><td>${provs.length}</td></tr>` : ''}
  ${(() => { const c = {}; provs.forEach(([k]) => { const o = G.prov && G.prov[k]; if (o && o !== r.owner) c[o] = (c[o] || 0) + 1; }); const l = Object.entries(c); return l.length ? `<tr><td>Другие владельцы</td><td>${l.map(([o, n]) => `<span style="color:${FACTIONS[o].color}">■</span> ${esc(fshort(o))} (${n})`).join(', ')}</td></tr>` : ''; })()}
  ${mine ? `<tr><td>Доход за сезон</td><td>${regionIncome(r).toFixed(1)} (база ${r.wealth})</td></tr>` : `<tr><td>Богатство</td><td>${r.wealth}</td></tr>`}
  <tr><td>Население</td><td>${fmt(r.pop)} тыс.</td></tr>
  <tr><td>Гарнизон</td><td>${fmt(r.garrison)} / ${fmt(garCap(r))}</td></tr>
  <tr><td>Укрепления</td><td>${r.fort} ${'▮'.repeat(r.fort)} (осада ≈ ${siegeTurns(r)} сез.)</td></tr>
  <tr><td>Настроение</td><td style="color:${moodCol(r.mood)}">${Math.round(r.mood)} ${r.mood < 25 ? '— грозит бунт!' : ''}</td></tr>
  ${mine ? `<tr><td>Хозяйство</td><td>${r.dev}/5</td></tr><tr><td>Наместник</td><td>${gv ? esc(gv.name) : '<span class="muted">нет</span>'}</td></tr>` : ''}
  ${r.siege ? `<tr><td class="bad">Осада</td><td class="bad">${r.siege} из ${siegeTurns(r)} сез.</td></tr>` : ''}
  ${r.devast > 10 ? `<tr><td>Разорение</td><td class="warn">${Math.round(r.devast)}%</td></tr>` : ''}
  </table>`;
  if (mine) {
    h += `<div class="btnrow">
      <button data-b="fort" ${G.treasury < buildCost(r, 'fort') || r.fort >= (r.id === 'konst' ? 6 : 5) ? 'disabled' : ''}>Укрепить (${buildCost(r, 'fort')})</button>
      <button data-b="econ" ${G.treasury < buildCost(r, 'econ') || r.dev >= 5 ? 'disabled' : ''}>Хозяйство (${buildCost(r, 'econ')})</button>
      <button data-b="gar" ${G.treasury < 12 ? 'disabled' : ''}>Гарнизон +200 (12)</button>
      <button data-b="army" title="Новое войско (10); число войск ограничено числом полководцев + 2">Новое войско</button></div>`;
  }
  myHere.forEach(a => { if (atWar('byz', r.owner) && !a.stormed) h += `<div class="btnrow"><button class="main" data-storm="${a.id}">⚔ Штурм силами «${esc(a.name)}»</button></div>`; });
  if (besiegers.length && mine) h += `<p class="bad small">Город осаждён! Отправьте войско на выручку или ждите: осада длится до ${siegeTurns(r)} сезонов.</p>`;
  h += `<h3>Войска здесь</h3>` + (armies.map(a => `<div><button class="small" data-a="${a.id}" style="border-color:${FACTIONS[a.owner].color}">⚑ ${esc(a.name)}</button> <span class="small muted">${esc(fshort(a.owner))}, ${armyLabel(a)} чел.</span></div>`).join('') || '<p class="muted small">Нет.</p>');
  h += `<h3>Соседи</h3><p class="small">${NEIGH[r.id].map(n => `${esc(RNAME[n.to])}${n.t === 'sea' ? ' (море)' : n.t === 'strait' ? ' (пролив)' : n.t === 'pass' ? ' (перевал: +1 сезон)' : ''}`).join(', ')}</p>`;
  return h;
}
function bindRegionPanel(r) {
  const S = $('side');
  if ($('rnR')) $('rnR').onclick = () => renameAsk('r', r.id);
  if ($('rnP')) $('rnP').onclick = () => renameAsk('p', UI.selProv);
  S.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
    if (b.dataset.b === 'army') { const a = newArmyAt(r.id); if (!a) toast('Нельзя: не хватает денег или полководцев (войск не больше, чем полководцев + 2).'); else { UI.selArmy = a.id; toast('Войско создано. Наймите в него отряды.'); } }
    else if (!manualBuild(r, b.dataset.b)) { toast('Не хватает денег.'); SFX.play('error'); } else SFX.play('coin');
    renderAll();
  });
  S.querySelectorAll('[data-a]').forEach(b => b.onclick = () => clickArmy(+b.dataset.a));
  S.querySelectorAll('[data-storm]').forEach(b => b.onclick = async () => { const a = G.armies.find(x => x.id === +b.dataset.storm); if (!a) return; await playerStorm(a); save(); renderAll(); if (G.over) showFinale(); });
}
function armyPanel(a) {
  const mine = a.owner === 'byz', g = genOf(a);
  let h = `<h3>⚑ ${esc(a.name)}</h3><div class="small">${esc(fname(a.owner))} · ${esc(RNAME[a.region])}</div>`;
  if (!mine) {
    h += `<p>Полководец: ${g ? esc(g.name) : 'нет'}</p><p>Численность: ${armyLabel(a)} чел.</p>`;
    if (scouted(a.owner)) h += `<table class="small">${a.units.map(u => `<tr><td>${UNIT[u.type].icon} ${UNIT[u.type].name}</td><td>${fmt(u.men)}</td></tr>`).join('')}</table>`;
    else h += `<p class="small muted">Пошлите шпиона на разведку к «${esc(fshort(a.owner))}», чтобы знать точный состав.</p>`;
    h += `<p class="small">Сила ≈ ${Math.round(armyPower(a))}. Сила наших войск рядом: ${Math.round(myArmies().filter(x => x.region === a.region || NEIGH[a.region].some(n => n.to === x.region)).reduce((s, x) => s + armyPower(x), 0))}</p>`;
    h += `<div class="btnrow"><button id="bBack">Назад</button></div>`;
    return h;
  }
  const gens = courtHeroes().filter(x => x.role === 'general');
  h += `<p>Полководец: <select id="selGen"><option value="">— нет —</option>${gens.map(x => `<option value="${x.id}" ${a.gen === x.id ? 'selected' : ''}>${esc(x.name)} (ур. ${x.level})${heroArmy(x) && heroArmy(x) !== a ? ' [в другом войске]' : ''}</option>`).join('')}</select></p>`;
  if (!a.gen) h += `<p class="small warn">Без полководца войско слабее на 15%.</p>`;
  if (!UI.selUnits || UI.selUnits.army !== a.id) UI.selUnits = { army: a.id, set: new Set() };
  h += `<table class="small">${a.units.map((u, i) => `<tr draggable="true" data-u="${i}" class="urow"><td><input type="checkbox" data-uc="${i}" ${UI.selUnits.set.has(i) ? 'checked' : ''} title="Выбрать отряд (или перетащите строку на кнопку другого войска)"></td><td>${UNIT[u.type].icon} ${UNIT[u.type].name}</td><td>${fmt(u.men)}/${u.max}</td><td>опыт ${u.xp.toFixed(1)}</td><td><button class="small" data-dis="${i}" title="Распустить отряд">✕</button></td></tr>`).join('')}</table>
  <p class="small">Всего ${fmt(armyMen(a))} чел., сила ≈ ${Math.round(armyPower(a))}, содержание ${upkeepOf(a).toFixed(1)} за сезон.</p>`;
  if (canRecruit(a)) h += `<div class="small">Нанять отряд:</div><div class="btnrow">${UTYPES.map(t => `<button class="small" data-rec="${t}" ${G.treasury < recruitCost(t) ? 'disabled' : ''} title="Атака ${UNIT[t].atk}, защита ${UNIT[t].def}, ход ${UNIT[t].spd}${UNIT[t].rng > 1 ? ', стреляет на ' + UNIT[t].rng : ''}; содержание ${UNIT[t].up} за 100 чел.">${UNIT[t].icon} ${UNIT[t].name} (${recruitCost(t)})</button>`).join('')}</div>`;
  else h += `<p class="small muted">Нанимать можно только в своей области без врагов (не больше 12 отрядов).</p>`;
  const PN = k => typeof k === 'number' && MAPINFO.provs[k] ? MAPINFO.provs[k][4] : '?';
  h += `<div class="small muted">Провинция: ${esc(PN(armyProv(a)))}</div>`;
  if (a.leg) h += `<p class="small">${a.leg.back ? 'Возвращается в' : 'В пути в'} «${esc(PN(a.leg.to))}»: ещё ${a.leg.dur - a.leg.t} дн.</p>`;
  h += `<p class="small">${a.path.length ? `Поход в «${esc(PN(a.path[a.path.length - 1]))}» (${esc(RNAME[provReg(a.path[a.path.length - 1])] || '')}): ${a.path.length} пров., ≈ ${pathDays(a)} дн.` : a.leg ? '' : 'Стоит на месте. Нажмите на провинцию на карте, чтобы отдать приказ идти.'}</p>
  <div class="btnrow">${a.path.length ? `<button id="bStop">${a.leg && !a.leg.back ? 'Повернуть назад' : 'Стоять'}</button>` : ''}
  ${atWar('byz', R(a.region).owner) && !a.stormed ? `<button class="main" id="bStorm">⚔ Штурмовать (${RNAME[a.region]})</button>` : ''}
  ${myArmies().filter(x => armiesTogether(a, x)).map(x => `<button data-merge="${x.id}" title="Всё войско «${esc(x.name)}» — сюда">Влить «${esc(x.name)}»</button><button data-xfer="${x.id}" title="Выбранные отряды (или перетащенный) — в «${esc(x.name)}»">Отряды → «${esc(x.name)}»</button>`).join('')}
  ${!a.leg && a.units.length > 1 ? '<button id="bSplit" title="Выбранные отряды — в новое войско здесь же">Отделить выбранные</button>' : ''}
  <button id="bBack">Готово</button></div>`;
  if (atWar('byz', R(a.region).owner)) h += `<p class="small">Идёт осада: ${a.siege} из ${siegeTurns(R(a.region))} сезонов. Гарнизон ${fmt(R(a.region).garrison)}, укрепления ${R(a.region).fort}.</p>`;
  return h;
}
function bindArmyPanel(a) {
  const S = $('side');
  if ($('bBack')) $('bBack').onclick = () => { UI.selArmy = null; renderAll(); };
  if ($('selGen')) $('selGen').onchange = e => { const v = +e.target.value; if (!v) { const g = genOf(a); if (g && g.id) unassignGeneral(g); a.gen = null; } else assignGeneral(G.heroes.find(h => h.id === v), a); renderAll(); };
  S.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => { if (!recruit(a, b.dataset.rec)) { toast('Нельзя нанять (деньги, люди или лимит отрядов).'); SFX.play('error'); } else SFX.play('coin'); renderAll(); });
  S.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => { const u = a.units[+b.dataset.dis]; if (u.type !== 'merc' && R(a.region).owner === 'byz') R(a.region).pop += u.men / 2000; a.units.splice(+b.dataset.dis, 1); if (!a.units.length) { removeArmyQuiet(a); UI.selArmy = null; } renderAll(); });
  S.querySelectorAll('[data-merge]').forEach(b => b.onclick = () => { const o = G.armies.find(x => x.id === +b.dataset.merge); const room = 12 - a.units.length; a.units.push(...o.units.splice(0, room)); if (!o.units.length) removeArmyQuiet(o); renderAll(); });
  if ($('bStop')) $('bStop').onclick = () => { a.path = []; renderAll(); };
  const selIdx = () => [...UI.selUnits.set].filter(i => i < a.units.length);
  S.querySelectorAll('[data-uc]').forEach(cb => cb.onchange = () => { const i = +cb.dataset.uc; if (cb.checked) UI.selUnits.set.add(i); else UI.selUnits.set.delete(i); });
  const xfer = (o, idx) => { if (!idx.length) { toast('Отметьте отряды галочками или перетащите строку на кнопку.'); return; } const n = transferUnits(a, o, idx); UI.selUnits = null; toast(n ? `Передано отрядов: ${n} → «${o.name}».` : 'В том войске нет места (не больше 12 отрядов).'); if (!G.armies.includes(a)) UI.selArmy = o.id; renderAll(); };
  S.querySelectorAll('[data-xfer]').forEach(b => {
    const o = G.armies.find(x => x.id === +b.dataset.xfer);
    b.onclick = () => xfer(o, selIdx());
    b.ondragover = e => { e.preventDefault(); b.classList.add('drop'); }; b.ondragleave = () => b.classList.remove('drop');
    b.ondrop = e => { e.preventDefault(); const i = +e.dataTransfer.getData('text/unit'); xfer(o, UI.selUnits.set.has(i) ? selIdx() : [i]); };
  });
  S.querySelectorAll('tr[data-u]').forEach(tr => tr.ondragstart = e => { e.dataTransfer.setData('text/unit', tr.dataset.u); e.dataTransfer.effectAllowed = 'move'; });
  if ($('bSplit')) $('bSplit').onclick = () => { const n = splitArmy(a, selIdx()); if (!n) { toast(selIdx().length ? 'Нельзя: войск не больше, чем полководцев при дворе плюс два.' : 'Отметьте отряды, которые отделить.'); return; } UI.selUnits = null; toast(`Новое войско: «${n.name}».`); renderAll(); };
  if ($('bStorm')) $('bStorm').onclick = async () => { await playerStorm(a); save(); renderAll(); if (G.over) showFinale(); };
}
function removeArmyQuiet(a) { const g = genOf(a); if (g && g.id) unassignGeneral(g); G.armies = G.armies.filter(x => x !== a); }

/* --- двор --- */
function heroCard(h) {
  const R0 = ROLES[h.role];
  const opts = MISSIONS[h.role];
  const cur = h.mission ? h.mission.type : '';
  return `<div class="card hero">
   <div class="hd"><div class="av" title="${R0.name}">${R0.icon}</div><div><b>${esc(h.name)}</b><div class="lv">${R0.name}, ур. ${h.level} · ${h.age} лет</div></div></div>
   <div class="small muted">${esc(h.desc)}</div>
   <div class="small">${R0.skills[0]} ${'★'.repeat(h.sk[0])}${'☆'.repeat(5 - h.sk[0])} · ${R0.skills[1]} ${'★'.repeat(h.sk[1])}${'☆'.repeat(5 - h.sk[1])}</div>
   <div>${h.traits.map(t => `<span class="tag" title="${esc(TRAITS[t])}">${t}</span>`).join('')}</div>
   <div class="small">Опыт ${Math.round(h.xp)}/${h.level * 60}</div>${bar(h.xp, h.level * 60)}
   <div class="small">Верность <span style="color:${moodCol(h.loyalty)}">${Math.round(h.loyalty)}</span></div>${bar(h.loyalty, 100, moodCol(h.loyalty))}
   <div class="small" style="margin-top:4px">Сейчас: <b>${esc(missionText(h))}</b></div>
   <div class="btnrow"><select data-mt="${h.id}">${opts.map(o => `<option value="${o[0]}" ${o[0] === cur ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
   <select data-mg="${h.id}"></select></div>
   <div class="btnrow"><button class="small main" data-ms="${h.id}">Поручить</button><button class="small" data-dm="${h.id}">Отпустить</button></div></div>`;
}
function missionTargets(h, type) {
  const kind = (MISSIONS[h.role].find(o => o[0] === type) || [])[2];
  if (kind === 'army') return myArmies().map(a => [a.id, a.name + ' (' + RNAME[a.region] + ')']);
  if (kind === 'region') return myRegions().map(r => [r.id, RNAME[r.id]]);
  if (kind === 'enemyRegion') return Object.values(G.regions).filter(r => r.owner !== 'byz' && NEIGH[r.id].some(n => R(n.to).owner === 'byz')).map(r => [r.id, RNAME[r.id] + ' (' + fshort(r.owner) + ')']);
  if (kind === 'faction') return Object.keys(FACTIONS).filter(f => f !== 'byz' && factionAlive(f)).map(f => [f, fshort(f) + (G.factions[f].war ? ' (война)' : '')]);
  if (kind === 'trade') return [['genoa', 'Генуя'], ['venice', 'Венеция'], ['trebizond', 'Трапезунд']];
  return [];
}
function renderCourt() {
  const V = $('view-court');
  const court = courtHeroes();
  const slots = []; for (let s = 0; s < COUNCIL; s++) slots.push(court.find(h => h.slot === s));
  const captives = G.heroes.filter(h => h.status === 'captive');
  V.innerHTML = `<h2>Совет императора (${court.length}/${COUNCIL})</h2>
  <p class="small muted">Назначайте героям поручения. Полководцы водят войска, купцы приносят доход от торговли, наместники управляют областями, священники держат веру, шпионы разведывают и подкупают, дипломаты заключают мир, союзы и браки. Герои растут в уровне, но могут погибнуть, попасть в плен или предать.</p>
  <div class="grid">${slots.map(h => h ? heroCard(h) : `<div class="card muted">Свободное место в совете</div>`).join('')}</div>
  <h2>Ищут места при дворе</h2>
  <div class="grid">${G.candidates.map((h, i) => `<div class="card hero"><div class="hd"><div class="av">${ROLES[h.role].icon}</div><div><b>${esc(h.name)}</b><div class="lv">${ROLES[h.role].name}, ур. ${h.level}${h.hist ? ' · историческое лицо' : ''}</div></div></div>
     <div class="small muted">${esc(h.desc)}</div><div>${h.traits.map(t => `<span class="tag" title="${esc(TRAITS[t])}">${t}</span>`).join('')}</div>
     <div class="btnrow"><button class="main" data-hire="${i}" ${court.length >= COUNCIL || G.treasury < hireCost(h) ? 'disabled' : ''}>Принять (${hireCost(h)})</button></div></div>`).join('')}</div>
  <p class="small muted">Новые кандидаты появляются раз в год. Жалованье: 2 + 0,8×уровень за сезон каждому.</p>
  ${captives.length ? `<h2>В плену</h2>${captives.map(h => `<div class="card">${esc(h.name)} (${ROLES[h.role].name}) — в плену у «${esc(fshort(h.captor))}». <button data-ransom="${h.id}" ${G.treasury < h.ransom ? 'disabled' : ''}>Выкупить (${h.ransom})</button></div>`).join('')}` : ''}
  ${G.heroes.some(h => h.status === 'dead' || h.status === 'traitor') ? `<h2>Ушедшие</h2><p class="small">${G.heroes.filter(h => h.status === 'dead' || h.status === 'traitor').map(h => esc(h.name) + (h.status === 'traitor' ? ' (изменник)' : ' †')).join(', ')}</p>` : ''}`;
  V.querySelectorAll('[data-mt]').forEach(s => {
    const h = G.heroes.find(x => x.id === +s.dataset.mt);
    const tg = V.querySelector(`[data-mg="${h.id}"]`);
    const fill = () => { const list = missionTargets(h, s.value); tg.innerHTML = list.map(([v, n]) => `<option value="${v}" ${h.mission && String(h.mission.target) === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join(''); tg.style.display = list.length ? '' : 'none'; };
    s.onchange = fill; fill();
  });
  V.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => {
    const h = G.heroes.find(x => x.id === +b.dataset.ms);
    const type = V.querySelector(`[data-mt="${h.id}"]`).value, tgs = V.querySelector(`[data-mg="${h.id}"]`);
    const target = tgs.style.display === 'none' ? null : tgs.value;
    const kind = (MISSIONS[h.role].find(o => o[0] === type) || [])[2];
    if (kind && !target) { toast('Нет подходящей цели.'); return; }
    if (type === 'army') { const a = G.armies.find(x => x.id === +target); assignGeneral(h, a); }
    else if (!setMission(h, type, target)) { toast('Нельзя: не хватает денег, цель занята или условие не выполнено.'); return; }
    toast(`${h.name}: ${missionText(h)}`); renderAll();
  });
  V.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { const h = G.heroes.find(x => x.id === +b.dataset.dm); if (confirm(`Отпустить ${h.name}?`)) { dismiss(h); renderAll(); } });
  V.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => { if (!hire(+b.dataset.hire)) { toast('Нельзя нанять.'); SFX.play('error'); } else SFX.play('coin'); renderAll(); });
  V.querySelectorAll('[data-ransom]').forEach(b => b.onclick = () => { const h = G.heroes.find(x => x.id === +b.dataset.ransom); if (G.treasury < h.ransom) return; G.treasury -= h.ransom; if (courtHeroes().length < COUNCIL) { h.status = 'court'; const taken = new Set(courtHeroes().filter(x => x !== h).map(x => x.slot)); for (let s = 0; s < COUNCIL; s++) if (!taken.has(s)) { h.slot = s; break; } log(`${h.name} выкуплен из плена.`); } else { h.status = 'gone'; log(`${h.name} выкуплен, но места в совете нет — он удалился в имение.`); } renderAll(); });
}

/* --- государство --- */
function renderState() {
  const V = $('view-state'), I = computeIncome(), r = ruler();
  const row = (n, v) => `<tr><td>${n}</td><td class="${v >= 0 ? 'good' : 'bad'}">${sign(v)}</td></tr>`;
  const relTxt = f => { const F = G.factions[f]; return F.war ? '<span class="bad">война</span>' : F.ally ? '<span class="good">союз</span>' : F.truce ? `перемирие (${F.truce})` : 'мир'; };
  V.innerHTML = `<h2>Государство</h2><p class="small muted">Здесь — то, что василевс решает сам. У решений долгие последствия: они действуют каждый сезон.</p>
  <div class="grid">
  <div class="card"><h3>Казна и налоги</h3>
    <table class="t small">${row('Области', I.regions)}${row('Таможня Города', I.customs)}${row('Торговля (купцы)', I.trade)}${row('Законы', I.laws)}${row('Войска', I.army)}${row('Флот', I.fleet)}${row('Жалованье двора', I.heroes)}${row('Стройки', I.build)}<tr><td><b>Итого за сезон</b></td><td class="${I.total >= 0 ? 'good' : 'bad'}"><b>${sign(I.total)}</b></td></tr></table>
    <p class="small">Налоги:</p><div class="btnrow">${Object.entries(TAX).map(([k, t]) => `<button class="small ${G.tax === k ? 'sel' : ''}" data-tax="${k}" title="Доход ×${t.m}, настроение ${sign(t.mood)}">${t.name}</button>`).join('')}</div>
    <p class="small muted">Высокие налоги быстро дают деньги, но области начинают бунтовать.</p></div>
  <div class="card"><h3>Монета</h3>
    <p>Иперпир: <b>${G.coin}</b> каратов золота из 24.</p>${bar(G.coin, 24)}
    <p class="small">Порча монеты сразу приносит деньги, но бьёт по торговле и таможне (их доход ×${(G.coin / 15).toFixed(2)}), а ниже 12 каратов жители недовольны ростом цен.</p>
    <div class="btnrow"><button data-coin="down" ${G.coin <= 6 ? 'disabled' : ''}>Испортить (+55, −1 карат)</button><button data-coin="up" ${G.coin >= 18 || G.treasury < 90 ? 'disabled' : ''}>Восстановить (−90)</button></div></div>
  <div class="card"><h3>Законы и указы</h3>${Object.entries(LAWS).map(([k, l]) => `<div style="margin-bottom:6px"><button class="small ${G.laws[k] ? 'sel' : ''}" data-law="${k}">${G.laws[k] ? '✔' : '✗'} ${l.name}</button><div class="small muted">${l.desc} <i>${l.on}</i></div></div>`).join('')}
    <p class="small muted">Изменить закон можно раз в год.${G.flags.lawCd > G.turn ? ` Следующее изменение через ${G.flags.lawCd - G.turn} сез.` : ''}</p></div>
  <div class="card"><h3>Уния с Римом</h3>
    <p>Положение: <b>${{ none: 'нет переговоров', talks: 'идут переговоры', accepted: 'уния принята', rejected: 'уния отвергнута', repudiated: 'уния расторгнута' }[G.union]}</b></p>
    <p class="small">Угроза Карла Анжуйского: ${Math.round(G.anjou)}${G.flags.vespers ? ' (миновала после Сицилийской вечерни)' : ''}</p>${bar(G.anjou, 100, 'var(--bad)')}
    <p class="small muted">Переговоры сдерживают Карла и Запад, но раскалывают Церковь. Принятая уния злит греков во всех областях.</p>
    <div class="btnrow">${G.union !== 'talks' && G.union !== 'accepted' ? '<button data-un="talks">Начать переговоры</button>' : ''}${G.union === 'talks' ? `<button data-un="accept" ${G.unionProg < 8 ? 'disabled title="Нужен прогресс переговоров (священник на поручении «Переговоры об унии»)"' : ''}>Принять унию (${Math.round(G.unionProg)}/8)</button><button data-un="stop">Прервать</button>` : ''}${G.union === 'accepted' ? '<button data-un="repud">Расторгнуть унию</button>' : ''}</div></div>
  <div class="card"><h3>Флот</h3>
    <p>${['Флота нет. Морские пути закрыты, пираты хозяйничают у берегов.', 'Малый флот (расход 18 за сезон).', 'Полный флот (расход 34 за сезон).'][G.fleet]}${G.fleetRebuild ? ` Строится новый флот: ещё ${G.fleetRebuild} сез.` : ''}</p>
    <p class="small muted">Флот нужен, чтобы перебрасывать войска по морю (пунктир на карте), защищать острова и побережье от пиратов. Андроник II распустил флот около 1285 года — и потом горько об этом пожалел.</p>
    <div class="btnrow">${G.fleet > 0 ? `<button data-fl="2" ${G.fleet === 2 ? 'disabled' : ''}>Полный</button><button data-fl="1" ${G.fleet === 1 ? 'disabled' : ''}>Малый</button><button data-fl="0">Распустить (+40)</button>` : `<button data-fl="build" ${G.treasury < 150 || G.fleetRebuild ? 'disabled' : ''}>Построить заново (−150, 4 сезона)</button>`}</div></div>
  <div class="card"><h3>Строительство</h3>
    <p class="small">Каждый сезон часть дохода откладывается на стройки и тратится по приоритету.</p>
    <p>Приоритет: <select id="bPrio">${Object.entries(BUILD_PRIO).map(([k, n]) => `<option value="${k}" ${G.build.prio === k ? 'selected' : ''}>${n}</option>`).join('')}</select></p>
    <p>Доля дохода: <select id="bShare">${[0, 5, 10, 20, 30].map(v => `<option ${G.build.share === v ? 'selected' : ''}>${v}</option>`).join('')}</select>% · накоплено ${Math.round(G.build.fund)}</p></div>
  <div class="card"><h3>Трон и наследник</h3>
    <p><b>${esc(r.name)}</b><br><span class="small muted">${esc(r.desc)}</span></p>
    <p class="small">Война ${r.mar} · Хозяйство ${r.stw} · Дипломатия ${r.dip} · Благочестие ${r.pie}</p>
    ${r.minor ? `<p class="small">Регентство: <b>${{ kant: 'Иоанн Кантакузин', anna: 'Анна Савойская и Алексей Апокавк', council: 'совет регентов' }[G.regent] || 'не определено'}</b></p>` : `
    <p class="small">Наследник: ${G.heir.co ? 'коронован соправителем' : 'не коронован'}. Воспитание: <b>${{ none: 'обычное', war: 'военное', books: 'книжное', church: 'церковное' }[G.heir.educ]}</b></p>
    <div class="btnrow"><button data-heir="co" ${G.heir.co || G.treasury < 40 ? 'disabled' : ''}>Короновать соправителем (−40)</button></div>
    <div class="btnrow">${['war', 'books', 'church'].map(k => `<button class="small ${G.heir.educ === k ? 'sel' : ''}" data-educ="${k}">${{ war: 'Военное', books: 'Книжное', church: 'Церковное' }[k]} воспитание</button>`).join('')}</div>
    <p class="small muted">Соправитель укрепляет порядок при смене императора. Воспитание даёт следующему правителю +1 к войне, хозяйству или благочестию.</p>`}</div>
  <div class="card" style="grid-column:1/-1"><h3>Державы</h3><table class="t small"><tr><th>Держава</th><th>Отношение</th><th>Положение</th><th></th></tr>
    ${Object.keys(FACTIONS).filter(f => f !== 'byz' && factionAlive(f)).map(f => `<tr><td><span style="color:${FACTIONS[f].color}">■</span> ${esc(fname(f))}${G.factions[f].married ? ' 💍' : ''}</td><td>${Math.round(G.factions[f].rel)}</td><td>${relTxt(f)}</td><td>${!G.factions[f].war && f !== 'rebel' ? `<button class="small" data-war="${f}">Объявить войну</button>` : ''}</td></tr>`).join('')}</table>
    <p class="small muted">Мир, союзы и браки заключают дипломаты (вкладка «Двор»). Война нарушает перемирие — это бьёт по престижу.</p></div>
  </div>`;
  V.querySelectorAll('[data-tax]').forEach(b => b.onclick = () => { G.tax = b.dataset.tax; renderAll(); });
  V.querySelectorAll('[data-coin]').forEach(b => b.onclick = () => {
    if (b.dataset.coin === 'down') { G.coin--; G.treasury += 55; G.order -= 3; G.prestige -= 2; G.factions.venice.rel -= 5; G.factions.genoa.rel -= 5; log(`Иперпир испорчен: теперь ${G.coin} каратов.`); }
    else { G.coin++; G.treasury -= 90; G.order += 2; G.prestige += 3; log(`Монета улучшена: ${G.coin} каратов.`); }
    normalize(); renderAll();
  });
  V.querySelectorAll('[data-law]').forEach(b => b.onclick = () => { if (!toggleLaw(b.dataset.law)) toast('Законы можно менять раз в год.'); renderAll(); });
  V.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { unionAction(b.dataset.un); renderAll(); });
  V.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { fleetAction(b.dataset.fl); renderAll(); });
  $('bPrio').onchange = e => { G.build.prio = e.target.value; };
  $('bShare').onchange = e => { G.build.share = +e.target.value; renderAll(); };
  V.querySelectorAll('[data-heir]').forEach(b => b.onclick = () => { G.treasury -= 40; G.heir.co = true; G.order += 4; log('Наследник коронован соправителем.'); renderAll(); });
  V.querySelectorAll('[data-educ]').forEach(b => b.onclick = () => { G.heir.educ = b.dataset.educ; renderAll(); });
  V.querySelectorAll('[data-war]').forEach(b => b.onclick = () => { if (confirm(`Объявить войну: ${fname(b.dataset.war)}?`)) { declareWar(b.dataset.war); renderAll(); } });
}
function renderLog() {
  $('view-log').innerHTML = `<h2>Летопись</h2><div class="log">${G.log.map(l => `<div><span class="d">${l.d}</span>${l.k === 'imp' ? '<b>' + esc(l.t) + '</b>' : esc(l.t)}</div>`).join('')}</div>`;
}

/* --- окна --- */
function modal(html) { $('mbox').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
eventHook = (ev, opts) => new Promise(res => {
  renderAll(); SFX.play('event');
  modal(`<div class="small muted">${dateStr()}</div><h2>${esc(ev.title)}</h2><p>${esc(evText(ev.text))}</p>${ev.note ? `<div class="note">${esc(ev.note)}</div>` : ''}
   ${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.t)}<span class="h">${esc(evText(o.h) || '')}</span></button>`).join('')}`);
  $('mbox').querySelectorAll('.opt').forEach(b => b.onclick = () => { closeModal(); res(opts[+b.dataset.k]); });
});
function showMenu() {
  modal(`<h2>Меню</h2><div class="small muted" style="margin:-6px 0 8px">${typeof GAME_VERSION !== 'undefined' ? esc(versionText(GAME_VERSION)) : ''}</div><div class="btnrow" style="flex-direction:column">
   <button id="mStyle">Стиль карты: ${STYLENAMES[MAPSTYLE] || MAPSTYLE} (сменить — страница перезагрузится, игра сохранится)</button>
   <button id="mSave">Сохранить</button><button id="mLoad">Загрузить сохранение</button>
   <button id="mAuto">${G.autoBattle ? 'Бои: автоматически (включить ручные)' : 'Бои: вручную (включить автоматические)'}</button>
   <button id="mRidge">${UI.ridgeA === 85 ? 'Горы на политической карте: видны сквозь цвет державы (скрыть)' : 'Горы на политической карте: скрыты под цветом державы (показать)'}</button>
   <button id="mAP">${UI.autoPause ? 'Пауза при важных событиях: включена' : 'Пауза при важных событиях: выключена'}</button>
   <button id="mCl">${CL.on ? 'Облака: включены (выключить)' : 'Облака: выключены (включить)'}</button>
   <button id="mSB">Граница держав: ${{ black: 'чёрная', red: 'красная', none: 'нет' }[UI.sborder]} (сменить)</button>
   <button id="mPC">Перевалы: ${{ black: 'чёрные', red: 'красные', brown: 'коричневые' }[UI.passcol]} (сменить)</button>
   <button id="mNames">Скачать мои названия (файл)</button>
   <button id="mSnd">${SFX.on ? 'Звуки: включены (выключить)' : 'Звуки: выключены (включить)'}</button>
   <button id="mHelp">Как играть</button><button id="mNew">Новая игра</button><button id="mClose" class="main">Закрыть</button></div>`);
  $('mSave').onclick = () => { save(); toast('Сохранено.'); closeModal(); };
  $('mLoad').onclick = () => { if (load()) { closeModal(); renderAll(); toast('Загружено.'); } else toast('Сохранения нет.'); };
  $('mAuto').onclick = () => { G.autoBattle = !G.autoBattle; closeModal(); renderAll(); };
  $('mSnd').onclick = () => { SFX.toggle(); showMenu(); };
  $('mSB').onclick = () => { UI.sborder = { black: 'red', red: 'none', none: 'black' }[UI.sborder]; try { localStorage.setItem('poly_sborder', UI.sborder); } catch (e) { } VEC.cache = null; scheduleVector(); showMenu(); };
  $('mNames').onclick = exportNames;
  $('mCl').onclick = () => { CL.on = !CL.on; try { localStorage.setItem('poly_clouds', CL.on ? 'on' : 'off'); } catch (e) { } showMenu(); };
  $('mStyle').onclick = () => { save(); try { localStorage.setItem('poly_style', { wc: 'wc2', wc2: 'sat', sat: 'wc' }[MAPSTYLE] || 'wc'); } catch (e) { } location.reload(); };
  $('mAP').onclick = () => { UI.autoPause = !UI.autoPause; try { localStorage.setItem('poly_autopause', UI.autoPause ? 'on' : 'off'); } catch (e) { } showMenu(); };
  $('mPC').onclick = () => { UI.passcol = { black: 'red', red: 'brown', brown: 'black' }[UI.passcol]; try { localStorage.setItem('poly_passcol', UI.passcol); } catch (e) { } scheduleVector(); showMenu(); };
  $('mRidge').onclick = () => { UI.ridgeA = UI.ridgeA === 85 ? 190 : 85; try { localStorage.setItem('poly_ridge', UI.ridgeA === 85 ? 'owner' : 'own'); } catch (e) { } drawOverlay(); PIX.vtKey = ''; scheduleVector(); showMenu(); };
  $('mHelp').onclick = showHelp;
  $('mNew').onclick = () => { if (confirm('Начать новую игру? Текущая партия будет потеряна.')) { closeModal(); startNew(); } };
  $('mClose').onclick = closeModal;
}
function showHelp() {
  modal(`<h2>Как играть</h2>
  <p><b>Цель.</b> Пройти от лета 1261 до 1354 года. Летом 1347 года придёт Чёрная смерть — встретьте её сильной державой и переживите. Удар чумы мягче, если в казне есть деньги, в стране порядок, а крепости крепки. Потеря Константинополя — конец игры.</p>
  <p><b>Время</b> идёт само, по дням. Кнопки вверху: ❚❚ пауза, 1–5 — скорость: от дня за 2 секунды до 10 дней в секунду (клавиши: пробел, 1–5, + и −). Приказы можно отдавать и на паузе. Налоги, стройки, двор и события считаются раз в сезон (3 месяца). При важных событиях и вторжении врага игра сама встаёт на паузу (это можно выключить в меню).</p>
  <p><b>Карта.</b> Тяните мышью, колесо — масштаб. Нажмите на флажок своего войска (с золотой рамкой), затем — на любую провинцию: войско пойдёт туда самым быстрым путём; Ctrl/Shift + щелчок добавляет точку маршрута (свой путь), правый щелчок отменяет приказ; войско проходит около 20 км в день, по морю — около 45, перевал добавляет ещё 15 дней. Пунктир — морские пути (нужен флот), коричневый пунктир — проливы. Коричневые хребты закрывают путь; пройти через них можно только по перевалу (светлая тропа), переход занимает сезон.</p>
  <p><b>Осады.</b> Войско во вражеской области осаждает её: через несколько сезонов (зависит от укреплений) гарнизон сдаётся. Можно штурмовать сразу — откроется экран боя.</p>
  <p><b>Бой.</b> Выберите свой отряд, нажмите светлую клетку, чтобы пойти, или врага с красной рамкой, чтобы атаковать. Лучники стреляют на 3 клетки. Конница с разгона (2+ клетки) бьёт в полтора раза сильнее, но вязнет в лесу и против пехоты в обороне. Холмы и леса защищают. Отряд с низким духом бежит. Можно «Рассчитать автоматически».</p>
  <p><b>Двор</b> — до 7 героев с поручениями. <b>Государство</b> — налоги, монета, законы, уния, флот, стройки, наследник, войны.</p>
  <p class="small muted">Клавиши: пробел — пауза, 1–5 — скорость, / — поиск, Esc — снять выбор.</p>
  <button class="main" onclick="closeModal()">Понятно</button>`);
}
function toggleLaw(k) {
  if ((G.flags.lawCd || 0) > G.turn) return false;
  G.laws[k] = !G.laws[k]; G.flags.lawCd = G.turn + 4;
  const on = G.laws[k];
  if (k === 'pronoia' && on) G.order += 5;
  if (k === 'monktax' && on) G.church -= 5;
  if (k === 'judges' && on) G.treasury -= 20;
  if (k === 'grain') { G.factions.venice.rel += on ? -10 : 5; G.factions.genoa.rel += on ? -10 : 5; }
  if (k === 'genoapriv' && !on) { G.factions.genoa.rel -= 30; if (G.factions.genoa.rel < -40) declareWar('genoa'); }
  if (k === 'genoapriv' && on) G.factions.genoa.rel += 15;
  if (k === 'akritai' && !on) ANATOLIA.forEach(id => { if (own(id)) R(id).mood -= 10; });
  log(`Указ: «${LAWS[k].name}» ${on ? 'введён' : 'отменён'}.`);
  normalize(); return true;
}
function unionAction(k) {
  if (k === 'talks') { G.union = 'talks'; G.church -= 5; G.anjou -= 5; log('Начаты переговоры с папой об унии.'); }
  if (k === 'accept') { G.union = 'accepted'; G.church -= 25; G.order -= 8; G.anjou -= 40; G.prestige += 5; log('Уния с Римом принята.', 'imp'); }
  if (k === 'stop') { G.union = 'rejected'; G.church += 5; G.anjou += 10; log('Переговоры об унии прерваны.'); }
  if (k === 'repud') { G.union = 'repudiated'; G.church += 15; G.anjou += 20; log('Уния расторгнута.', 'imp'); }
  normalize();
}
function fleetAction(k) {
  if (k === 'build') { G.treasury -= 150; G.fleetRebuild = 4; log('На верфях заложены новые корабли.'); return; }
  const v = +k; if (v === 0) { G.treasury += 40; G.prestige -= 4; log('Флот распущен.', 'imp'); }
  G.fleet = v;
}
function showFinale() {
  const F = G.final || (G.final = finale());
  SFX.play('bell');
  modal(`<h2>${G.over === 'konst' ? 'Город пал' : 'После Чёрной смерти, 1354'}</h2>
   <p style="font-size:22px;color:var(--gold2)">«${esc(F.title)}» — ${F.score} из 100</p>
   ${F.ep.map(p => `<p>${esc(p)}</p>`).join('')}
   <table class="t small"><tr><td>Областей к концу</td><td>${F.regs} (больше всего: ${G.stats.peakRegions})</td></tr><tr><td>Побед / поражений</td><td>${G.stats.won} / ${G.stats.lost}</td></tr><tr><td>Казна</td><td>${fmt(G.treasury)}</td></tr><tr><td>Порядок / Церковь / Престиж</td><td>${Math.round(G.order)} / ${Math.round(G.church)} / ${Math.round(G.prestige)}</td></tr><tr><td>Смертность от чумы</td><td>${Math.round(F.mort * 100)}%</td></tr></table>
   <div class="btnrow"><button class="main" id="fNew">Новая игра</button><button id="fLook">Посмотреть на карту</button></div>`);
  $('fNew').onclick = () => { closeModal(); startNew(); };
  $('fLook').onclick = closeModal;
}

/* --- экран боя --- */
const BV = { b: null, pk: 'A', sel: null, cs: 40, busy: false, resolve: null, fx: null };
battleHook = input => new Promise(res => {
  if (G.autoBattle) { const r = Battle.autoResolve(input); toast(`Битва: ${input.place}. ${r.winner === (input.attacker.player ? 'attacker' : 'defender') ? 'Победа!' : 'Поражение.'}`); res(r); return; }
  BV.endSfx = false; BV.b = Battle.Sim.create(input); BV.pk = input.attacker.player ? 'A' : 'D'; BV.sel = null; BV.resolve = res; BV.fx = null;
  $('battle').classList.remove('hidden');
  const cv = $('bcv');
  const avail = Math.min(window.innerWidth - (window.innerWidth > 760 ? 330 : 20), 18 * 48);
  BV.cs = clamp(Math.floor(avail / 18), 22, 48);
  cv.width = 18 * BV.cs; cv.height = 12 * BV.cs;
  cv.onclick = bvClick;
  bvRender();
  if (BV.b.active !== BV.pk) bvAiTurn();
});
const TCOL = { g: '#7f9a55', h: '#a8955f', f: '#3f6a35', w: '#3f6f9f', d: '#79a2bb', r: '#6e6a66', s: '#335f8c', W: '#7d7064', G: '#5a3c22', t: '#b8a988' };
function bvRender() {
  const b = BV.b, cv = $('bcv'), ctx = cv.getContext('2d'), cs = BV.cs, S = Battle.Sim;
  for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
    const c = b.grid[y][x]; ctx.fillStyle = TCOL[c]; ctx.fillRect(x * cs, y * cs, cs, cs);
    if (c === 'h') { ctx.strokeStyle = 'rgba(80,60,30,.6)'; ctx.beginPath(); ctx.arc(x * cs + cs / 2, y * cs + cs * 0.75, cs * 0.35, Math.PI, 0); ctx.stroke(); }
    if (c === 'f') { ctx.fillStyle = '#2c5228'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x * cs + cs * (0.25 + k * 0.25), y * cs + cs * (k % 2 ? 0.35 : 0.65), cs * 0.16, 0, 7); ctx.fill(); } }
    if (c === 'W') { ctx.fillStyle = '#5d5248'; for (let k = 0; k < 3; k++) ctx.fillRect(x * cs + k * cs / 3, y * cs, cs / 5, cs / 4); }
    if (c === 'd') { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.moveTo(x * cs + 4, y * cs + cs / 2); ctx.lineTo(x * cs + cs - 4, y * cs + cs / 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.strokeRect(x * cs, y * cs, cs, cs);
  }
  const u0 = BV.sel && b.units.find(u => u.id === BV.sel && !u.out);
  if (u0 && b.active === BV.pk && !b.over) {
    for (const [k] of S.reachable(b, u0)) { const [x, y] = k.split(',').map(Number); ctx.fillStyle = 'rgba(255,255,220,.33)'; ctx.fillRect(x * cs + 2, y * cs + 2, cs - 4, cs - 4); }
  }
  for (const u of b.units) {
    if (u.out) continue;
    const cx = u.x * cs + cs / 2, cy = u.y * cs + cs / 2, rr = cs * 0.38;
    const col = b.sides[u.side].color || (u.side === 'A' ? '#a33' : '#33a');
    ctx.fillStyle = col; ctx.strokeStyle = u.id === BV.sel ? '#fff' : (u.side === BV.pk ? '#f3dc95' : '#111'); ctx.lineWidth = u.id === BV.sel ? 3 : 2;
    ctx.beginPath();
    if (u.type === 'cav') { ctx.moveTo(cx, cy - rr); ctx.lineTo(cx + rr, cy); ctx.lineTo(cx, cy + rr); ctx.lineTo(cx - rr, cy); ctx.closePath(); }
    else if (u.type === 'inf') ctx.rect(cx - rr, cy - rr, rr * 2, rr * 2);
    else if (u.type === 'merc') { for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); } ctx.closePath(); }
    else ctx.arc(cx, cy, rr, 0, 7);
    ctx.fill(); ctx.stroke();
    if (u.stance === 'defend') { ctx.strokeStyle = '#e8e8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rr + 3, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(cs * 0.4)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(UNIT[u.type].icon, cx, cy);
    if (u.gen) { ctx.fillStyle = '#ffd84a'; ctx.font = `${Math.round(cs * 0.3)}px serif`; ctx.fillText('♛', cx + rr * 0.8, cy - rr * 0.8); }
    ctx.fillStyle = '#300'; ctx.fillRect(cx - rr, cy + rr + 1, rr * 2, 3); ctx.fillStyle = '#5c5'; ctx.fillRect(cx - rr, cy + rr + 1, rr * 2 * u.men / u.start, 3);
    ctx.fillStyle = '#330'; ctx.fillRect(cx - rr, cy + rr + 4, rr * 2, 2); ctx.fillStyle = '#fd4'; ctx.fillRect(cx - rr, cy + rr + 4, rr * 2 * clamp(u.morale / 100, 0, 1), 2);
    if (u.side === b.active && b.active === BV.pk && !u.acted) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - rr * 0.85, cy - rr * 0.85, 3, 0, 7); ctx.fill(); }
    if (u0 && u.side !== u0.side && S.canAttack(b, u0, u)) { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, rr + 5, 0, 7); ctx.stroke(); }
  }
  if (BV.fx) { const f = BV.fx; ctx.strokeStyle = f.ranged ? 'rgba(255,255,255,.8)' : 'rgba(255,60,40,.9)'; ctx.lineWidth = 3; ctx.setLineDash(f.ranged ? [4, 4] : []); ctx.beginPath(); ctx.moveTo(f.from[0] * cs + cs / 2, f.from[1] * cs + cs / 2); ctx.lineTo(f.to[0] * cs + cs / 2, f.to[1] * cs + cs / 2); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(cs * 0.4)}px sans-serif`; ctx.fillText('−' + f.cas, f.to[0] * cs + cs / 2, f.to[1] * cs + 4); }
  bvSide();
}
function sideSum(b, k) { const l = Battle.Sim.active(b, k); return { men: l.reduce((s, u) => s + u.men, 0), mor: l.length ? Math.round(l.reduce((s, u) => s + u.morale, 0) / l.length) : 0, n: l.length }; }
function bvSide() {
  const b = BV.b, S = Battle.Sim, me = BV.pk, en = me === 'A' ? 'D' : 'A';
  const sm = sideSum(b, me), se = sideSum(b, en);
  const myTurn = b.active === me && !b.over && !BV.busy;
  $('btop').innerHTML = `<b style="color:var(--gold2)">⚔ ${esc(b.input.place || 'Битва')}${b.input.storm ? ' — штурм' : ''}</b>
   <span>Раунд ${Math.min(b.round, S.MAX_ROUNDS)}/${S.MAX_ROUNDS}</span>
   <span class="${myTurn ? 'good' : 'warn'}">${b.over ? 'Бой окончен' : myTurn ? 'Ваш ход' : 'Ход противника…'}</span>
   <span style="flex:1"></span>
   <button id="bvEnd" class="main" ${myTurn ? '' : 'disabled'}>Конец хода</button>
   <button id="bvInsp" ${myTurn && !b.inspired[me] && b.sides[me].general ? '' : 'disabled'} title="Один раз за бой: +15 к духу всех отрядов">Воодушевить</button>
   <button id="bvRet" ${b.over ? 'disabled' : ''}>Отступить</button>
   <button id="bvAuto" ${b.over ? 'disabled' : ''}>Рассчитать автоматически</button>`;
  const u = BV.sel && b.units.find(x => x.id === BV.sel && !x.out);
  let h = `<div class="small"><b style="color:${b.sides[me].color}">■ ${esc(b.sides[me].name)}</b> (вы): ${fmt(sm.men)} чел., дух ${sm.mor}${b.sides[me].general ? '<br>Полководец: ' + esc(b.sides[me].general.name) : ''}</div>
   <div class="small"><b style="color:${b.sides[en].color}">■ ${esc(b.sides[en].name)}</b>: ${fmt(se.men)} чел., дух ${se.mor}${b.sides[en].general ? '<br>Полководец: ' + esc(b.sides[en].general.name) : ''}</div><hr>`;
  if (b.over) {
    const R0 = S.result(BV.b); BV.result = BV.result || R0;
    const won = (BV.result.winner === 'attacker') === (me === 'A');
    if (!BV.endSfx) { BV.endSfx = true; SFX.play(won ? 'win' : 'lose'); }
    h += `<h2 class="${won ? 'good' : 'bad'}">${won ? 'Победа!' : 'Поражение'}</h2><p class="small">Наши потери: ${fmt(BV.result[me === 'A' ? 'attacker' : 'defender'].lost)}<br>Потери врага: ${fmt(BV.result[me === 'A' ? 'defender' : 'attacker'].lost)}</p><button class="main" id="bvDone">Вернуться на карту</button><hr>`;
  } else if (u) {
    const c = b.grid[u.y][u.x];
    h += `<div><b>${UNIT[u.type].icon} ${UNIT[u.type].name}</b> ${u.side === me ? '' : '(враг)'}${u.gen ? ' ♛' : ''}</div>
     <div class="small">Люди: ${u.men}/${u.start} · Дух: ${Math.round(u.morale)} · ${u.stance === 'defend' ? 'в обороне' : 'обычный строй'}<br>Клетка: ${Battle.Rules.CELL[c].n} (защита ×${Battle.Rules.CELL[c].def})</div>`;
    if (u.side === me && myTurn) h += `<div class="btnrow"><button id="bvDef" ${u.acted ? 'disabled' : ''}>Оборона</button><button id="bvWait" ${u.acted ? 'disabled' : ''}>Ждать</button></div><div class="small muted">Светлые клетки — куда можно пойти. Красная рамка — кого можно атаковать.</div>`;
  } else h += `<p class="small muted">Выберите свой отряд (с золотой рамкой). Белая точка — отряд ещё не ходил.<br>▣ пехота · ♞ конница · ➶ лучники · ✠ наёмники.</p>`;
  h += `<div id="blog">${b.log.slice(-40).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
  $('bside').innerHTML = h;
  $('bvEnd').onclick = () => { if (b.active !== me) return; BV.sel = null; S.endSide(b); bvRender(); if (!b.over) bvAiTurn(); };
  $('bvInsp').onclick = () => { S.inspire(b, me); bvRender(); };
  $('bvRet').onclick = () => { if (confirm('Отступить с поля боя? Бой будет проигран.')) { S.retreat(b, me); bvRender(); } };
  $('bvAuto').onclick = () => { BV.busy = false; BV.result = Battle.finishAuto(b); bvRender(); };
  if ($('bvDone')) $('bvDone').onclick = () => { $('battle').classList.add('hidden'); const r = BV.result || S.result(b); BV.result = null; BV.b = null; BV.resolve(r); };
  if ($('bvDef')) $('bvDef').onclick = () => { S.defend(b, u); BV.sel = null; bvRender(); };
  if ($('bvWait')) $('bvWait').onclick = () => { S.wait(b, u); BV.sel = null; bvRender(); };
}
function bvClick(e) {
  const b = BV.b; if (!b || b.over || b.active !== BV.pk || BV.busy) { if (b) { const r = e.target.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * 18), y = Math.floor((e.clientY - r.top) / r.height * 12); const u = Battle.Sim.unitAt(b, x, y); if (u) { BV.sel = u.id; bvRender(); } } return; }
  const S = Battle.Sim, r = e.target.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * 18), y = Math.floor((e.clientY - r.top) / r.height * 12);
  const t = S.unitAt(b, x, y), u = BV.sel && b.units.find(q => q.id === BV.sel && !q.out);
  BV.fx = null;
  if (t && t.side === BV.pk) { BV.sel = t.id; bvRender(); return; }
  if (u && u.side === BV.pk) {
    if (t && t.side !== BV.pk) {
      if (S.canAttack(b, u, t)) { bvAttackSfx(b, () => S.attack(b, u, t), u); BV.fx = b.lastFx; BV.sel = u.out ? null : u.id; bvRender(); return; }
      // подойти и ударить
      if (!u.moved && u.type !== 'arch') {
        let best = null, bc = 1e9;
        for (const [k, c] of S.reachable(b, u)) { const [X, Y] = k.split(',').map(Number); if (Math.max(Math.abs(X - t.x), Math.abs(Y - t.y)) === 1 && c < bc) { bc = c; best = [X, Y]; } }
        if (best) { S.move(b, u, best[0], best[1]); bvAttackSfx(b, () => S.attack(b, u, t), u); BV.fx = b.lastFx; bvRender(); return; }
      }
      toast('Не достать: подойдите ближе.'); BV.sel = t.id; bvRender(); return;
    }
    if (!t && S.move(b, u, x, y)) { bvRender(); return; }
  }
  BV.sel = t ? t.id : null; bvRender();
}
function bvAttackSfx(b, fn, u) {
  const before = b.units.filter(x => x.out).length; fn();
  SFX.play(u.type === 'arch' ? 'arrow' : 'hit');
  if (b.units.filter(x => x.out).length > before) setTimeout(() => SFX.play('rout'), 160);
}
function bvAiTurn() {
  const b = BV.b, side = b.active, S = Battle.Sim;
  BV.busy = true; bvRender();
  const step = () => {
    if (!BV.b || b.over || b.active !== side || !BV.busy) { BV.busy = false; if (BV.b) bvRender(); return; }
    const act = Battle.AI.next(b, side);
    if (!act) { S.endSide(b); BV.busy = false; BV.fx = null; bvRender(); if (!b.over && b.active !== BV.pk) bvAiTurn(); return; }
    if (act.kind === 'attack' || act.kind === 'moveAttack') bvAttackSfx(b, () => Battle.AI.apply(b, side, act), act.u); else Battle.AI.apply(b, side, act);
    BV.fx = (act.kind === 'attack' || act.kind === 'moveAttack') ? b.lastFx : null;
    bvRender();
    setTimeout(step, act.kind === 'wait' || act.kind === 'defend' ? 60 : 280);
  };
  setTimeout(step, 300);
}

/* ---------- 6. СОХРАНЕНИЕ И ЗАПУСК ---------- */
const SAVE_KEY = 'polychronion_save_v2';
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { } }
function load() { try { const s = localStorage.getItem(SAVE_KEY); if (!s) return false; G = JSON.parse(s); if (!G.prov) initProv(); return true; } catch (e) { return false; } }
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function enterGame() { $('title').classList.add('hidden'); $('app').classList.remove('hidden'); if (!regionGrid) initMap(); else fitMap(); UI.sel = null; UI.selArmy = null; UI.tab = 'map'; ['map', 'court', 'state', 'log'].forEach(k => $('view-' + k).classList.toggle('hidden', k !== 'map')); renderAll(); if (G.over) showFinale(); }
function showIntro() {
  return new Promise(res => {
    SFX.play('event');
    modal(`<div class="small muted">Пролог · Лето 1261</div><h2>Город снова ромейский</h2>
    <p>${esc(INTRO_TEXT)}</p>
    <div class="note"><b>Как играть.</b> Время идёт само, по дням: кнопки ❚❚ и 1–5 вверху (или пробел, клавиши 1–5, + и −). Игра начинается на паузе. Тяните карту мышью, колесо — масштаб. Нажмите на флажок своего войска (с золотой рамкой), затем на любую провинцию — войско пойдёт туда самым быстрым путём. Ctrl или Shift + щелчок — продлить маршрут через выбранную провинцию (свой путь). Правый щелчок — отменить приказ. Пунктир — морские пути (нужен флот). Горы: через хребты не пройти, кроме как по перевалу (чёрный пунктир), а переход через перевал занимает на 15 дней дольше. Войско во вражеском регионе осаждает его; штурм открывает экран боя. Во вкладке «Двор» — герои с поручениями, в «Государстве» — налоги, монета, законы, уния, флот и наследник.</div>
    <p class="small muted">Цель — дожить до 1354 года, встретив Чёрную смерть 1347 года сильной державой. Потеря Константинополя — конец игры.</p>
    <button class="main" id="introNext">Далее: кто будет править?</button>`);
    $('introNext').onclick = () => { closeModal(); res(); };
  });
}
async function startNew() { newGame(); enterGame(); await showIntro(); await runPrologue(); save(); renderAll(); }
function boot() {
  if (typeof GAME_VERSION !== 'undefined' && $('tver')) $('tver').textContent = versionText(GAME_VERSION);
  $('titlebtns').innerHTML = `<button class="main" id="tNew">Новая игра</button>${hasSave() ? '<button id="tCont">Продолжить</button>' : ''}`;
  $('tNew').onclick = startNew;
  if ($('tCont')) $('tCont').onclick = () => { if (load()) enterGame(); };
  document.addEventListener('keydown', e => {
    if (!G || !$('modal').classList.contains('hidden') || !$('battle').classList.contains('hidden') || $('app').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') setMapMode(UI.mapMode === 'geo' ? 'pol' : 'geo');
    if (e.key === ' ') { e.preventDefault(); setSpeed(UI.speed ? 0 : (UI.lastSpeed || 1)); }
    if (['1', '2', '3', '4', '5'].includes(e.key)) setSpeed(+e.key);
    if (e.key === '+' || e.key === '=') setSpeed(Math.min(5, (UI.speed || UI.lastSpeed || 0) + 1));
    if (e.key === '-') setSpeed(Math.max(0, UI.speed - 1));
    if (e.key === 'Escape') { UI.sel = null; UI.selArmy = null; UI.selProv = null; renderAll(); }
  });
}
if (!HEADLESS) boot();
