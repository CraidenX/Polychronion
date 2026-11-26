
/* ---------- 5. ИНТЕРФЕЙС ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UI = { tab: 'map', sel: null, selArmy: null, view: { x: 0, y: 0, z: 0.6 }, ridgeA: 85, mapMode: 'geo', sborder: 'black', passcol: 'black' };
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
    ctx() { return ctx; }, out() { return master; },
    toggle() { on = !on; try { localStorage.setItem('poly_sound', on ? 'on' : 'off'); } catch (e) { } if (on) S.select(); return on; },
  };
})();
if (!HEADLESS) document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button') && !e.target.closest('.nosfx')) SFX.play('click'); }, true);

/* --- звуки природы: настоящие записи (папка sounds/, авторы — sounds/CREDITS.txt; готовит tools/mksounds.py).
   Море: ровный плеск волн (петля) и чайки — громкость от того, сколько берега на экране и насколько близко камера.
   Горы: ветер (петля), редкие порывы и крики хищных птиц — громкость от того, сколько гор на экране. Вдали от того и другого — тишина --- */
const SEASND = (() => {
  let on = true; try { on = localStorage.getItem('poly_seasnd') !== 'off'; } catch (e) { }
  const st = { sea: null, mt: null, lib: null, loading: false, nextGull: 0, nextGust: 0, nextRaptor: 0, lastG: -1, lastR: -1 };
  const R = Math.random;
  // петля без шва: срезаем края (паузы mp3) и плавно сводим конец записи с её началом
  function loopify(c, b, F) {
    const sr = b.sampleRate, cut = Math.floor(0.08 * sr), f = Math.floor(F * sr), n = b.length - 2 * cut - f;
    if (n < 2 * f) return b;
    const o = c.createBuffer(b.numberOfChannels, n, sr);
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const s = b.getChannelData(ch), d = o.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = s[cut + i];
      for (let i = 0; i < f; i++) { const a = i / f; d[i] = s[cut + i] * Math.sqrt(a) + s[cut + n + i] * Math.sqrt(1 - a); }
    }
    return o;
  }
  function loop(c, buf, gain, out) { const s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; s.loop = true; g.gain.value = gain; s.connect(g); g.connect(out); s.start(0, R() * 10); }
  // звуки грузятся (~1,2 МБ) только когда звук уже включён — после первого клика игрока
  async function loadLib(c) {
    st.loading = true;
    try {
      const m = await (await fetch('sounds/sounds.json')).json();
      const get = f => fetch('sounds/' + f).then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => c.decodeAudioData(b, ok, no)));
      const lib = { gull: await Promise.all(m.gull.map(get)), gust: await Promise.all(m.gust.map(get)), raptor: await Promise.all(m.raptor.map(get)),
        sea: loopify(c, await get(m.sea), 3), wind: loopify(c, await get(m.wind), 3) };
      loop(c, lib.sea, 0.4, st.sea); loop(c, lib.wind, 0.4, st.mt);   // море — на ~18% тише прежнего плеска с волнами
      st.lib = lib;
    } catch (e) { }   // нет файлов (например, игра открыта как файл с диска) — просто без звуков природы
  }
  function play(c, out, buf, vol, pan, lp, when = 0) {   // одна запись: чуть другая высота, своё место в стереопанораме, даль — глуше
    const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = 0.94 + R() * 0.12;
    const g = c.createGain(); g.gain.value = vol; let node = s;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; s.connect(f); node = f; }
    node.connect(g);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(out); } else g.connect(out);
    s.start(c.currentTime + when);
  }
  const pick = (a, k) => { let i = Math.floor(R() * a.length); if (i === st[k] && a.length > 1) i = (i + 1) % a.length; st[k] = i; return a[i]; };   // не повторять одну запись подряд
  function gull(c, out, near) { const d = 0.55 + 0.45 * R(); play(c, out, pick(st.lib.gull, 'lastG'), 1.2 * d * (0.6 + 0.4 * near), (R() - 0.5) * 1.5, 3000 + 6000 * d); }
  function raptor(c, out) { const d = 0.4 + 0.6 * R(); play(c, out, pick(st.lib.raptor, 'lastR'), 0.75 * d, (R() - 0.5) * 1.6, 2500 + 6000 * d); }
  function gust(c, out) { play(c, out, st.lib.gust[Math.floor(R() * st.lib.gust.length)], 0.35 + 0.2 * R(), (R() - 0.5) * 1.2, 0); }
  // что видно на экране: сетка точек — где рядом и море, и суша (берег), и где горы
  function level() {
    if (!G || UI.tab !== 'map' || $('app').classList.contains('hidden') || document.hidden || !WV.md || !MAPINFO) return [0, 0, 0];
    const v = UI.view, z = v.z, w = $('mapwrap'), W = w.clientWidth, H = w.clientHeight, NX = 24, NY = 15, r = Math.min(W / NX, H / NY) * 0.6;
    const m = (a, b) => seaAt((a - v.x) / z, (b - v.y) / z) > 127, md = mtDensity(), ps = PIX.s || 2;
    let sea = 0, coast = 0, hills = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const sx = (i + 0.5) * W / NX, sy = (j + 0.5) * H / NY, c0 = m(sx, sy); if (c0) sea++;
      if (c0 !== m(sx + r, sy) || c0 !== m(sx - r, sy) || c0 !== m(sx, sy + r) || c0 !== m(sx, sy - r)) coast++;
      if (md && !c0) { const mx = Math.floor((sx - v.x) / z / ps / 16), my = Math.floor((sy - v.y) / z / ps / 16); if (mx >= 0 && my >= 0 && mx < md.w && my < md.h) hills += md.d[my * md.w + mx]; }
    }
    const n = NX * NY, zs = z * MAPINFO.W / 5298, zf = clamp(0.3 + 0.45 * zs, 0.3, 1);
    return [clamp(coast / n * 3.5 + sea / n * 0.3, 0, 1) * zf, clamp(coast / n * 4, 0, 1) * clamp((zs - 0.6) / 1.2, 0, 1), clamp(hills / Math.max(n - sea, n * 0.25) * 1.6, 0, 1) * zf]   // горы — доля среди суши на экране;
  }
  // плотность гор по клеткам 16×16 пикселей маски рельефа (1 — значок горы), сглаженная и нормированная: 1 — сплошной хребет
  function mtDensity() {
    if (st.md !== undefined && st.mdSrc === PIX.mtn) return st.md;
    const mt = PIX.mtn; st.mdSrc = mt; if (!mt) return st.md = null;
    const W = PIX.w, H = PIX.h, w = Math.ceil(W / 16), h = Math.ceil(H / 16), a = new Float32Array(w * h), d = new Float32Array(w * h);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mt[y * W + x] === 1) a[(y >> 4) * w + (x >> 4)]++;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let t = 0, c = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < w && Y < h) { t += a[Y * w + X]; c++; } } d[y * w + x] = Math.min(1, t / c / 256 / 0.18); }   // 18% пикселей под значками — уже «горы»
    return st.md = { w, h, d };
  }
  if (!HEADLESS) setInterval(() => {
    const c = SFX.ctx(); if (!c || c.state !== 'running') return;
    if (!st.sea) { for (const k of ['sea', 'mt']) { st[k] = c.createGain(); st[k].gain.value = 0; st[k].connect(SFX.out()); } const t = c.currentTime; st.nextGull = t + 5 + R() * 8; st.nextGust = t + 8 + R() * 10; st.nextRaptor = t + 10 + R() * 15; }
    const [lv, near, mv] = on && SFX.on ? level() : [0, 0, 0], now = c.currentTime;   // общие «Звуки» выключены — природа тоже молчит
    if (!st.loading && (lv > 0 || mv > 0)) loadLib(c);
    st.sea.gain.setTargetAtTime(lv * 0.7, now, 0.8); st.mt.gain.setTargetAtTime(mv * 0.7, now, 1.2);
    if (!st.lib) return;
    if (now > st.nextGull) { if (lv > 0.03 && near > 0.12) gull(c, st.sea, near); st.nextGull = now + 10 + R() * 22; }
    if (now > st.nextGust) { if (mv > 0.25) gust(c, st.mt); st.nextGust = now + 14 + R() * 18; }
    if (now > st.nextRaptor) { if (mv > 0.35) raptor(c, st.mt); st.nextRaptor = now + 20 + R() * 35; }
  }, 250);
  return {
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('poly_seasnd', on ? 'on' : 'off'); } catch (e) { } return on; },
    _t: { loopify, play, level, st },
  };
})();

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
// любое «PIX.vtKey = ''» (смена владельцев, режима карты, стиля гор) заодно сбрасывает чёткий слой
{ let vk = PIX.vtKey; PIX.shInv = 1; Object.defineProperty(PIX, 'vtKey', { get: () => vk, set: v => { if (v === '') PIX.shInv++; vk = v; } }); }
const MAXZ = 16;   // запас приближения — под будущие объекты на карте
function initMap() {
  const M = MAPINFO; setTimeout(() => setMapMode(UI.mapMode), 0);   // кнопка режима и подписи — в том режиме, с которым открылась карта
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

  $('markers').style.setProperty('--s', clamp(1.2 / (z * k), 0.03, 2.2).toFixed(4));   // вблизи значки не растут вместе с картой — войско ≈ ширине реки при сильном приближении
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
// уникальная гора под курсором (только вблизи, где она нарисована)
function landmarkAt(cx, cy) {
  if (TSP.st !== 2 || (UI.mapMode === 'geo' ? geoU(UI.view.z) < 0.5 : UI.view.z * Math.min(2, window.devicePixelRatio || 1) < 1.8)) return null;
  const r = $('mapwrap').getBoundingClientRect(), mx = (cx - r.left - UI.view.x) / UI.view.z, my = (cy - r.top - UI.view.y) / UI.view.z;
  for (const l of TSP.lms) { const rr = l.r, h = l.w * rr[3] / rr[2]; if (Math.abs(mx - l.x) < l.w * 0.4 && my > l.y - h * l.an * 0.9 && my < l.y + h * (1 - l.an) * 0.5) return l; }
  return null;
}
function provTip(cx, cy) {
  const t = $('ptip'), lm = landmarkAt(cx, cy);
  if (lm) { t.innerHTML = `<b>${esc(lm.name)}</b><br><span class="muted">${esc(lm.info)}</span>`; t.style.left = (cx + 14) + 'px'; t.style.top = (cy + 16) + 'px'; t.classList.remove('hidden'); return; }
  const k = provAt(cx, cy);
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
  UI.clickCell = GRID.ok ? cellAt(mx, my) : null;   // сетка: войско идёт в эту клетку
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
    if (addWaypoint(a, id, tp, UI.clickCell)) { toast(`Маршрут продлён до «${MAPINFO.provs[tp][4]}» — всего ≈ ${pathDays(a)} дн.`); UI.selProv = null; renderAll(); }
    else toast('Туда от последней точки маршрута не пройти.');
    return;
  }
  UI.addWay = false;
  if (a && a.owner === 'byz' && (RID(id) !== RID(a.region) || (tp != null && tp !== armyProv(a)) || (GRID.ok && UI.clickCell != null && cellDist(UI.clickCell, armyCell(a)) > 1))) {
    if (setArmyPath(a, id, tp, UI.clickCell)) { const last = a.path[a.path.length - 1]; toast(`${a.name}: поход в «${MAPINFO.provs[last][4]}» (${RNAME[provReg(last)]}) — около ${pathDays(a)} дн.${UI.speed ? '' : ' Время на паузе: нажмите 1–5.'}`); UI.selProv = null; renderAll(); return; }
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
  PIX.pCol = pCol; PIX.pOwn = pOwn; PIX.pFree = pFree;
  const sig = pCol.map(c => c ? c.join(',') : '').join(';') + '|' + pFree.join('');   // заливку пересчитываем, только если цвета правда изменились
  if (sig !== PIX.colSig) { PIX.colSig = sig; PIX.vtKey = ''; }
  if (PIX.ids) {
    // раскраска для отдалённого вида: вполовину разрешения (выборка каждого второго пикселя карты провинций)
    const tw = cv.width, th = cv.height, W = PIX.w, ids = PIX.ids, pr = PIX.provReg, st = W / tw;
    if (!PIX.buf || PIX.buf.width !== tw) PIX.buf = ctx.createImageData(tw, th);
    const d = PIX.buf.data; d.fill(0);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(PIX.h - 1, Math.floor(y * st)) * W;
      for (let x = 0; x < tw; x++) {
        const i = sy + Math.min(W - 1, Math.floor(x * st)), v = ids[i];
        if (!v) { if (PIX.outer && (PIX.outer[i] || (PIX.mtn && PIX.mtn[i] === 2))) { const o = (y * tw + x) * 4; d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175; } continue; }   // земли за краем зоны — серая вуаль
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
// набор плиток: HI — обычная подложка, HIC — та же без гор и деревьев (вблизи под нарисованным рельефом)
function hiSet(dir, now) {
  const H = { idx: null, img: new Map(), use: 0, dir, has: new Set(), asked: false };
  H.load = () => { if (H.asked || HEADLESS || typeof fetch === 'undefined' || location.protocol === 'file:') return; H.asked = true;
    fetch(dir + '/index.json').then(r => r.ok ? r.json() : null).then(j => { if (j) { H.idx = j; H.has = new Set(j.tiles.map(t => t[0] + '_' + t[1])); scheduleVector(); } }).catch(() => { }); };
  if (now) H.load();
  return H;
}
const HI = hiSet(HIDIR, true), HIC = hiSet(HIDIR + 'c', false);
function drawHiTiles(ctx, vx0, vy0, vx1, vy1, toS, H = HI) {
  const T = H.idx.T, tx0 = Math.floor(vx0 / T), ty0 = Math.floor(vy0 / T), tx1 = Math.floor((vx1 - 1) / T), ty1 = Math.floor((vy1 - 1) / T);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingQuality = 'high';
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const key = tx + '_' + ty; if (!H.has.has(key)) continue;
    let e = H.img.get(key);
    if (!e) { const im = new Image(); e = { im, ok: false }; im.onload = () => { e.ok = true; scheduleVector(); }; im.src = H.dir + '/' + key + '.jpg'; H.img.set(key, e); }
    e.use = ++H.use;
    if (!e.ok) continue;
    const [a, b] = toS(tx * T, ty * T), [c, d] = toS(tx * T + e.im.naturalWidth / 2, ty * T + e.im.naturalHeight / 2);
    ctx.drawImage(e.im, a, b, c - a, d - b);
  }
  ctx.restore();
  if (H.img.size > 40) { const old = [...H.img.entries()].sort((p, q) => p[1].use - q[1].use).slice(0, H.img.size - 40); for (const [k] of old) H.img.delete(k); }   // держим в памяти не больше 40 плиток
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
/* --- значки вблизи: горы и деревья акварельной подложки, нарисованные игрой заново (icons{WCV}.bin + trees.png, готовит mkwater.py) —
   те же места, формы и цвета, но резкие на любом масштабе и непрозрачные. Грузятся (~0,4–0,8 МБ) при первом сильном приближении --- */
const ICO = { st: 0 };
// ближний уровень рельефа (mkterrain_sprites.py): нарисованные горы, холмы, перевалы, уникальные горы — атлас terrain_atlas.webp и
// расстановка terrain_sprites.json; деревья — icons_t*.bin (без деревьев под уникальными горами и на непроходимых хребтах).
// Если файлов нет — прежние значки подложки (icons*.bin: векторные горы и деревья).
const TSP = { st: 0 };
function icoLoad() {
  if (ICO.st || !ISWC || HEADLESS || location.protocol === 'file:') return; ICO.st = 1;
  const img = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
  const bin = f => fetch(f).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); });
  const terrain = Promise.all([fetch('terrain_sprites.json').then(r => { if (!r.ok) throw 0; return r.json(); }), img('terrain_atlas.webp')]).then(([j, at]) => ({ j, at })).catch(() => null);
  terrain.then(t => Promise.all([t ? bin(`icons_t${WCV}.bin`).catch(() => bin(`icons${WCV}.bin`)) : bin(`icons${WCV}.bin`), img('trees.png'), t])).then(([buf, im, t]) => {
    const dv = new DataView(buf), nm = dv.getUint32(0, true), nt = dv.getUint32(4, true); let o = 8;
    const rgb = q => `rgb(${dv.getUint8(q)},${dv.getUint8(q + 1)},${dv.getUint8(q + 2)})`, CELL = 64, cw = Math.ceil(MAPINFO.W / CELL) + 1;
    const mg = new Map(), tg = new Map(), sg = new Map(), put = (g, x, y, v) => { const k = Math.floor(y / CELL) * cw + Math.floor(x / CELL); let a = g.get(k); if (!a) g.set(k, a = []); a.push(v); };
    for (let i = 0; i < nm; i++, o += 48) {
      const m = { x: dv.getUint16(o, true) / 8, y: dv.getUint16(o + 2, true) / 8, s: dv.getInt16(o + 4, true) / 100, wk: dv.getInt16(o + 6, true) / 1000, pk: dv.getInt16(o + 8, true) / 1000,
        vx: dv.getInt16(o + 10, true) / 1000, vm: dv.getInt16(o + 12, true) / 1000, vy: dv.getInt16(o + 14, true) / 1000, snow: dv.getUint8(o + 16), lt: rgb(o + 17), dk: rgb(o + 20), prof: [] };
      for (let j = 0; j < 25; j++) m.prof.push(dv.getUint8(o + 23 + j) / 200);
      put(mg, m.x, m.y, m);
    }
    for (let i = 0; i < nt; i++, o += 6) { const b = dv.getUint8(o + 5); put(tg, dv.getUint16(o, true) / 8, dv.getUint16(o + 2, true) / 8, { x: dv.getUint16(o, true) / 8, y: dv.getUint16(o + 2, true) / 8, r: dv.getUint8(o + 4) / 100, con: b & 1, idx: b >> 1 }); }
    if (t) {
      const S = t.j.sets;
      for (const [set, v, x, y, w, c] of t.j.items) put(sg, x, y, { set, v, x, y, w, c, r: S[set].r[v], an: S[set].anchor });
      for (const l of t.j.landmarks) put(sg, l.x, l.y, Object.assign(l, { v: 0, r: S[l.set].r[0], an: S[l.set].anchor, lm: true }));
      Object.assign(TSP, { st: 2, atlas: t.at, sets: S, lms: t.j.landmarks, ischia: t.j.ischia });
    }
    Object.assign(ICO, { st: 2, mg, tg, sg, CELL, cw, atlas: im, N: im.width / 10 });
    PIX.vtKey = ''; scheduleVector();
  }).catch(() => { ICO.st = 3; });
}
// нарисовать участок [X0..X1)×[Y0..Y1) на холст c в масштабе S: деревья, нарисованные горы и холмы — в одной очереди от дальних к ближним (по y)
function icoDraw(c, X0, Y0, X1, Y1, S) {
  const M = 150, q = [];
  const get = g => { if (!g) return; for (let cy = Math.floor((Y0 - 30) / ICO.CELL); cy <= Math.floor((Y1 + M) / ICO.CELL); cy++) for (let cx = Math.floor((X0 - M) / ICO.CELL); cx <= Math.floor((X1 + M) / ICO.CELL); cx++) { const a = g.get(cy * ICO.cw + cx); if (a) for (const v of a) q.push(v); } };
  get(ICO.tg); get(ICO.mg); get(ICO.sg);
  q.sort((p, r) => p.y - r.y);
  c.save(); c.setTransform(S, 0, 0, S, -X0 * S, -Y0 * S); c.lineJoin = 'round'; c.lineCap = 'round'; c.imageSmoothingQuality = 'high';
  const N = ICO.N, A = TSP.atlas;
  for (const m of q) {
    if (m.set) {   // нарисованный спрайт: ширина w (px карты), точка привязки — доля высоты от верха
      const r = m.r, w = m.w, h = w * r[3] / r[2];
      if (m.x + w / 2 < X0 || m.x - w / 2 > X1 || m.y - h * m.an > Y1 || m.y + h * (1 - m.an) < Y0) continue;
      c.drawImage(A, r[0], r[1], r[2], r[3], m.x - w / 2, m.y - h * m.an, w, h); continue;
    }
    if (m.r !== undefined && m.idx !== undefined) {   // дерево
      const r = m.r, px = Math.max(3, r * 4.2);
      c.globalAlpha = 0.1; c.fillStyle = '#2a2418'; c.beginPath(); c.ellipse(m.x + r * 0.8, m.y + r * 0.4, r * 1.1, r * 0.5, 0, 0, 2 * Math.PI); c.fill();   // тень вправо-вниз
      c.globalAlpha = 1; c.drawImage(ICO.atlas, m.idx * N, m.con * N, N, N, m.x - px / 2, m.y - px * 0.72, px, px); continue;
    }
    const wd = m.s * m.wk, P = m.prof, pts = []; let ip = 0;   // прежняя векторная гора (если нет атласа рельефа)
    for (let i = 0; i < 25; i++) { pts.push([m.x + (-1 + i / 12) * wd / 2, m.y - m.s * P[i]]); if (P[i] > P[ip]) ip = i; }
    for (let i = 23; i >= 1; i--) { const t = -1 + i / 12; pts.push([m.x + t * wd / 2, m.y + m.s * 0.07 * (1 - t * t)]); }
    const poly = (a, col) => { c.beginPath(); c.moveTo(a[0][0], a[0][1]); for (let i = 1; i < a.length; i++) c.lineTo(a[i][0], a[i][1]); c.closePath(); c.fillStyle = col; c.fill(); };
    poly(pts, m.dk);
    const vx = pts[ip][0] + m.vx * wd, vmid = [(pts[ip][0] + vx) / 2 + m.vm * wd, m.y - m.s * m.vy];
    poly(pts.slice(0, ip + 1).concat([vmid, [vx, m.y]]), m.lt);
    if (m.snow) { const cap = pts.filter(p => p[1] < m.y - m.s * 0.72); if (cap.length >= 2) { c.globalAlpha = 0.85; poly([cap[0]].concat(cap, [cap[cap.length - 1]]), '#f2f0eb'); c.globalAlpha = 1; } }
    c.beginPath(); c.moveTo(pts[1][0], pts[1][1]); for (let i = 2; i < 24; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.strokeStyle = 'rgba(70,48,32,.6)'; c.lineWidth = 0.9; c.stroke();
  }
  c.restore();
}
/* --- «Местность»: один вид на каждый уровень приближения. До GEO_T0 — только нарисованная подложка; с GEO_T1 — только спрайты рельефа и рощи
   на подложке без старых гор и деревьев; между ними — короткий переход: спрайты проявляются и чуть растут (0,9 → 1,0), подложка меняется одновременно --- */
const GEO_T0 = 2.6, GEO_T1 = 3.0;
function geoU(z) { const t = clamp((z - GEO_T0) / (GEO_T1 - GEO_T0), 0, 1); return t * t * (3 - 2 * t); }
const TL = { tmp: null };
// маска моря, размытая на ~2–3 px карты (sea.png — вполовину разрешения): мягкий край обрезки подножий у берега
function seaBlur() {
  if (TL.seab) return TL.seab; const m = WV.mask, c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const x = c.getContext('2d'); x.filter = 'blur(1.2px)'; x.drawImage(m, 0, 0); return TL.seab = c;
}
function terrainLive(ctx, vx0, vy0, vx1, vy1, z, dpr, v) {
  const u = geoU(z); if (u <= 0 || ICO.st !== 2 || TSP.st !== 2) return;
  const sc = 1, k = dpr * z, M = 150, q = [];   // тот же размер, что у запечённых в дальний вид: при приближении спрайты не прыгают, только становятся чётче
  const get = g => { for (let cy = Math.floor((vy0 - 30) / ICO.CELL); cy <= Math.floor((vy1 + M) / ICO.CELL); cy++) for (let cx = Math.floor((vx0 - M) / ICO.CELL); cx <= Math.floor((vx1 + M) / ICO.CELL); cx++) { const a = g.get(cy * ICO.cw + cx); if (a) for (const o of a) q.push(o); } };
  get(ICO.tg); get(ICO.sg); q.sort((a, b) => a.y - b.y);
  ctx.save(); ctx.setTransform(k, 0, 0, k, dpr * v.x, dpr * v.y); ctx.globalAlpha = Math.min(1, u * 8);   // живые спрайты стоят ровно на запечённых: быстро становятся непрозрачными — картинка не бледнеет ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const A = TSP.atlas, N = ICO.N, sea = WV.mask;
  for (const m of q) {
    if (m.set) {
      const r = m.r, w = m.w * sc, h = w * r[3] / r[2], x0 = m.x - w / 2, y0 = m.y - h * m.an;
      if (x0 > vx1 || x0 + w < vx0 || y0 > vy1 || y0 + h < vy0) continue;
      if ((m.c || m.lm) && sea) {   // берег: нижние 25 % высоты (подножие) — только над сушей, с мягким краем; верх может нависать над водой
        const tw = Math.max(1, Math.ceil(w * k)), th = Math.max(1, Math.ceil(h * k)), t = TL.tmp || (TL.tmp = document.createElement('canvas'));
        if (t.width < tw || t.height < th) { t.width = Math.max(t.width, tw); t.height = Math.max(t.height, th); }
        const c = t.getContext('2d'); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, tw, th); c.imageSmoothingQuality = 'high';
        c.drawImage(A, r[0], r[1], r[2], r[3], 0, 0, tw, th);
        // маска «море под подножием»: море (размытое на 2–3 px) × плавная полоса от 62 % до 80 % высоты спрайта — без прямоугольной подрезки
        const m2 = TL.m2 || (TL.m2 = document.createElement('canvas')); if (m2.width < tw || m2.height < th) { m2.width = Math.max(m2.width, tw); m2.height = Math.max(m2.height, th); }
        const mc = m2.getContext('2d'); mc.globalCompositeOperation = 'source-over'; mc.clearRect(0, 0, tw, th); mc.imageSmoothingQuality = 'high';
        mc.drawImage(seaBlur(), x0 / 2, y0 / 2, w / 2, h / 2, 0, 0, tw, th);
        const gr = mc.createLinearGradient(0, th * 0.62, 0, th * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
        mc.globalCompositeOperation = 'destination-in'; mc.fillStyle = gr; mc.fillRect(0, 0, tw, th);
        c.globalCompositeOperation = 'destination-out'; c.drawImage(m2, 0, 0, tw, th, 0, 0, tw, th); c.globalCompositeOperation = 'source-over';
        ctx.drawImage(t, 0, 0, tw, th, x0, y0, w, h);
      } else ctx.drawImage(A, r[0], r[1], r[2], r[3], x0, y0, w, h);
      continue;
    }
    if (m.idx !== undefined) {   // роща (старые кроны, реже)
      const r = m.r * sc, px = Math.max(3, r * 4.2);
      if (m.x + px < vx0 || m.x - px > vx1 || m.y - px > vy1 || m.y + px < vy0) continue;
      ctx.drawImage(ICO.atlas, m.idx * N, m.con * N, N, N, m.x - px / 2, m.y - px * 0.72, px, px);
    }
  }
  ctx.restore();
}
// Гладкая заливка держав вблизи: участок карты [X0..X1)×[Y0..Y1) в S раз подробнее. Для каждой «категории» (суша державы,
// река, значок горы, лес, внешние земли) берётся маска 0/1, слегка размывается и интерполируется по подпикселям, а затем
// снова делается чёткой (крутой порог) — так кромки рек, берегов и гор становятся плавными кривыми, а не квадратами пикселей.
function sharpFill(X0, Y0, X1, Y1, S, geo) {   // geo — режим «Местность»: только реки
  const W = PIX.w, ids = PIX.ids, pr = PIX.provReg, pc = PIX.pCol, po = PIX.pOwn, mt = PIX.mtn, outer = PIX.outer, pf = PIX.pFree;
  const rw = X1 - X0 + 2, rh = Y1 - Y0 + 2, n = rw * rh;   // с запасом в 1 пиксель по краям
  const F = new Float32Array(n), Rv = new Float32Array(n), Mo = new Float32Array(n), Fo = new Float32Array(n), Ou = new Float32Array(n), col = new Int32Array(n).fill(-1);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const gx = X0 + x - 1, gy = Y0 + y - 1, j = y * rw + x; if (gx < 0 || gy < 0 || gx >= W || gy >= PIX.h) continue;
    const i = gy * W + gx, v = ids[i];
    if (!v) { if (outer && (outer[i] || (mt && mt[i] === 2))) Ou[j] = 1; continue; }   // земли за краем зоны — сплошная вуаль, вместе с руслами рек
    if (mt && mt[i] === 2) Rv[j] = 1;
    if (geo) continue;
    if (pr[v] < 0 || po[v] < 0) continue;
    F[j] = 1; col[j] = v; const m = mt && mt[i] && !pf[v];
    if (m) { if (mt[i] === 3) Fo[j] = 1; else if (mt[i] === 1) Mo[j] = 1; }
  }
  const blur = a => { const t = new Float32Array(n), o = new Float32Array(n);   // [1 2 1]⊗[1 2 1] / 16
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const j = y * rw + x; t[j] = (a[j - (x > 0)] + 2 * a[j] + a[j + (x < rw - 1)]) / 4; }
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const j = y * rw + x; o[j] = (t[j - (y > 0) * rw] + 2 * t[j] + t[j + (y < rh - 1) * rw]) / 4; }
    return o; };
  const Fb = blur(F), Rb = blur(Rv), Mb = blur(Mo), Fob = blur(Fo), Oub = blur(Ou);
  const ow = (X1 - X0) * S, oh = (Y1 - Y0) * S, cv = (PIX.sk && PIX.sk.cv) || document.createElement('canvas');
  if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
  const cx = cv.getContext('2d'), im = cx.createImageData(ow, oh), d = im.data, e = 0.09, A0 = 190, AR = 20, AM = TSP.st === 2 ? Math.min(UI.ridgeA, 50) : UI.ridgeA, AF = 115;   // нарисованный рельеф — под лёгким оттенком державы
  // свои значки (горы, деревья): в «Местности» — просто поверх подложки; на политической — под цветом державы (просвечивают, как раньше)
  const useIco = ICO.st === 2 && !geo && UI.ridgeA < 190;   // в «Местности» рельеф и деревья рисуются поверх, каждый кадр (terrainLive)
  let ic = null;
  if (useIco) { const t = PIX.icCv || (PIX.icCv = document.createElement('canvas')); t.width = ow; t.height = oh; const tc = t.getContext('2d'); icoDraw(tc, X0, Y0, X1, Y1, S); ic = tc.getImageData(0, 0, ow, oh).data; }
  const crisp = t => t <= 0.5 - e ? 0 : t >= 0.5 + e ? 1 : (t = (t - 0.5 + e) / (2 * e), t * t * (3 - 2 * t));
  for (let oy = 0; oy < oh; oy++) {
    const fy = (oy + 0.5) / S + 0.5, y0 = Math.floor(fy), ay = fy - y0;   // +1 запас −0,5 центр пикселя
    for (let ox = 0; ox < ow; ox++) {
      const fx = (ox + 0.5) / S + 0.5, x0 = Math.floor(fx), ax = fx - x0, j = y0 * rw + x0;
      const bl = a => (a[j] * (1 - ax) + a[j + 1] * ax) * (1 - ay) + (a[j + rw] * (1 - ax) + a[j + rw + 1] * ax) * ay;
      const o = (oy * ow + ox) * 4, f = geo ? 0 : crisp(bl(Fb)), rv = crisp(bl(Rb));
      if (rv > 0) {   // река — своим чётким цветом (а не размытой подложкой), с чуть более тёмной кромкой; деревья и горы — поверх реки, как в подложке
        const edge = 1 - Math.abs(rv * 2 - 1); let r0 = 56 - 22 * edge, g0 = 104 - 26 * edge, b0 = 150 - 30 * edge, a0 = 245 * rv / 255;
        if (ic && ic[o + 3]) {
          let ir = ic[o], ig = ic[o + 1], ib = ic[o + 2]; const pv = col[j] >= 0 ? col[j] : col[j + 1] >= 0 ? col[j + 1] : col[j + rw];
          if (!geo && pv >= 0 && pc[pv] && !pf[pv]) { const t = AM / 255, cc = pc[pv]; ir = ir * (1 - t) + cc[0] * t; ig = ig * (1 - t) + cc[1] * t; ib = ib * (1 - t) + cc[2] * t; }   // тот же оттенок державы, что у остальных значков
          const ia = ic[o + 3] / 255, oa = ia + a0 * (1 - ia); r0 = (ir * ia + r0 * a0 * (1 - ia)) / oa; g0 = (ig * ia + g0 * a0 * (1 - ia)) / oa; b0 = (ib * ia + b0 * a0 * (1 - ia)) / oa; a0 = oa; }
        d[o] = r0; d[o + 1] = g0; d[o + 2] = b0; d[o + 3] = a0 * 255; continue;
      }
      if (f > 0) {
        // цвет — ближайшего пикселя державы (на стыке держав цвет меняется резко — его закрывает векторная граница)
        // цвет — «голосование» четырёх соседних пикселей с весами по расстоянию: стык держав идёт плавной кривой, а не ступеньками
        let c = col[j], c1 = col[j + 1], c2 = col[j + rw], c3 = col[j + rw + 1];
        if (c !== c1 || c !== c2 || c !== c3) {
          const w0 = (1 - ax) * (1 - ay), w1 = ax * (1 - ay), w2 = (1 - ax) * ay, w3 = ax * ay, cs = [c, c1, c2, c3], ws = [w0, w1, w2, w3]; let best = -1, bw = -1;
          for (let q = 0; q < 4; q++) { const cq = cs[q]; if (cq < 0) continue; let t = 0; for (let r = 0; r < 4; r++) if (cs[r] === cq) t += ws[r]; if (t > bw) { bw = t; best = cq; } }
          c = best;
        }
        if (c < 0) continue;
        const cc = pc[c]; let a = A0;
        if (pf[c]) { const gx = X0 + ox / S, gy = Y0 + oy / S; a = ((gx + gy) % 10 < 1 || (gx - gy + 99999) % 10 < 1) ? 120 : 0; }
        else if (!useIco) { const mm = crisp(bl(Mb)), fo = crisp(bl(Fob)); a = a + (AF - a) * fo; a = a + (AM - a) * mm; }
        if (ic && ic[o + 3]) {   // значок под цветом державы: цвет державы — полупрозрачный слой над резким значком
          const ia = ic[o + 3] / 255, af = (AM / 255) * f, oa = af + ia * (1 - af);
          d[o] = (cc[0] * af + ic[o] * ia * (1 - af)) / oa; d[o + 1] = (cc[1] * af + ic[o + 1] * ia * (1 - af)) / oa; d[o + 2] = (cc[2] * af + ic[o + 2] * ia * (1 - af)) / oa; d[o + 3] = oa * 255 * (a * f + (255 - a * f) * ia) / 255 / Math.max(1e-3, oa);
          d[o + 3] = Math.min(255, (af + ia * (1 - af)) * 255); continue;
        }
        d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = a * f;
      } else { const u = crisp(bl(Oub)); if (u > 0) { d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175 * u; } }
      if (ic && ic[o + 3] && d[o + 3] === 0) { d[o] = ic[o]; d[o + 1] = ic[o + 1]; d[o + 2] = ic[o + 2]; d[o + 3] = ic[o + 3]; }   // «Местность» и края — значок как есть
    }
  }
  cx.putImageData(im, 0, 0);
  PIX.sk = { cv, X0, Y0, X1, Y1, S, geo, ico: useIco };
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
    // вблизи — подложка без гор и деревьев: их рисует ближний уровень рельефа (плавно, вместе с ним)
    const tt = clamp((z * dpr - 1.8) / 1.6, 0, 1), tA = TSP.st === 2 ? (UI.mapMode === 'geo' ? geoU(z) : tt * tt * (3 - 2 * tt)) : 0;
    if (tA > 0) { HIC.load(); if (HIC.idx) { ctx.globalAlpha = tA; drawHiTiles(ctx, vx0, vy0, vx1, vy1, toS, HIC); ctx.globalAlpha = 1; } }
  } else { ctx.fillStyle = '#808080'; ctx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0); }
  // раскраска держав: вблизи — видимая часть в полном разрешении, на отдалении — общий холст вполовину разрешения
  // вблизи — гладкая заливка с подпикселями и резкими значками гор и лесов. Пересчёт дорогой: пока карту двигают, показываем
  // последний готовый чёткий кадр (растянутый), а пересчитываем после остановки. Между 1,8× и 3,4× — плавный переход.
  const zd = z * dpr, shS = clamp(Math.round(zd / 2), 1, 10), shGeo = UI.mapMode === 'geo', sk = PIX.sk;
  if (zd >= 1.5) icoLoad();
  const shSame = sk && sk.geo === shGeo && sk.ver === PIX.shInv && sk.ico === (ICO.st === 2 && (shGeo || UI.ridgeA < 190));
  const shFits = shSame && sk.S === shS && vx0 >= sk.X0 && vy0 >= sk.Y0 && vx1 <= sk.X1 && vy1 <= sk.Y1;
  const shMoving = performance.now() - (UI.lastMove || 0) < 140, shWant = PIX.ids && PIX.pCol && (shGeo ? z >= GEO_T0 : zd >= 1.8);
  if (shWant && !shFits && !shMoving) {
    const G16 = 16;
    const X0 = Math.max(0, Math.floor((vx0 - (vx1 - vx0) * 0.3) / G16) * G16), Y0 = Math.max(0, Math.floor((vy0 - (vy1 - vy0) * 0.3) / G16) * G16);
    const X1 = Math.min(PIX.w, Math.ceil((vx1 + (vx1 - vx0) * 0.3) / G16) * G16), Y1 = Math.min(PIX.h, Math.ceil((vy1 + (vy1 - vy0) * 0.3) / G16) * G16);
    sharpFill(X0, Y0, X1, Y1, shS, shGeo); PIX.sk.ver = PIX.shInv;
  } else if (shWant && !shFits) { clearTimeout(PIX.shT); PIX.shT = setTimeout(scheduleVector, 170); }
  const skNow = PIX.sk, shReady = shWant && skNow && skNow.geo === shGeo && skNow.ver === PIX.shInv;
  const shT = clamp((zd - 1.8) / 1.6, 0, 1), shA = shReady ? (shGeo ? geoU(z) : shT * shT * (3 - 2 * shT)) : 0;   // доля чёткого слоя: «Местность» — коротко 2,6–3,0×, политическая — 1,8–3,4×
  const drawSharp = () => { if (!shA) return; const k = PIX.sk, [sx0, sy0] = toS(k.X0, k.Y0), [sx1, sy1] = toS(k.X1, k.Y1); ctx.globalAlpha = shA; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(k.cv, sx0, sy0, sx1 - sx0, sy1 - sy0); ctx.globalAlpha = 1; };
  const shFull = shA >= 1 && skNow.X0 <= vx0 && skNow.Y0 <= vy0 && skNow.X1 >= vx1 && skNow.Y1 >= vy1;
  if (shFull) drawSharp();   // чёткий кадр закрывает весь экран
  else if (UI.mapMode === 'geo') {   // «Местность»: державы без заливки; земли за краем зоны — сплошная вуаль (вместе с руслами), затем чёткий слой вблизи
    if (PIX.ids && PIX.outer) {
      if (!PIX.outerCv) {
        const W = PIX.w, H2 = PIX.h, tw = Math.ceil(W / 2), th = Math.ceil(H2 / 2), c = document.createElement('canvas'); c.width = tw; c.height = th;
        const cx = c.getContext('2d'), im = cx.createImageData(tw, th), d = im.data, ids = PIX.ids, ou = PIX.outer, mt = PIX.mtn;
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const i = Math.min(H2 - 1, y * 2) * W + Math.min(W - 1, x * 2); if (!ids[i] && (ou[i] || (mt && mt[i] === 2))) { const o = (y * tw + x) * 4; d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175; } }
        cx.putImageData(im, 0, 0); PIX.outerCv = c;
      }
      const t = PIX.outerCv, k = t.width / M.W; ctx.drawImage(t, vx0 * k, vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k, dx0, dy0, dx1 - dx0, dy1 - dy0);
    }
    drawSharp();
  }
  else if (PIX.ids && PIX.pCol && z >= 1.1) {
    const X0 = Math.floor(vx0), Y0 = Math.floor(vy0), X1 = Math.min(PIX.w, Math.ceil(vx1)), Y1 = Math.min(PIX.h, Math.ceil(vy1));
    const vw = X1 - X0, vh = Y1 - Y0, key = X0 + ',' + Y0 + ',' + vw + ',' + vh;
    if (!PIX.vt) PIX.vt = document.createElement('canvas');
    if (PIX.vtKey !== key) {
      const vt = PIX.vt; if (vt.width !== vw || vt.height !== vh) { vt.width = vw; vt.height = vh; }
      const vc = vt.getContext('2d'), im = vc.createImageData(vw, vh), d = im.data, ids = PIX.ids, pr = PIX.provReg, pc = PIX.pCol, po = PIX.pOwn, mt = PIX.mtn, W = PIX.w;
      for (let y = 0; y < vh; y++) { const row = (Y0 + y) * W + X0; for (let x = 0; x < vw; x++) { const i = row + x, v = ids[i]; if (!v) { if (PIX.outer && (PIX.outer[i] || (mt && mt[i] === 2))) { const o = (y * vw + x) * 4; d[o] = 118; d[o + 1] = 116; d[o + 2] = 112; d[o + 3] = 175; } continue; } if (pr[v] < 0 || po[v] < 0) continue; const m = mt && mt[i] && !PIX.pFree[v], c = pc[v], o = (y * vw + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; const gx = X0 + x, gy = Y0 + y; d[o + 3] = PIX.pFree[v] ? (((gx + gy) % 10 < 1 || (gx - gy + 99999) % 10 < 1) ? 120 : 0) : (m ? (mt[i] === 2 ? 20 : mt[i] === 3 ? 115 : UI.ridgeA) : 190); } }
      vc.putImageData(im, 0, 0); PIX.vtKey = key;
    }
    const [sx0, sy0] = toS(X0, Y0), [sx1, sy1] = toS(X1, Y1);
    ctx.drawImage(PIX.vt, sx0, sy0, sx1 - sx0, sy1 - sy0);
  } else if (PIX.tint) { const t = PIX.tint, k = t.width / M.W; ctx.drawImage(t, vx0 * k, vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k, dx0, dy0, dx1 - dx0, dy1 - dy0); }
  if (!shFull && UI.mapMode !== 'geo') drawSharp();   // переход и края: чёткий слой поверх быстрого
  if (UI.mapMode === 'geo') terrainLive(ctx, vx0, vy0, vx1, vy1, z, dpr, v);   // «Местность»: рельеф и рощи — каждый кадр, с коротким переходом
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
  if (GRID.ok && UI.gridDbg) drawGridDebug(ctx, z);
  myArmies().forEach(x => {
    if (GRID.ok) {   // сетка: маршрут по клеткам; у выбранного войска — точка на каждый день пути
      if (!x.path.length) return; if (!x.route) pathDays(x); const r = x.route; if (!r) return;
      const col = x === a ? 'rgba(200,30,30,.95)' : 'rgba(150,60,170,.85)', ri = Math.max(0, x.ri || 0);
      ctx.setLineDash(x === a ? [] : [w(10), w(6)]); ctx.strokeStyle = col; ctx.lineWidth = w(x === a ? 1.6 : 2.5); ctx.globalAlpha = x === a ? 0.4 : 1;
      ctx.beginPath(); const p0 = armyXY(x); ctx.moveTo(p0[0], p0[1] + 4);
      for (let i = ri + 1; i < r.c.length; i++) { const q = cellXY(r.c[i]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (x === a) {
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(255,240,220,.9)'; ctx.lineWidth = w(1);
        const t0 = x.rt || 0; let next = Math.floor(t0) + 1, i = ri;
        while (i < r.c.length - 1) {
          if (r.d[i + 1] >= next) { const u = (next - r.d[i]) / Math.max(1e-6, r.d[i + 1] - r.d[i]), q0 = cellXY(r.c[i]), q1 = cellXY(r.c[i + 1]); ctx.beginPath(); ctx.arc(q0[0] + (q1[0] - q0[0]) * u, q0[1] + (q1[1] - q0[1]) * u, w(2.6), 0, 7); ctx.fill(); ctx.stroke(); next++; continue; }
          i++;
        }
      }
      const q = cellXY(r.c[r.c.length - 1]); ctx.beginPath(); ctx.arc(q[0], q[1], w(5), 0, 7); ctx.fillStyle = col; ctx.fill();
      return;
    }
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
    const legs = [];   // для выбранного войска: [ломаная, дней] — по точке на каждый день пути
    if (x === a && x.leg && typeof x.leg.from === 'number') { const rp = roadPts(x.leg.from, x.leg.to), f = legPos(x), cut = Math.floor(f * (rp.length - 1)); legs.push([[armyXY(x)].concat(rp.slice(cut + 1)), Math.max(0, x.leg.dur - x.leg.t)]); }
    for (const k of x.path) { if (typeof k !== 'number' || k === cur) continue; const rp = roadPts(cur, k); for (const q of rp.slice(1)) ctx.lineTo(q[0], q[1]); if (x === a) { const e = provGraph().adj[cur].find(q => q.to === k); legs.push([rp, e ? e.d : 1]); } p = [MAPINFO.provs[k][1], MAPINFO.provs[k][2]]; cur = k; }
    if (x === a) { ctx.globalAlpha = 0.35; ctx.lineWidth = w(1.6); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (x === a) {   // одна точка — один день марша (горы, леса, броды и перевалы — точки чаще)
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(255,240,220,.9)'; ctx.lineWidth = w(1);
      for (const [rp, days] of legs) {
        const n = Math.max(1, Math.round(days)), L = []; let tot = 0;
        for (let j = 1; j < rp.length; j++) { const d = Math.hypot(rp[j][0] - rp[j - 1][0], rp[j][1] - rp[j - 1][1]); L.push(d); tot += d; }
        for (let i = 1; i <= n; i++) {
          let s2 = tot * i / n, j = 0; while (j < L.length - 1 && s2 > L[j]) { s2 -= L[j]; j++; }
          const u = L[j] ? s2 / L[j] : 0, px = rp[j][0] + (rp[j + 1] ? (rp[j + 1][0] - rp[j][0]) * u : 0), py = rp[j][1] + (rp[j + 1] ? (rp[j + 1][1] - rp[j][1]) * u : 0);
          ctx.beginPath(); ctx.arc(px, py, w(2.6), 0, 7); ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 7); ctx.fillStyle = col; ctx.fill();
  });
}
// отладка сетки (клавиша G): цвет клетки — множитель скорости, красные — непроходимые, синие — море; броды и мосты — значки на рёбрах
function drawGridDebug(ctx, z) {
  const v = UI.view, wrap = $('mapwrap'), C = GRID.C, W = GRID.GW;
  const x0 = Math.max(0, Math.floor(-v.x / z / C)), y0 = Math.max(0, Math.floor(-v.y / z / C)), x1 = Math.min(W - 1, Math.ceil((wrap.clientWidth - v.x) / z / C)), y1 = Math.min(GRID.GH - 1, Math.ceil((wrap.clientHeight - v.y) / z / C));
  if ((x1 - x0) * (y1 - y0) > 60000) { toastOnce('Сетка видна при приближении (от ~1,5×).'); return; }
  ctx.save(); ctx.globalAlpha = 0.42;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, f = GRID.flags[i], m = GRID.mult[i];
    if (!(f & 1)) { if (f & 32) { ctx.fillStyle = '#2a6fb0'; ctx.fillRect(x * C, y * C, C, C); } continue; }
    if (!m) ctx.fillStyle = (f & 2) ? '#c0101c' : '#555';   // непроходимые горы — красные, вне зоны — серые
    else { const t = clamp((m - 0.4) / 0.85, 0, 1); ctx.fillStyle = `hsl(${Math.round(35 + t * 95)},70%,${Math.round(38 + t * 8)}%)`; }   // медленно — охра, быстро — зелень
    ctx.fillRect(x * C + 0.3, y * C + 0.3, C - 0.6, C - 0.6);
  }
  ctx.globalAlpha = 1;
  if (z >= 2.5) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, e = GRID.edge[i]; if (!e) continue;
    for (let k = 0; k < 4; k++) { const c = (e >> (2 * k)) & 3; if (!c) continue; const [dx, dy] = [[1, 0], [0, 1], [1, 1], [-1, 1]][k];
      const px = x * C + C / 2 + dx * C / 2, py = y * C + C / 2 + dy * C / 2; ctx.fillStyle = c === 1 ? '#9fe3ff' : c === 2 ? '#1b3cff' : '#ffffff';
      ctx.beginPath(); ctx.arc(px, py, c === 2 ? 1.3 : 0.9, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}
function toastOnce(t) { if (UI._lastToast === t) return; UI._lastToast = t; toast(t); }
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
  if (GRID.ok) {   // сетка: клетка войска; в пути — между клетками маршрута, плавно внутри дня
    const r = a.route;
    if (r && r.c.length > 1) {
      const t = (a.rt || 0) + (UI.speed ? Math.min(1, clockAcc) : 0); let i = Math.max(0, a.ri || 0);
      while (i < r.c.length - 1 && r.d[i + 1] <= t) i++;
      if (i >= r.c.length - 1) { const q = cellXY(r.c[r.c.length - 1]); return [q[0], q[1] - 4]; }
      const p0 = cellXY(r.c[i]), p1 = cellXY(r.c[i + 1]), u = clamp((t - r.d[i]) / Math.max(1e-6, r.d[i + 1] - r.d[i]), 0, 1);
      return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - 4];
    }
    const c = armyCell(a), q = cellXY(c), i = Math.max(0, G.armies.filter(x => !x.route && x.cell === c).indexOf(a));
    return [q[0] + i * 6, q[1] - 4 - i * 24];
  }
  if (a.leg && typeof a.leg.from === 'number') { const q = roadPoint(a.leg.from, a.leg.to, legPos(a)); return [q[0], q[1] - 4]; }
  const k = armyProv(a), i = Math.max(0, G.armies.filter(x => !x.leg && x.prov === k).indexOf(a));
  return [P[k][1] + i * 6, P[k][2] - 4 - i * 24];
}
function moveMarkers() {
  const box = $('armymk'); if (!box) return;
  for (const el of box.children) { const a = G.armies.find(x => x.id === +el.dataset.army); if (!a || !a.route) continue; const [x, y] = armyXY(a); el.style.left = x + 'px'; el.style.top = y + 'px'; }
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
// атлас готовых облаков (mkclouds.py): облако на карте = 2–4 заготовки атласа разного размера («конструктор»)
const CA = { img: null, sh: null, meta: null };
if (!HEADLESS && typeof fetch !== 'undefined' && location.protocol !== 'file:') fetch('clouds.json').then(r => r.ok ? r.json() : null).then(m => {
  if (!m) return; const im = new Image(); im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d');   // тень: тот же атлас, тёмный и размытый
    x.filter = 'blur(6px)'; x.drawImage(im, 0, 0); x.filter = 'none'; x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgb(18,22,38)'; x.fillRect(0, 0, c.width, c.height);
    CA.img = im; CA.sh = c; CA.meta = m;
  }; im.src = 'clouds.png';
}).catch(() => { });
// облака идут вокруг того места, куда смотрит игрок: «область облаков» = видимая часть карты с запасом;
// облако, ушедшее за неё по ветру, снова рождается с наветренной (западной) стороны и плавно проявляется
const WIND = [12, 1.2];   // px карты в секунду
let CSEED = 7; const crnd = () => (CSEED = (CSEED * 16807) % 2147483647) / 2147483647;
// небо одно на всю карту: у каждого облака своя дорожка (через 50 px высоты), скорость и фаза;
// положение зависит только от «часов неба» — экран лишь показывает свой кусок, ничего не пересоздаётся
const LANE = 50, SKY = { list: null, t: 0 };
function skyInit() {
  if (SKY.list || !CA.meta || !MAPINFO) return;
  let s = 1261; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const M = MAPINFO, n = CA.meta.n, lanes = Math.ceil(M.H / LANE), count = Math.round(M.W * M.H / (430 * 430));
  SKY.period = M.W + 1400; SKY.list = [];
  for (let i = 0; i < count; i++) {
    const parts = [], k = 2 + Math.floor(r() * 3), sz = 150 + r() * 130;
    for (let j = 0; j < k; j++) parts.push({ s: Math.floor(r() * n), dx: j ? (r() - 0.5) * sz * 1.2 : 0, dy: j ? (r() - 0.5) * sz * 0.45 : 0, w: sz * (j ? 0.45 + r() * 0.5 : 1), fl: r() < 0.5, fv: r() < 0.3 });
    parts.sort((p, q) => p.dy - q.dy);
    SKY.list.push({ parts, w: sz * 1.9, v: 0.6 + r() * 0.7, lane: (Math.floor(r() * lanes) + 0.5) * LANE + (r() - 0.5) * 20, ph: r() * SKY.period, wob: r() * 6.28 });
  }
}
function cloudFrame(now) {
  requestAnimationFrame(cloudFrame);
  const cv = $('cloudcv'); if (!cv) return;
  const show = CL.on && G && UI.tab === 'map' && !$('app').classList.contains('hidden') && !document.hidden;
  if (!show) { if (cv.width) { cv.width = 0; } CL.last = now; return; }
  if (now - CL.last < 33 || !CA.img) return;   // ~30 кадров/с
  const dt = Math.min(0.2, (now - CL.last) / 1000); CL.last = now;
  skyInit(); SKY.t += dt;
  const wrap = $('mapwrap'), dpr = Math.min(2, window.devicePixelRatio || 1), Wd = wrap.clientWidth, Hd = wrap.clientHeight;
  if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; }
  const x = cv.getContext('2d'), v = UI.view, z = v.z, M = MAPINFO;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
  const zs = z * M.W / 5298, fade = clamp(1.12 - zs * 0.42, 0.08, 1), shf = clamp(1.1 - zs * 0.3, 0.25, 1);
  const vx0 = -v.x / z, vy0 = -v.y / z, vx1 = vx0 + Wd / z, vy1 = vy0 + Hd / z;
  for (const c of SKY.list) { c.x = (c.ph + WIND[0] * c.v * SKY.t) % SKY.period - 700; c.y = c.lane + Math.sin(SKY.t * 0.02 * c.v + c.wob) * 30; }
  CL.list = SKY.list;
  const m = CA.meta, sw = m.w, shh = m.h;
  // параллакс: облака выше земли — при сдвиге карты смещаются чуть сильнее своих теней
  const cxs = Wd / 2, cys = Hd / 2, PAR = 1.1;
  for (const c of CL.list) {
    const born = 1;
    if (c.x + c.w + 120 < vx0 - 200 || c.x - c.w - 120 > vx1 + 200 || c.y + c.w + 160 < vy0 - 200 || c.y - c.w > vy1 + 200) continue;
    for (const pass of [0, 1]) {
      if (pass) x.setTransform(dpr * z * PAR, 0, 0, dpr * z * PAR, dpr * (cxs + (v.x - cxs) * PAR), dpr * (cys + (v.y - cys) * PAR));
      else x.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y);
      for (const p of c.parts) {
        const w = p.w, h = w * shh / sw, sx = (p.s % m.cols) * sw, sy = Math.floor(p.s / m.cols) * shh;
        x.save(); x.translate(c.x + p.dx + (pass ? 0 : 70), c.y + p.dy + (pass ? 0 : 90)); x.scale(p.fl ? -1 : 1, p.fv ? -1 : 1);
        x.globalAlpha = (pass ? 0.95 * fade : 0.17 * shf) * born; x.drawImage(pass ? CA.img : CA.sh, sx, sy, sw, shh, -w / 2, -h / 2, w, h);
        x.restore();
      }
    }
  }
  x.globalAlpha = 1;
}
if (!HEADLESS) requestAnimationFrame(cloudFrame);

/* --- спокойное море: мягкое «дыхание» света, редкие линии зыби, тонкая полоса прибоя ---
   всё рисуется на отдельном холсте и в конце обрезается маской открытого моря (sea.png): реки и озёра не трогаем */
const WV = { on: true, foam: true, pts: null, spr: null, last: 0, t: 0, mask: null, md: null, mw: 0, mh: 0, rip: null };
try { WV.on = localStorage.getItem('poly_waves') !== 'off'; WV.foam = localStorage.getItem('poly_foam') !== 'off'; } catch (e) { }
if (!HEADLESS) { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; WV.md = new Uint8Array(c.width * c.height); for (let k = 0; k < WV.md.length; k++) WV.md[k] = d[k * 4 + 3]; WV.mw = c.width; WV.mh = c.height; WV.mask = im; } catch (e) { } }; im.src = 'sea.png'; }
const seaAt = (x, y) => { const X = Math.round(x / 2), Y = Math.round(y / 2); return X >= 0 && Y >= 0 && X < WV.mw && Y < WV.mh ? WV.md[Y * WV.mw + X] : 0; };
function rippleTile() {   // бесшовная плитка мягких светлых пятен (периодический шум) — «дыхание» света на воде
  const N = 256, G = 8, c = document.createElement('canvas'); c.width = N; c.height = N; const x = c.getContext('2d'), im = x.createImageData(N, N);
  let s = 77; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const oct = [G, G * 2].map(g => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = r(); return [g, a]; });
  const sm = t => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let X = 0; X < N; X++) {
    let v = 0, wsum = 0, w = 1;
    for (const [g, a] of oct) { const fx = X / N * g, fy = y / N * g, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0), q = (i, j) => a[((j % g + g) % g) * g + ((i % g + g) % g)];
      v += w * ((q(x0, y0) * (1 - tx) + q(x0 + 1, y0) * tx) * (1 - ty) + (q(x0, y0 + 1) * (1 - tx) + q(x0 + 1, y0 + 1) * tx) * ty); wsum += w; w *= 0.45; }
    v /= wsum; const al = Math.max(0, (v - 0.5) * 2.2);
    const o = (y * N + X) * 4; im.data[o] = 225; im.data[o + 1] = 240; im.data[o + 2] = 248; im.data[o + 3] = Math.min(255, al * 120);
  }
  x.putImageData(im, 0, 0); return c;
}
function swellSprite(seed) {   // линия зыби: тонкая пологая дуга, светлая, с мягким ореолом
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const W = 160, H = 24, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.lineCap = 'round';
  const bow = 3 + r() * 4, sk = (r() - 0.5) * 6;
  for (const [col, lw] of [['rgba(220,238,246,.25)', 5], ['rgba(236,246,250,.85)', 1.6]]) {
    x.strokeStyle = col; x.lineWidth = lw; x.beginPath(); x.moveTo(14, 14); x.quadraticCurveTo(W / 2 + sk, 14 - bow * 2, W - 14, 14); x.stroke();
  }
  return c;
}
function wavesInit() {
  if (WV.pts || !WV.md || !MAPINFO) return;
  let s = 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = [], step = 95, M = MAPINFO;
  for (let gy = step / 2; gy < M.H; gy += step) for (let gx = step / 2; gx < M.W; gx += step) {
    const x = gx + (r() - 0.5) * step * 0.8, y = gy + (r() - 0.5) * step * 0.8;
    let ok = true; for (const [dx, dy] of [[0, 0], [-26, 0], [26, 0], [0, -16], [0, 16], [-18, -12], [18, 12]]) if (seaAt(x + dx, y + dy) < 250) { ok = false; break; }
    if (ok) pts.push({ x, y, ph: r(), sp: 0.033 + r() * 0.02, f: Math.floor(r() * 6), sz: 0.7 + r() * 0.6, rot: (r() - 0.5) * 0.12, lod: Math.floor(r() * 4) });
  }
  WV.pts = pts;
  WV.spr = { swell: [0, 1, 2, 3, 4, 5].map(i => swellSprite(311 + i * 97)) };
  WV.rip = rippleTile();
}
/* --- прибой (foam.png, половинное разрешение): R — расстояние до берега (у маленьких островов «сжато»), G — шум,
   B — направление от берега в море, A — открытость берега. Волны идут по ветру: наветренный берег получает сильный прибой,
   подветренный — слабый, бухты тише открытых берегов. Обновляется каждый кадр — без рывков. --- */
const FM = { ok: false };
if (!HEADLESS) { const im = new Image(); im.onload = () => { try {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, TS = 32, tw = Math.ceil(W / TS);
  const tiles = new Map(), dist = new Uint8Array(W * H), nz = new Uint8Array(W * H), ang = new Uint8Array(W * H), str = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) { if (!d[k * 4 + 3] || d[k * 4] >= 180) continue; dist[k] = d[k * 4]; nz[k] = d[k * 4 + 1]; ang[k] = d[k * 4 + 2]; str[k] = d[k * 4 + 3]; const t = Math.floor((k % W) / TS) + Math.floor(Math.floor(k / W) / TS) * tw; let a = tiles.get(t); if (!a) tiles.set(t, a = []); a.push(k); }   // дальше 3,5 от берега пены нет — такие пиксели не перебираем
  // поле для плавной интерполяции: суша 0, полоса — расстояние, дальнее море 255; плюс пиксели суши у самой полосы (для гладкой кромки)
  const df = new Uint8Array(W * H), band = new Uint8Array(W * H), sea = WV.md && WV.mw === W ? WV.md : null;
  for (let k = 0; k < W * H; k++) band[k] = d[k * 4 + 3] ? 1 : 0;
  for (let k = 0; k < W * H; k++) df[k] = d[k * 4 + 3] ? d[k * 4] : (sea && sea[k] > 127 ? 255 : 0);
  for (const [t, a] of tiles) tiles.set(t, Int32Array.from(a));
  const ss = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Прибой «как в Героях»: у каждого участка берега (ячейки) — свои удары, в своё время; ничего не бежит вдоль берега.
  // Жизнь одного удара: короткая волна подходит (AP с) → вспышка белой воды на камнях (заходит на контур берега) →
  // пена держится у кромки, чуть расползается в море и тает (BD с). Таблицы [расстояние(256) × время(64)]:
  // WA — подход и вспышка (гладкие), WO — пена (с кружевом); CB — постоянная тонкая пенная кромка.
  const AP = 1.3, BD = 2.6, TT = AP + BD, WA = new Float32Array(256 * 64), WF = new Float32Array(256 * 64), WO = new Float32Array(256 * 64), CB = new Float32Array(256);
  for (let ai = 0; ai < 64; ai++) {
    const tau = (ai + 0.5) / 64 * TT - AP;
    let la = 0, lp = 0, lw = 0.3, fl = 0, fo = 0, front = 0;
    if (tau < 0) { const u = -tau / AP; lp = 0.35 + 2.2 * Math.pow(u, 1.3); lw = 0.28 + 0.25 * u; la = 0.34 * ss(1, 0.6, u) * (0.6 + 0.4 * (1 - u)); }
    else { const t = tau / BD; fl = ss(0, 0.05, tau) * Math.pow(Math.max(0, 1 - tau / 0.6), 1.4); fo = ss(0, 0.1, tau) * Math.pow(1 - t, 1.3); front = 0.35 + 0.9 * (1 - (1 - t) * (1 - t)); }
    for (let di = 0; di < 256; di++) {
      const dd = di / 40 - 1, onRock = ss(-0.85, -0.4, dd);   // заходит на нарисованный контур берега, но не дальше
      WA[di * 64 + ai] = la * Math.exp(-Math.pow((dd - lp) / lw, 2)) * ss(-0.1, 0.35, dd);
      WF[di * 64 + ai] = 0.95 * fl * onRock * (1 - ss(0.2, 0.8, dd));
      WO[di * 64 + ai] = 0.85 * fo * onRock * (1 - ss(front - 0.25, front + 0.35, dd)) * (1 - 0.3 * ss(0, 1.2, dd));
    }
  }
  for (let di = 0; di < 256; di++) { const dd = di / 40 - 1; CB[di] = Math.exp(-Math.pow((dd - 0.05) / 0.42, 2)) * ss(-0.85, -0.45, dd); }
  // ячейки берега по CS пикселей foam.png: у каждой — смещённый центр, свой период ударов и фаза
  const CS = 6, CW = Math.ceil(W / CS) + 2, CH = Math.ceil(H / CS) + 2, NC = CW * CH;
  const cox = new Float32Array(NC), coy = new Float32Array(NC), cper = new Float32Array(NC), cph = new Float32Array(NC);
  { let q = 31337; const r = () => (q = (q * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < NC; i++) { cox[i] = 0.15 + 0.7 * r(); coy[i] = 0.15 + 0.7 * r(); cper[i] = 5 + 3.5 * r(); cph[i] = r(); } }
  // LN — мелкий «кружевной» шум пены, бесшовный 256×256
  const pnoise = (gs, seed) => { let q = seed; const r = () => (q = (q * 16807) % 2147483647) / 2147483647, o = new Float32Array(65536);
    for (const [g, w] of gs) { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = r(); const cs = 256 / g;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const fx = x / cs, fy = y / cs, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = ss(0, 1, fx - x0), ty = ss(0, 1, fy - y0), Q = (i, j) => a[(j % g) * g + (i % g)];
        o[y * 256 + x] += w * ((Q(x0, y0) * (1 - tx) + Q(x0 + 1, y0) * tx) * (1 - ty) + (Q(x0, y0 + 1) * (1 - tx) + Q(x0 + 1, y0 + 1) * tx) * ty); } }
    let mn = 1e9, mx = -1e9; for (const v of o) { mn = Math.min(mn, v); mx = Math.max(mx, v); } for (let i = 0; i < o.length; i++) o[i] = (o[i] - mn) / (mx - mn); return o; };
  const LN = pnoise([[64, 0.6], [128, 1]], 4243);
  Object.assign(FM, { ok: true, W, H, TS, tw, tiles, dist, df, band, nz, ang, str, sea, SA: new Float32Array(256), cv: document.createElement('canvas'), WA, WF, WO, CB, AP, BD, TT, CS, CW, CH, cox, coy, cper, cph, LN, CA: new Int16Array(NC), CHH: new Float32Array(NC) });
} catch (e) { } }; FM.im = im; }
function foamLoad() { if (!FM.started && WV.md) { FM.started = true; FM.im.src = 'foam.png'; } }
function foamUpdate(vx0, vy0, vx1, vy1, T, K) {
  const hx = Math.max(0, Math.floor(vx0 / 2) - 2), hy = Math.max(0, Math.floor(vy0 / 2) - 2), hx1 = Math.min(FM.W - 1, Math.ceil(vx1 / 2) + 2), hy1 = Math.min(FM.H - 1, Math.ceil(vy1 / 2) + 2);
  const w = hx1 - hx, h = hy1 - hy; if (w <= 0 || h <= 0) return;
  const cv = FM.cv, CWk = w * K, CHk = h * K; if (cv.width !== CWk || cv.height !== CHk) { cv.width = CWk; cv.height = CHk; FM.img = null; }
  const cx = cv.getContext('2d'); if (!FM.img) FM.img = cx.createImageData(CWk, CHk);
  const out = FM.img.data, key = hx + ',' + hy + ',' + K; if (FM.key !== key) { out.fill(0); FM.key = key; } FM.hx = hx; FM.hy = hy; FM.K = K;
  // ветер (как у облаков, направление медленно гуляет ±25°): наветренные берега бьёт чаще и сильнее; общий «прилив» — сила то больше, то меньше
  const th = Math.atan2(WIND[1], WIND[0]) + 0.45 * Math.sin(T / 190);
  const tide = 0.82 + 0.18 * Math.sin(T * 2 * Math.PI / 80);
  const SA = FM.SA; for (let b = 0; b < 256; b++) { const a = b / 255 * 2 * Math.PI, f = (1 - Math.cos(a - th)) / 2; SA[b] = (0.2 + 0.8 * Math.pow(f, 1.6)) * tide; }
  const W = FM.W, TS = FM.TS, DF = FM.df, NZ = FM.nz, AN = FM.ang, ST = FM.str, KK = FM.KK || (FM.KK = new Float32Array(FM.W * FM.H));
  const WA = FM.WA, WF = FM.WF, WO = FM.WO, CB = FM.CB, AP = FM.AP, BD = FM.BD, TT = FM.TT, CS = FM.CS, CW = FM.CW, CH = FM.CH, COX = FM.cox, COY = FM.coy, CPER = FM.cper, CPH = FM.cph, LN = FM.LN;
  const zs = UI.view.z * MAPINFO.W / 5298, rimA = 0.32 * clamp((zs - 0.35) / 1.0, 0.25, 1) * tide;   // постоянная кромка; издали — слабее
  const ih = (x, y, s) => { let q = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0; q = Math.imul(q ^ (q >>> 13), 1103515245); q ^= q >>> 16; return (q >>> 0) / 4294967296; };
  // удар ячейки (ci, cj) в точке (gx, gy) — в единицах ячеек; R2 = 1/радиус²
  // ячейки берега: состояние удара считается лениво, один раз за кадр и только для ячеек у видимого берега.
  // CA — момент жизни удара (0..63) или −1 (тихо), CHH — случайность этого цикла (бьёт ли в этот раз и насколько сильно)
  const CA = FM.CA, CHH = FM.CHH, CF = FM.CF || (FM.CF = new Int32Array(CA.length)), fid = FM.fid = (FM.fid | 0) + 1;
  const TTAB = FM.TTAB || (FM.TTAB = Float32Array.from({ length: 64 }, (_, i) => Math.max(0, ((i + 0.5) / 64 * TT - AP) / BD)));
  const RR = 0.65, R2 = 1 / (RR * RR), RM2 = (RR + 0.12) * (RR + 0.12);   // радиус удара — 0,65 ячейки
  const AX = FM.AX || (FM.AX = new Float32Array(9)), AY = FM.AY || (FM.AY = new Float32Array(9)), AG = FM.AG || (FM.AG = new Float32Array(9)), AA = FM.AA || (FM.AA = new Int16Array(9));
  // активные удары рядом с базовым пикселем (3×3 ячейки) → AX/AY центр, AG сила, AA момент; возвращает их число
  const gather = (X, Y, mb, one) => {   // one — издали: только своя ячейка
    const gx = X / CS, gy = Y / CS, ci0 = Math.floor(gx), cj0 = Math.floor(gy), e = one ? 0 : 1; let na = 0;
    for (let cj = cj0 - e; cj <= cj0 + e; cj++) for (let ci = ci0 - e; ci <= ci0 + e; ci++) {
      if (ci < 0 || cj < 0 || ci >= CW || cj >= CH) continue; const c = cj * CW + ci;
      const ex = gx - ci - COX[c], ey = gy - cj - COY[c]; if (ex * ex + ey * ey > RM2) continue;
      if (CF[c] !== fid) { CF[c] = fid; const per = CPER[c], ph = T / per + CPH[c], cyc = Math.floor(ph), tau = (ph - cyc) * per - AP;
        if (tau >= BD) CA[c] = -1; else { CA[c] = Math.min(63, ((tau + AP) / TT * 64) | 0); CHH[c] = ih(ci, cj, cyc); } }
      if (CA[c] < 0 || CHH[c] > 0.42 + 0.53 * mb) continue;   // в этот раз — бьёт или нет (наветренный берег — чаще)
      AX[na] = ci + COX[c]; AY[na] = cj + COY[c]; AG[na] = 0.65 + 0.7 * ((CHH[c] * 7.31) % 1); AA[na] = CA[c]; na++;
    }
    return na;
  };
  const hits = (na, gx, gy, di, m, lace) => {
    let v = 0;
    for (let n = 0; n < na; n++) {
      const ex = gx - AX[n], ey = gy - AY[n], r2 = (ex * ex + ey * ey) * R2; if (r2 >= 1) continue;
      const ai = AA[n], bi = di * 64 + ai;
      v += (1 - r2) * (1 - r2) * AG[n] * (0.5 + 0.5 * m) * (WA[bi] + WF[bi] * (1 - 0.4 * (1 - lace)) + WO[bi] * (1 - (0.45 + 0.5 * TTAB[ai]) * (1 - lace)));
    }
    return v;
  };
  if (K > 1)   // сила прибоя по пикселям — для плавной интерполяции между соседями
    for (let ty = Math.floor(hy / TS); ty <= Math.floor((hy1 - 1) / TS); ty++) for (let tx = Math.floor(hx / TS); tx <= Math.floor((hx1 - 1) / TS); tx++) {
      const a = FM.tiles.get(tx + ty * FM.tw); if (!a) continue;
      for (let q = 0; q < a.length; q++) { const k = a[q]; KK[k] = SA[AN[k]] * (0.45 + 0.0022 * ST[k]) * (0.72 + 0.0022 * NZ[k]); }
    }
  const farHits = zs >= 0.8;   // вся карта на экране — удары размером в пару пикселей, не считаем
  const L1 = T * 0.8, L2 = T * 0.6;   // кружево пены медленно «кипит»: два слоя шума плывут в разные стороны
  for (let ty = Math.floor(hy / TS); ty <= Math.floor((hy1 - 1) / TS); ty++) for (let tx = Math.floor(hx / TS); tx <= Math.floor((hx1 - 1) / TS); tx++) {
    const a = FM.tiles.get(tx + ty * FM.tw); if (!a) continue;
    for (let q = 0; q < a.length; q++) {
      const k = a[q], X = k % W, Y = (k - X) / W; if (X < hx || X >= hx1 || Y < hy || Y >= hy1) continue;
      const kb = SA[AN[k]] * (0.45 + 0.0022 * ST[k]) * (0.72 + 0.0022 * NZ[k]), mb = kb > 1 ? 1 : kb, na = K > 1 ? gather(X, Y, mb, false) : farHits ? gather(X, Y, mb, true) : 0;
      if (K === 1) {   // издали: без кружева
        const di = DF[k]; let v = 0;
        if (di < 170) v = CB[di] * rimA * (0.45 + 0.55 * mb) * 0.75 + (na ? hits(na, X / CS, Y / CS, di, mb, 0.6) : 0);
        const o = ((Y - hy) * w + (X - hx)) * 4; out[o] = 240; out[o + 1] = 248; out[o + 2] = 252; out[o + 3] = v > 1 ? 255 : v * 255; continue;
      }
      // вблизи — K×K подпикселей: расстояние до берега и сила прибоя плавно интерполируются → гладкие кромки
      for (let sy = 0; sy < K; sy++) for (let sx = 0; sx < K; sx++) {
        const fx = X + (sx + 0.5) / K - 0.5, fy = Y + (sy + 0.5) / K - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, i0 = y0 * W + x0;
        const dd = (DF[i0] * (1 - ax) + DF[i0 + 1] * ax) * (1 - ay) + (DF[i0 + W] * (1 - ax) + DF[i0 + W + 1] * ax) * ay;
        let v = 0;
        if (dd < 170) {
          const ki = (KK[i0] * (1 - ax) + KK[i0 + 1] * ax) * (1 - ay) + (KK[i0 + W] * (1 - ax) + KK[i0 + W + 1] * ax) * ay, m = ki > 1 ? 1 : ki, di = dd | 0;
          const lc = 0.5 * (LN[(((fy * 4) | 0) & 255) * 256 + (((fx * 4 + L1) | 0) & 255)] + LN[(((fy * 4 - L2) | 0) & 255) * 256 + (((fx * 4) | 0) & 255)]);
          const lace = lc < 0.3 ? 0 : lc > 0.7 ? 1 : (lc - 0.3) / 0.4;
          v = CB[di] * rimA * (0.45 + 0.55 * m) * (0.4 + 0.6 * lace) + (na ? hits(na, fx / CS, fy / CS, di, m, lace) : 0);
        }
        const o = (((Y - hy) * K + sy) * CWk + (X - hx) * K + sx) * 4; out[o] = 240; out[o + 1] = 248; out[o + 2] = 252; out[o + 3] = v > 1 ? 255 : v * 255;
      }
    }
  }
  cx.putImageData(FM.img, 0, 0);
}
/* --- живая поверхность моря (WebGL, видеокарта): пологая зыбь со светотенью бежит по ветру + сетка солнечных бликов,
   яркая на мелководье у берегов. Маска моря — sea.png; без WebGL остаётся прежнее «дыхание» света и линии зыби --- */
const SGL = { ok: false, tried: false };
function seaGLInit() {
  if (SGL.tried || !WV.mask) return; SGL.tried = true;
  try {
    const cv = document.createElement('canvas'); cv.id = 'seagl'; cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1';
    $('mapwrap').insertBefore(cv, $('wavecv'));
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false }); if (!gl) return;
    const FS = `precision highp float;
uniform vec2 uRes; uniform vec4 uView; uniform vec2 uMap; uniform float uT; uniform vec2 uWind; uniform sampler2D uSea, uSeaB;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main(){
  vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uView.w, mp = (sp - uView.xy) / uView.z;
  float sea = texture2D(uSea, mp / uMap).a; if (sea < 0.01) { gl_FragColor = vec4(0.0); return; }
  float shallow = clamp(1.0 - texture2D(uSeaB, mp / uMap).a, 0.0, 1.0), z = uView.z, T = uT;
  vec3 L = normalize(vec3(-0.55, -0.6, 0.6));
  // зыбь: 10 пологих волн разной длины, почти по ветру (две — встречная старая зыбь); мелкие на экране гасим — без муара
  vec2 g = vec2(0.0); float base = atan(uWind.y, uWind.x);
  for (int i = 0; i < 10; i++) {
    float fi = float(i), lam = 10.0 + 4.5 * fi + 4.0 * hash(vec2(fi, 3.0));
    float ang = base + (hash(vec2(fi, 7.0)) - 0.5) * 1.8 + (i > 7 ? 1.25 : 0.0);
    vec2 d = vec2(cos(ang), sin(ang)); float k = 6.2832 / lam;
    g += 0.085 * smoothstep(6.0, 14.0, lam * z) * (0.6 + 0.4 * hash(vec2(fi, 11.0))) * cos(dot(d, mp) * k - sqrt(3.3 * k) * T + 6.2832 * hash(vec2(fi, 5.0))) * d;
  }
  g *= 0.25 + 1.2 * smoothstep(0.3, 0.7, fbm(mp / 85.0 + uWind * T * 0.025));   // группы волн: где-то зыбь, где-то гладь
  float sw = (dot(normalize(vec3(-g, 1.0)), L) - L.z) * 3.0 * smoothstep(0.45, 1.1, z);   // издали зыбь гаснет — без полосатого муара
  // блики (каустика): у берегов ярче, в открытом море едва видны
  vec2 p = mod(mp / 34.0 * 6.2832, 6.2832) - 250.0, q = p; float c = 1.0;
  for (int n = 0; n < 4; n++) { float t = T * 0.22 * (1.0 - (3.5 / float(n + 1))); q = p + vec2(cos(t - q.x) + sin(t + q.y), sin(t - q.y) + cos(t + q.x));
    c += 1.0 / length(vec2(p.x / (sin(q.x + t) / 0.005), p.y / (cos(q.y + t) / 0.005))); }
  c = 1.17 - pow(c / 4.0, 1.4);
  float ca = clamp(pow(abs(c), 8.0), 0.0, 1.0) * (0.08 + smoothstep(0.05, 0.45, shallow)) * smoothstep(2.5, 6.0, z * 34.0 / 6.0);
  float Li = clamp(max(sw, 0.0) * 0.24 + ca * 0.5, 0.0, 0.7) * sea, Dk = min(1.0, max(-sw, 0.0)) * 0.2 * sea;
  gl_FragColor = vec4(vec3(0.90, 0.96, 0.99) * Li + vec3(0.02, 0.10, 0.20) * Dk * (1.0 - Li), Li + Dk * (1.0 - Li));
}`;
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }')); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link'); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ap = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    const tex = (src, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
    tex(WV.mask, 0);
    const bc = document.createElement('canvas'); bc.width = WV.mask.width; bc.height = WV.mask.height; const bx = bc.getContext('2d'); bx.filter = 'blur(7px)'; bx.drawImage(WV.mask, 0, 0); tex(bc, 1);
    const U = {}; for (const n of ['uRes', 'uView', 'uMap', 'uT', 'uWind', 'uSea', 'uSeaB']) U[n] = gl.getUniformLocation(pr, n);
    gl.uniform1i(U.uSea, 0); gl.uniform1i(U.uSeaB, 1);
    Object.assign(SGL, { ok: true, cv, gl, U });
  } catch (e) { SGL.ok = false; }
}
function seaGLDraw(T, dpr, Wd, Hd, show) {
  if (!SGL.ok) return false; const cv = SGL.cv, gl = SGL.gl, U = SGL.U;
  if (!show) { if (cv.width) cv.width = 0; return true; }
  const W = Math.round(Wd * dpr), H = Math.round(Hd * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; }
  const v = UI.view, wl = Math.hypot(WIND[0], WIND[1]);
  gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.uRes, W, H); gl.uniform4f(U.uView, v.x, v.y, v.z, dpr); gl.uniform2f(U.uMap, MAPINFO.W, MAPINFO.H);
  gl.uniform1f(U.uT, T); gl.uniform2f(U.uWind, WIND[0] / wl, WIND[1] / wl);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return true;
}
/* --- вулканы (ближний уровень): Этна по датам (спокойна → активна → извержение 1329 г.: лава проявляется и гаснет плавно, свечение
   пульсирует, лёгкий дым всегда), Стромболи — дым и слабое свечение кратера, Вулкано — белый пар, Везувий спит.
   Искья (без спрайта): землетрясения 1301 г., извержение 18 января — март 1302 г. (дым), затем тёмный лавовый язык на северо-востоке.
   Игровых последствий нет: только хук VOLC.hook(вид, данные) для будущих событий. --- */
const VOLC = {
  etnaActive: [[1284, 1286], [1321, 1329], [1333, 1335], [1350, 1351]],   // годы «активна» (конец — не включая)
  etnaErupt: [1329 + 178 / 365, 1329 + 216 / 365],                         // 28 июня — 4 августа 1329
  ischiaQuake: [1301, 1302], ischiaErupt: [1302 + 17 / 365, 1302 + 90 / 365],
  hook(kind, data) { /* сюда автор подключит игровые последствия: kind — 'ischia_quakes' | 'ischia_eruption' | 'ischia_lava_sea' | 'etna_eruption' */ },
  fired: {},
};
function gameYear() {   // дробный год по игровой дате
  if (!G) return 1261; const s = G.season, y = G.year, sm = [2, 5, 8, 11][s];
  const st = Date.UTC(y, sm, 1), en = Date.UTC(s === 3 ? y + 1 : y, (sm + 3) % 12, 1), t = st + Math.min(SEASON_DAYS, G.day || 0) / SEASON_DAYS * (en - st);
  return y + (t - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
}
function etnaLevels(Y) {   // доли «активна» и «извержение» (0..1) с плавными переходами
  const ramp = (a, b, f) => Y < a - f || Y > b + f ? 0 : Y < a ? (Y - a + f) / f : Y > b ? 1 - (Y - b) / f : 1;
  let act = 0; for (const [a, b] of VOLC.etnaActive) act = Math.max(act, ramp(a, b, 0.12));
  const [e0, e1] = VOLC.etnaErupt, er = Y < e0 - 0.02 ? 0 : Y < e0 ? (Y - e0 + 0.02) / 0.02 : Y <= e1 ? 1 : Math.max(0, 1 - (Y - e1) / 0.35);   // затухание за ~4 месяца
  return [Math.max(act, er * 0.7), er];
}
// события-предвестники и извержения: раз в игру, через журнал (хук — для будущих последствий)
function volcEvents() {
  if (!G) return; const Y = gameYear(), f = VOLC.fired = G.volc || (G.volc = {});
  const once = (k, cond, text, imp) => { if (cond && !f[k]) { f[k] = 1; log(text, imp ? 'imp' : undefined); VOLC.hook(k, { year: Y }); } };
  once('ischia_quakes', Y >= 1301.2 && Y < 1302, 'Искья: на острове одно за другим трясётся земля — рыбаки говорят, что гора проснётся.');
  once('ischia_eruption', Y >= VOLC.ischiaErupt[0] && Y < VOLC.ischiaErupt[1], 'Искья: из склона горы вырвался огонь, над островом стоит чёрный дым.', true);
  once('ischia_lava_sea', Y >= VOLC.ischiaErupt[0] + 0.05 && Y < VOLC.ischiaErupt[1] + 0.2, 'Искья: лава дошла до моря, жители бегут с острова на лодках.', true);
  once('etna_eruption', Y >= VOLC.etnaErupt[0] && Y < VOLC.etnaErupt[1], 'Сицилия: Этна извергается — потоки лавы спускаются к Катании.', true);
}
const VCV = { last: 0, t: 0 };
function volcFrame(now) {
  requestAnimationFrame(volcFrame);
  let cv = $('volccv');
  if (!cv) { const w = $('mapwrap'); if (!w) return; cv = document.createElement('canvas'); cv.id = 'volccv'; cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1'; w.insertBefore(cv, $('cloudcv')); }
  const v = UI.view, dpr = Math.min(2, window.devicePixelRatio || 1), zd = v.z * dpr;
  const show = TSP.st === 2 && G && UI.tab === 'map' && (UI.mapMode === 'geo' ? v.z > GEO_T0 : zd >= 1.8) && !document.hidden && !$('app').classList.contains('hidden');
  if (now - VCV.last > 1000) volcEvents();
  if (!show) { if (cv.width) cv.width = 0; VCV.last = now; return; }
  if (now - VCV.last < 40) return; VCV.t += Math.min(0.2, (now - VCV.last) / 1000); VCV.last = now;
  const wrap = $('mapwrap'), Wd = wrap.clientWidth, Hd = wrap.clientHeight;
  if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; }
  const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
  const tt = clamp((zd - 1.8) / 1.6, 0, 1), vis = UI.mapMode === 'geo' ? geoU(v.z) : tt * tt * (3 - 2 * tt), T = VCV.t, Y = gameYear();
  x.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
  const vx0 = -v.x / v.z, vy0 = -v.y / v.z, vx1 = vx0 + Wd / v.z, vy1 = vy0 + Hd / v.z;
  const A = TSP.atlas, S = TSP.sets, wl = Math.hypot(WIND[0], WIND[1]), wx = WIND[0] / wl, wy = WIND[1] / wl;
  // дым: клубы из атласа облаков поднимаются из точки и сносятся ветром
  const smoke = (cx, cy, size, amt, dark, n = 7) => {
    if (!CA.img || amt <= 0) return; const m = CA.meta, src = dark ? CA.sh : CA.img;
    for (let i = 0; i < n; i++) {
      const ph = (T * 0.07 + i / n) % 1, L = size * 3.2, s = size * (0.35 + 0.9 * ph), k = i % m.n;
      const px = cx + wx * ph * L + Math.sin(T * 0.3 + i) * size * 0.15, py = cy - ph * L * 0.55 + wy * ph * L;
      x.globalAlpha = amt * vis * Math.sin(Math.PI * ph) * (dark ? 0.55 : 0.6);
      x.drawImage(src, (k % m.cols) * m.w, Math.floor(k / m.cols) * m.h, m.w, m.h, px - s, py - s * 0.6, s * 2, s * 1.2);
    }
    x.globalAlpha = 1;
  };
  const glow = (cx, cy, r, a) => { if (a <= 0) return; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(255,170,60,${a * vis})`); g.addColorStop(0.4, `rgba(255,90,20,${a * vis * 0.5})`); g.addColorStop(1, 'rgba(255,60,0,0)'); x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.globalCompositeOperation = 'source-over'; };
  for (const l of TSP.lms) {
    const r = l.r, h = l.w * r[3] / r[2], top = l.y - h * l.an, cx = l.x, cy = top + h * 0.1;
    if (l.x + l.w < vx0 || l.x - l.w > vx1 || l.y + h < vy0 || top - h * 2 > vy1) continue;
    if (l.set === 'lm_etna') {
      const [act, er] = etnaLevels(Y), pulse = 0.8 + 0.2 * Math.sin(T * 2.3);
      for (const [nm, a] of [['lm_etna_active', act * (1 - er)], ['lm_etna_erupt', er]]) if (a > 0.01) { const q = S[nm].r[0], hh = l.w * q[3] / q[2]; x.globalAlpha = a * vis; x.drawImage(A, q[0], q[1], q[2], q[3], l.x - l.w / 2, l.y - hh * l.an, l.w, hh); }
      x.globalAlpha = 1; glow(cx, cy, l.w * (0.12 + 0.18 * er), (0.25 * act + 0.6 * er) * pulse);
      smoke(cx, cy, l.w * (0.14 + 0.12 * act + 0.2 * er), 0.35 + 0.35 * act + 0.3 * er, er > 0.2, 7 + Math.round(5 * er));
    } else if (l.set === 'lm_stromboli') { glow(cx, cy, l.w * 0.25, 0.25 * (0.75 + 0.25 * Math.sin(T * 3.1))); smoke(cx, cy, l.w * 0.3, 0.45, false, 5); }
    else if (l.set === 'lm_vulcano') smoke(cx, cy + h * 0.05, l.w * 0.28, 0.35, false, 4);
  }
  // Искья: дым во время извержения, после — тёмный лавовый язык на северо-востоке острова
  if (TSP.ischia) {
    const [ix, iy] = TSP.ischia;
    if (ix > vx0 - 60 && ix < vx1 + 60 && iy > vy0 - 60 && iy < vy1 + 60) {
      if (Y >= VOLC.ischiaErupt[0]) { x.globalAlpha = 0.55 * vis; x.fillStyle = '#2b2522'; x.beginPath(); x.ellipse(ix + 2.2, iy - 1.4, 2.6, 0.9, -0.6, 0, 2 * Math.PI); x.fill(); x.globalAlpha = 1; }
      if (Y >= VOLC.ischiaErupt[0] && Y < VOLC.ischiaErupt[1] + 0.05) { smoke(ix + 1, iy - 2, 6, 0.8, true, 8); glow(ix + 1.5, iy - 1, 4, 0.4 * (0.8 + 0.2 * Math.sin(T * 2))); }
    }
  }
}
if (!HEADLESS) requestAnimationFrame(volcFrame);
function waveFrame(now) {
  requestAnimationFrame(waveFrame);
  const cv = $('wavecv'); if (!cv) return;
  const show = (WV.on || WV.foam) && G && UI.tab === 'map' && !$('app').classList.contains('hidden') && !document.hidden;
  if (!show) { if (cv.width) cv.width = 0; WV.last = now; seaGLDraw(0, 1, 0, 0, false); return; }
  if (now - WV.last < 33) return;
  const dt = Math.min(0.2, (now - WV.last) / 1000); WV.last = now; WV.t += dt;
  wavesInit(); if (!WV.pts) return;
  const wrap = $('mapwrap'), dpr = Math.min(2, window.devicePixelRatio || 1), Wd = wrap.clientWidth, Hd = wrap.clientHeight;
  const CW = Math.round(Wd * dpr), CH = Math.round(Hd * dpr);
  if (cv.width !== CW || cv.height !== CH) { cv.width = CW; cv.height = CH; cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; }
  const x = cv.getContext('2d'), v = UI.view, z = v.z, T = WV.t, M = MAPINFO;
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, CW, CH);
  const zs = z * M.W / 5298;
  const vx0 = -v.x / z, vy0 = -v.y / z, vx1 = vx0 + Wd / z, vy1 = vy0 + Hd / z;
  // живая поверхность моря на видеокарте; если получилось — прежние «дыхание света» и линии зыби не нужны
  if (WV.on) seaGLInit();
  const gl = WV.on && seaGLDraw(T, dpr, Wd, Hd, true); if (!WV.on && SGL.ok) seaGLDraw(0, 1, 0, 0, false);
  // медленный слой (мягкий свет + маска моря) — в отдельный холст ~8 раз в секунду; между обновлениями только сдвигается вместе с картой
  if (!WV.slow) WV.slow = document.createElement('canvas');
  const SL = WV.slow;
  if (SL.width !== CW || SL.height !== CH) { SL.width = CW; SL.height = CH; WV.st = 0; }
  const moving = performance.now() - (UI.lastMove || 0) < 150;
  if (now - (WV.st || 0) > (moving ? 260 : zs < 0.8 ? 220 : 120)) {
    WV.st = now; WV.sv = { x: v.x, y: v.y, z };
    const x = SL.getContext('2d'), mapT = () => x.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, CW, CH);
    if (WV.on && !gl) {
    // 1) «дыхание» света: два слоя крупных мягких пятен медленно плывут в разные стороны
      const ra = clamp(0.35 + zs * 0.12, 0.35, 0.6);
      if (ra > 0.01) {
        const pat = x.createPattern(WV.rip, 'repeat');
        for (const [sx, sy, sc, a] of [[2.2, 0.6, 2.4, 0.7], [-1.4, 1.5, 1.7, 0.5]]) {
          mapT(); x.translate((T * sx) % (256 * sc), (T * sy) % (256 * sc)); x.scale(sc, sc);
          x.globalAlpha = ra * a; x.fillStyle = pat; const m = 256; x.fillRect((vx0 - T * sx) / sc - m, (vy0 - T * sy) / sc - m, (vx1 - vx0) / sc + 2 * m, (vy1 - vy0) / sc + 2 * m);
        }
        x.globalAlpha = 1;
      }
    }
  // маска открытого моря: всё, что вне моря (суша, реки, озёра), стираем
  if (WV.mask) { x.globalCompositeOperation = 'destination-in'; x.globalAlpha = 1; mapT(); x.imageSmoothingEnabled = true; x.drawImage(WV.mask, 0, 0, M.W, M.H); x.globalCompositeOperation = 'source-over'; }
  }
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, CW, CH);
  if (WV.sv) { const s = WV.sv, kz = z / s.z; x.imageSmoothingEnabled = true; x.drawImage(SL, dpr * (v.x - s.x * kz), dpr * (v.y - s.y * kz), CW * kz, CH * kz); }
  // 3) прибой — каждый кадр (плавно)
  if (WV.foam) foamLoad();
  if (WV.foam && FM.ok && zs > 0.4) {
    WV.fc = (WV.fc || 0) + 1;
    const K = z * dpr > 3.2 ? 3 : z * dpr > 1.7 ? 2 : 1;   // вблизи пена считается в 2–3 раза подробнее — гладкие кромки
    const key = Math.max(0, Math.floor(vx0 / 2) - 2) + ',' + Math.max(0, Math.floor(vy0 / 2) - 2) + ',' + K;
    if (zs >= 0.8 || WV.fc % 2 === 0 || FM.key !== key) foamUpdate(vx0, vy0, vx1, vy1, T, K);   // вдали — через кадр
    if (FM.cv && FM.cv.width) {
      x.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.x, dpr * v.y); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'low';
      x.drawImage(FM.cv, FM.hx * 2, FM.hy * 2, FM.cv.width * 2 / FM.K, FM.cv.height * 2 / FM.K);
      x.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  if (WV.on && !gl) {
    // 2) зыбь: редкие тонкие линии медленно проявляются, плывут по ветру и тают (цикл 20–30 с)
    x.setTransform(1, 0, 0, 1, 0, 0);
    const lod = zs < 0.4 ? 1 : zs < 0.7 ? 2 : 4, a0 = clamp(0.3 + zs * 0.12, 0.3, 0.55);
    for (const p of WV.pts) {
      if (p.lod >= lod) continue;
      const ph = (T * p.sp + p.ph) % 1, px = p.x + (ph * 22 - 11), py = p.y + (ph * 22 - 11) * WIND[1] / WIND[0];
      if (px < vx0 - 80 || px > vx1 + 80 || py < vy0 - 30 || py > vy1 + 30) continue;
      const a = Math.sin(Math.PI * ph); if (a < 0.05) continue;
      const w = clamp(62 * p.sz * z, 34, 170) * dpr, h = w * 24 / 160;
      x.save(); x.translate(dpr * (v.x + px * z), dpr * (v.y + py * z)); x.rotate(p.rot);
      x.globalAlpha = a * a * a0; x.drawImage(WV.spr.swell[p.f], -w / 2, -h / 2, w, h); x.restore();
    }
    x.globalAlpha = 1;
  }
}
if (!HEADLESS) requestAnimationFrame(waveFrame);

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
  else if (GRID.ok && G.armies.some(a => a.route)) moveMarkers();   // плавное движение войск между днями
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
  <div class="btnrow">${a.path.length ? `<button id="bStop">${a.leg && !a.leg.back && !GRID.ok ? 'Повернуть назад' : 'Стоять'}</button>` : ''}
  ${atWar('byz', R(a.region).owner) && !a.stormed && nearCity(a, a.region) ? `<button class="main" id="bStorm">⚔ Штурмовать (${RNAME[a.region]})</button>` : ''}
  ${myArmies().filter(x => armiesTogether(a, x)).map(x => `<button data-merge="${x.id}" title="Всё войско «${esc(x.name)}» — сюда">Влить «${esc(x.name)}»</button><button data-xfer="${x.id}" title="Выбранные отряды (или перетащенный) — в «${esc(x.name)}»">Отряды → «${esc(x.name)}»</button>`).join('')}
  ${!a.leg && a.units.length > 1 ? '<button id="bSplit" title="Выбранные отряды — в новое войско здесь же">Отделить выбранные</button>' : ''}
  <button id="bBack">Готово</button></div>`;
  if (atWar('byz', R(a.region).owner) && !nearCity(a, a.region)) h += `<p class="small">Осада и штурм — только у города: подведите войско к центру области «${esc(RNAME[a.region])}».</p>`;
  else if (atWar('byz', R(a.region).owner)) h += `<p class="small">Идёт осада: ${a.siege} из ${siegeTurns(R(a.region))} сезонов. Гарнизон ${fmt(R(a.region).garrison)}, укрепления ${R(a.region).fort}.</p>`;
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
   <button id="mSave">Сохранить</button><button id="mLoad">Загрузить сохранение</button>
   <button id="mGfx">Графика ▸</button>
   <button id="mAuto">${G.autoBattle ? 'Бои: автоматически (включить ручные)' : 'Бои: вручную (включить автоматические)'}</button>
   <button id="mAP">${UI.autoPause ? 'Пауза при важных событиях: включена' : 'Пауза при важных событиях: выключена'}</button>
   <button id="mSnd">${SFX.on ? 'Звуки: включены (выключить)' : 'Звуки: выключены (включить)'}</button>
   <button id="mSea">${SEASND.on ? 'Звуки природы (море, чайки, ветер в горах, птицы): включены' : 'Звуки природы (море, чайки, ветер в горах, птицы): выключены'}</button>
   <button id="mNames">Скачать мои названия (файл)</button>
   <button id="mHelp">Как играть</button><button id="mNew">Новая игра</button><button id="mClose" class="main">Закрыть</button></div>`);
  $('mSave').onclick = () => { save(); toast('Сохранено.'); closeModal(); };
  $('mLoad').onclick = () => { if (load()) { closeModal(); renderAll(); toast('Загружено.'); } else toast('Сохранения нет.'); };
  $('mGfx').onclick = showGfxMenu;
  $('mAuto').onclick = () => { G.autoBattle = !G.autoBattle; closeModal(); renderAll(); };
  $('mSnd').onclick = () => { SFX.toggle(); showMenu(); };
  $('mSea').onclick = () => { SEASND.toggle(); showMenu(); };
  $('mNames').onclick = exportNames;
  $('mAP').onclick = () => { UI.autoPause = !UI.autoPause; try { localStorage.setItem('poly_autopause', UI.autoPause ? 'on' : 'off'); } catch (e) { } showMenu(); };
  $('mHelp').onclick = showHelp;
  $('mNew').onclick = () => { if (confirm('Начать новую игру? Текущая партия будет потеряна.')) { closeModal(); startNew(); } };
  $('mClose').onclick = closeModal;
}
// все настройки внешнего вида — в одном окне
function showGfxMenu() {
  const onoff = v => v ? 'включены' : 'выключены';
  modal(`<h2>Графика</h2><div class="btnrow" style="flex-direction:column">
   <button id="gStyle">Стиль карты: ${STYLENAMES[MAPSTYLE] || MAPSTYLE} (сменить — страница перезагрузится, игра сохранится)</button>
   <button id="gRidge">${UI.ridgeA === 85 ? 'Горы на политической карте: видны сквозь цвет державы (скрыть)' : 'Горы на политической карте: скрыты под цветом державы (показать)'}</button>
   <button id="gSB">Граница держав: ${{ black: 'чёрная', red: 'красная', none: 'нет' }[UI.sborder]} (сменить)</button>
   <button id="gPC">Перевалы: ${{ black: 'чёрные', red: 'красные', brown: 'коричневые' }[UI.passcol]} (сменить)</button>
   <button id="gCl">Облака: ${onoff(CL.on)}</button>
   <button id="gWv">Свет и зыбь на море: ${onoff(WV.on)}</button>
   <button id="gFm">Пена у берегов: ${onoff(WV.foam)}</button>
   <button id="gBack">← Назад</button><button id="gClose" class="main">Закрыть</button></div>`);
  const st = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  $('gStyle').onclick = () => { save(); st('poly_style', { wc: 'wc2', wc2: 'sat', sat: 'wc' }[MAPSTYLE] || 'wc'); location.reload(); };
  $('gRidge').onclick = () => { UI.ridgeA = UI.ridgeA === 85 ? 190 : 85; st('poly_ridge', UI.ridgeA === 85 ? 'owner' : 'own'); drawOverlay(); PIX.vtKey = ''; scheduleVector(); showGfxMenu(); };
  $('gSB').onclick = () => { UI.sborder = { black: 'red', red: 'none', none: 'black' }[UI.sborder]; st('poly_sborder', UI.sborder); VEC.cache = null; scheduleVector(); showGfxMenu(); };
  $('gPC').onclick = () => { UI.passcol = { black: 'red', red: 'brown', brown: 'black' }[UI.passcol]; st('poly_passcol', UI.passcol); scheduleVector(); showGfxMenu(); };
  $('gCl').onclick = () => { CL.on = !CL.on; st('poly_clouds', CL.on ? 'on' : 'off'); showGfxMenu(); };
  $('gWv').onclick = () => { WV.on = !WV.on; st('poly_waves', WV.on ? 'on' : 'off'); showGfxMenu(); };
  $('gFm').onclick = () => { WV.foam = !WV.foam; st('poly_foam', WV.foam ? 'on' : 'off'); showGfxMenu(); };
  $('gBack').onclick = showMenu; $('gClose').onclick = closeModal;
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
  <p class="small muted">Звуки природы — записи: море и чайки — присланные автором игры; ветер — bashar3a и remaxim (OpenGameArt, CC0); хищные птицы — qubodup (CC BY 3.0) и antumdeluge (CC BY-SA 4.0), OpenGameArt.</p>
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
    if ((e.key === 'g' || e.key === 'G' || e.key === 'п' || e.key === 'П') && GRID.ok) { UI.gridDbg = !UI.gridDbg; UI._lastToast = null; toast(UI.gridDbg ? 'Сетка перемещений: зелёный — быстро, охра — медленно (горы, лес, болото), красный — непроходимые хребты, серый — вне игры; точки — броды, синие — большие реки (G — скрыть).' : 'Сетка скрыта.'); scheduleVector(); }
    if (e.key === ' ') { e.preventDefault(); setSpeed(UI.speed ? 0 : (UI.lastSpeed || 1)); }
    if (['1', '2', '3', '4', '5'].includes(e.key)) setSpeed(+e.key);
    if (e.key === '+' || e.key === '=') setSpeed(Math.min(5, (UI.speed || UI.lastSpeed || 0) + 1));
    if (e.key === '-') setSpeed(Math.max(0, UI.speed - 1));
    if (e.key === 'Escape') { UI.sel = null; UI.selArmy = null; UI.selProv = null; renderAll(); }
  });
}
if (!HEADLESS) boot();
