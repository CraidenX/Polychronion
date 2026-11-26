
/* ---------- 2. ЯДРО СТРАТЕГИИ ---------- */
let G = null; // всё состояние партии (сохраняется целиком)
const TEST_ARMY = true;   // тестовый отряд у перевалов (для проверки гор)
const rnd = () => Math.random();
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RID = id => ALIAS[id] || id;
const R = id => G.regions[RID(id)];
const RNAME = {}; REGION_DEFS.forEach(d => RNAME[d[0]] = d[1]);
const NEIGH = {};
REGION_DEFS.forEach(d => NEIGH[d[0]] = []);
LINKS.forEach(([a, b, t]) => { NEIGH[a].push({ to: b, t }); NEIGH[b].push({ to: a, t }); });
for (const k in ALIAS) { NEIGH[k] = NEIGH[ALIAS[k]]; RNAME[k] = RNAME[ALIAS[k]]; }
// владение по провинциям: держава у каждой провинции; при смене хозяина региона все его провинции переходят к новому
const REGION_IDX = {}; REGION_DEFS.forEach((d, i) => REGION_IDX[d[0]] = i);
function initProv() {
  const P = MAPINFO && MAPINFO.provs; if (!P) { G.prov = []; return; }
  G.prov = P.map(p => p[6] || (p[0] >= 0 ? REGION_DEFS[p[0]][2] : null));
  for (const id in G.regions) G.regions[id]._po = G.regions[id].owner;
}
function syncProv() {
  const P = MAPINFO && MAPINFO.provs; if (!P || !G) return;
  if (!G.prov || G.prov.length !== P.length) initProv();
  for (const id in G.regions) {
    const r = G.regions[id]; if (r._po === r.owner) continue;
    const gi = REGION_IDX[id]; for (let k = 0; k < P.length; k++) if (P[k][0] === gi) G.prov[k] = r.owner;
    r._po = r.owner;
  }
}
const fname = f => (G && G.fnames && G.fnames[f]) || FACTIONS[f].name;
const fshort = f => (G && G.fshort && G.fshort[f]) || FACTIONS[f].short;
const dateStr = (y = G.year, s = G.season) => SEASONS[s] + ' ' + y;
/* --- реальное время: сезон = SEASON_DAYS дней; экономика, события и решения ИИ — раз в сезон, движение войск — по дням --- */
const SEASON_DAYS = 91;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dayDate() {   // «14 июля 1261»: день сезона -> настоящая календарная дата
  const s = G.season, y = G.year, sm = [2, 5, 8, 11][s];
  const st = Date.UTC(y, sm, 1), en = Date.UTC(s === 3 ? y + 1 : y, (sm + 3) % 12, 1), len = (en - st) / 864e5;
  const dt = new Date(st + Math.floor(Math.min(SEASON_DAYS - 1, G.day || 0) * len / SEASON_DAYS) * 864e5);
  return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
}
// длительность перехода между соседними областями (дней): по расстоянию между центрами, ~20 км в день,
// по морю ~45 км в день; перевал — ещё PASS_DAYS. Масштаб карты: 1 px ≈ 0,63 км по долготе, 0,82 км по широте
const MARCH_KM = 20, SAIL_KM = 45;
// скорость по местности (утверждено автором): множитель скорости марша по классу местности под каждым участком дороги
// (при наложении классов берётся минимальный — это считает сборка, mkroadcost.py), задержки на переправах и перевалах — в днях
const MOVE = {
  mult: { plain: 1.0, hills: 0.75, forest: 0.5, forestRoad: 0.85, mountains: 0.4, swamp: 0.4, desert: 0.7, steppe: 1.0, road: 1.25 },
  ford: 0.5, bigRiver: Infinity, bridge: 0,   // J5: малая река (брод) +0,5 дня; большая река — только по мосту (без моста непроходима); по мосту — 0
  bigRiverDetour: 2,                  // грубая оценка без сетки (rcost): обход до моста ≈ +2 дня
  riverSail: true,                    // с флотом (речными судами) — вдоль большой реки со скоростью плавания
  pass: 4,                            // перевал: +3–5 дней (было +15)
};
const PASS_DAYS = MOVE.pass;
// дни пути по дороге связи i (rcost из mkroadcost.py: км по классам + броды + большие реки); null — по прямой
function terrainDays(i, t) {
  const c = typeof MAPINFO !== 'undefined' && MAPINFO.rcost && MAPINFO.rcost[i]; if (!c) return null;
  const m = MOVE.mult, mm = [m.plain, m.hills, m.forest, m.mountains, m.swamp, m.desert, m.steppe];   // порядок как в rcost
  let d = 0; for (let k = 0; k < 7; k++) d += c[k] / (MARCH_KM * mm[k]);
  d += c[7] * MOVE.ford + c[8] * (Number.isFinite(MOVE.bigRiver) ? MOVE.bigRiver : MOVE.bigRiverDetour) + (t === 'pass' ? MOVE.pass : 0);
  return Math.max(1, Math.round(d));
}
function legKm(from, to) {
  const P = typeof MAPINFO !== 'undefined' && MAPINFO.pos, a = P && P[RID(from)], b = P && P[RID(to)];
  if (!a || !b) return 150;
  const k = MAPINFO.W / 5298;
  return Math.hypot((a[0] - b[0]) * 0.63 / k, (a[1] - b[1]) * 0.82 / k);
}
function legDays(from, to) {
  const lk = (NEIGH[from] || []).find(n => n.to === to);
  const sea = lk && (lk.t === 'sea' || lk.t === 'strait');
  let d = Math.max(2, Math.round(legKm(from, to) / (sea ? SAIL_KM : MARCH_KM)));
  if (lk && lk.t === 'pass') d += PASS_DAYS;
  return d;
}
// войско в пути: a.leg = {from, to, t, dur}; позиция на карте — между центрами областей
function legPos(a) { return a.leg ? a.leg.t / a.leg.dur : 0; }
function startLeg(a) {
  if (a.leg || !a.path.length) return;
  const g = provGraph(), from = armyProv(a), to = a.path[0];
  const e = g.adj[from].find(x => x.to === to), rt = g.reg[to];
  if (!e || !linkOk(a.owner, e.t) || (rt !== RID(a.region) && a.owner === 'byz' && !canEnter('byz', rt))) { a.path = []; return; }
  a.leg = { from, to, t: 0, dur: e.d }; a.siege = 0;
  if (e.t === 'pass' && a.owner === 'byz') log(`${a.name} поднимается на перевал: путь займёт на ${PASS_DAYS} дн. дольше.`);
}
async function dayTick() {
  G.day = (G.day || 0) + 1;
  if (G.day % AI_EVERY === 0) { await aiMoves(); if (G.over) return; }
  for (const a of G.armies.slice()) {
    if (!G.armies.includes(a) || !a.units.length) continue;
    if (a.path.length && typeof a.path[0] === 'string') a.path = [];        // старое сохранение: путь по регионам
    if (a.leg && typeof a.leg.from === 'string') a.leg = null;
    armyProv(a);
    if (GRID.ok) { a.leg = null; await gridDay(a); if (G.over) return; continue; }
    if (a.leg) {
      // приказ изменился (или «стоять»): войско поворачивает назад
      if (a.leg.to !== a.prov && a.path[0] !== a.leg.to) a.leg = { from: a.leg.to, to: a.prov, t: a.leg.dur - a.leg.t, dur: a.leg.dur, back: true };
      a.leg.t++;
      if (a.leg.t >= a.leg.dur) {
        const to = a.leg.to; a.leg = null;
        if (to === a.prov) continue;   // вернулось
        a.path.shift();
        const rt = provReg(to);
        if (rt !== RID(a.region)) {
          await stepArmy(a, rt);       // вход в другой регион: бой, захват
          if (G.over) return;
          if (!G.armies.includes(a) || RID(a.region) !== rt) { a.path = []; continue; }
        }
        a.prov = to;
      }
    }
    if (!a.leg && a.path.length && G.armies.includes(a)) startLeg(a);
  }
}
const dateNum = (y, s) => y * 4 + s;
const nowNum = () => dateNum(G.year, G.season);
const STRAT_RULERS = [
  { name: 'Алексей Стратигопул, регент', mar: 4, stw: 2, dip: 2, pie: 3, desc: 'Кесарь, взявший Город, правит от имени юного Иоанна IV Ласкариса.', minor: true },
  { name: 'Иоанн IV Ласкарис', mar: 2, stw: 3, dip: 3, pie: 4, desc: 'Последний Ласкарис, вступивший в права после регентства.' },
];
const ruler = () => {
  let r = RULERS[G.rulerIdx];
  if (G.path === 'strat' && G.rulerIdx === 0) r = G.flags.john4 ? STRAT_RULERS[1] : STRAT_RULERS[0];
  const m = G.rulerMod || {}; return { ...r, mar: r.mar + (m.mar || 0), stw: r.stw + (m.stw || 0), pie: r.pie + (m.pie || 0), dip: r.dip };
};
function succession(idx) {
  G.rulerIdx = idx;
  const e = G.heir.educ; G.rulerMod = e === 'war' ? { mar: 1 } : e === 'books' ? { stw: 1 } : e === 'church' ? { pie: 1 } : {};
  if (G.heir.co) { G.order += 6; log('Коронованный заранее соправитель принял власть без смуты. Порядок +6.'); } else G.order -= 6;
  G.heir = { co: false, educ: 'none' };
}
const fmt = n => Math.round(n).toLocaleString('ru-RU');

function log(text, kind = '') {
  G.log.unshift({ d: dateStr(), t: text, k: kind });
  if (G.log.length > 400) G.log.length = 400;
  if (!HEADLESS && typeof toast === 'function' && kind === 'imp') { toast(text); if (typeof SFX !== 'undefined' && !(typeof BV !== 'undefined' && BV.b)) SFX.play('alert'); }
}

function newGame() {
  G = {
    v: 1, year: START.year, season: START.season, turn: 0,
    treasury: 220, order: 55, church: 40, prestige: 35,
    tax: 'normal', coin: 15, laws: { akritai: true, monktax: false, pronoia: false, judges: false, genoapriv: true, grain: false },
    union: 'none', unionProg: 0, fleet: 2, fleetRebuild: 0,
    build: { prio: 'forts', share: 10, fund: 0 },
    rulerIdx: 0, heir: { co: false, educ: 'none' }, regent: null,
    regions: {}, factions: {}, armies: [], heroes: [], candidates: [], captives: [],
    aiwars: [], nextId: 1, log: [], flags: {}, fired: {}, anjou: 0,
    stats: { won: 0, lost: 0, gained: 0, lostR: 0, peakRegions: 0 },
    lastIncome: {}, autoBattle: false, over: false, fnames: {}, fshort: {}, names: { r: {}, p: {} }, day: 0,
  };
  REGION_DEFS.forEach(([id, nm, owner, w, pop, fort, gar, mood, ter]) => {
    G.regions[id] = { id, owner, wealth: w, pop, fort, garrison: gar, mood, ter, dev: 0, siege: 0, devast: 0 };
  });
  for (const f in FACTIONS) {
    const d = FACTIONS[f];
    G.factions[f] = { treasury: 60, rel: d.rel || 0, war: !!d.war, truce: 0, ally: false, married: false, weary: 0, bonus: 0 };
  }
  G.factions.rebel.war = true;
  for (const f in G.factions) G.factions[f].start = Math.max(f === 'osman' ? 4 : 2, Object.values(G.regions).filter(r => r.owner === f).length);
  // стартовые армии
  addArmy('byz', 'konst', [['inf', 3], ['cav', 2], ['arch', 2]], 'Армия Города');
  addArmy('byz', 'thessal', [['inf', 3], ['cav', 2], ['arch', 1]], 'Западная армия');
  // ТЕСТ: отряд для проверки перевалов (Стримон → перевал → Эматия → перевал → Фессалия). Убрать: TEST_ARMY = false
  if (TEST_ARMY && !HEADLESS) addArmy('byz', 'serres', [['inf', 2], ['arch', 1]], 'Горный отряд (тест)');
  addArmy('epirus', 'epirus', [['inf', 3], ['cav', 1], ['arch', 2]]);
  addArmy('achaea', 'achaea', [['inf', 2], ['cav', 3], ['merc', 1]]);
  addArmy('bulgaria', 'tarnovo', [['inf', 3], ['cav', 3], ['arch', 1]]);
  // стартовый двор
  HIST_HEROES.filter(h => h[5] === 1261).forEach(h => G.heroes.push(makeHistHero(h)));
  G.heroes.forEach((h, i) => h.slot = i);
  const strat = G.heroes.find(h => h.name.startsWith('Алексей Страт'));
  const ioann = G.heroes.find(h => h.name.startsWith('Иоанн Палеолог'));
  if (strat) assignGeneral(strat, G.armies[0]);
  if (ioann) assignGeneral(ioann, G.armies[1]);
  G.heroes.forEach(h => {
    if (h.role === 'merchant') h.mission = { type: 'trade', target: 'genoa' };
    if (h.role === 'governor') h.mission = { type: 'govern', target: 'thessal' };
    if (h.role === 'priest') h.mission = { type: 'church' };
    if (h.role === 'diplomat') h.mission = { type: 'relations', target: 'bulgaria' };
  });
  refreshCandidates();
  G.stats.peakRegions = myRegions().length; G.stats.startR = myRegions().length;
  initProv();
  log('25 июля 1261 года кесарь Алексей Стратигопул вошёл в Константинополь. Латинская империя пала.');
  return G;
}

/* --- армии --- */
function mkUnit(type, men) { return { type, men: men == null ? UNIT[type].men : men, max: UNIT[type].men, xp: 0 }; }
function addArmy(owner, region, comp, name) {
  region = RID(region);
  const a = { id: G.nextId++, owner, region, units: [], gen: null, path: [], siege: 0, moved: false, stormed: false, name: name || ('Войско: ' + fshort(owner)) };
  comp.forEach(([t, n]) => { for (let i = 0; i < n; i++) a.units.push(mkUnit(t)); });
  if (owner !== 'byz') a.gen = { name: aiGeneralName(owner), skill: ri(1, 3) };
  G.armies.push(a);
  return a;
}
function aiGeneralName(f) {
  const pools = {
    osman: ['Осман', 'Орхан', 'Конур Альп', 'Акче Коджа', 'Абдуррахман', 'Сулейман-паша'], seljuk: ['Кей-Кавус II', 'Масуд', 'Караман-бей'], rum_east: ['Кылыч-Арслан IV', 'Перване Сулейман'],
    germiyan: ['Якуб-бей', 'Алишир'], menteshe: ['Ментеше-бей', 'Орхан-бей'], aydin: ['Мехмед Айдын', 'Умур-бей'], karasi: ['Караси-бей', 'Демирхан'],
    bulgaria: ['Константин Тих', 'Ивайло', 'Феодор Святослав', 'Михаил Шишман'], serbia: ['Стефан Урош', 'Милутин', 'Стефан Душан', 'Хреля'],
    epirus: ['Михаил II', 'Никифор I', 'Иоанн Дука'], achaea: ['Гильом де Виллардуэн', 'Жоффруа де Брюйер'], athens: ['Жан де ла Рош', 'Гоше де Бриенн'],
    anjou: ['Гуго ле Руж', 'Филипп де Тусси', 'Карл Анжуйский'], catalan: ['Рожер де Флор', 'Беренгер д\'Энтенса', 'Беренгер Рокафорт'],
    venice: ['Марко Санудо', 'Джованни Дандоло'], genoa: ['Бенедетто Заккария'], trebizond: ['Георгий Комнин'], rebel: ['вождь мятежа'],
  };
  return pick(pools[f] || ['военачальник']);
}
function armyMen(a) { return a.units.reduce((s, u) => s + u.men, 0); }
function genOf(a) { if (!a.gen) return null; if (typeof a.gen === 'object') return a.gen; return G.heroes.find(h => h.id === a.gen) || null; }
function genSkill(a) {
  const g = genOf(a); if (!g) return 0;
  if (g.skill != null) return g.skill;
  return (g.sk[0] + g.sk[1]) / 2 + g.level * 0.3;
}
function armyPower(a) {
  let p = 0;
  a.units.forEach(u => { const d = UNIT[u.type]; p += u.men / 100 * (d.atk + d.def) / 2 * (1 + u.xp * 0.05); });
  return p * (1 + genSkill(a) * 0.08) * (a.gen ? 1 : 0.85);
}
function garPower(r) { return r.garrison / 100 * 4.5 * (1 + r.fort * 0.3); }
function armiesIn(rid, owner) { return G.armies.filter(a => a.region === rid && (!owner || a.owner === owner)); }
function myArmies() { return G.armies.filter(a => a.owner === 'byz'); }
function myRegions() { return Object.values(G.regions).filter(r => r.owner === 'byz'); }
function atWar(a, b) {
  if (a === b || a === 'free' || b === 'free') return false;   // ничейные земли пока никто не трогает
  if (a === 'byz') return G.factions[b].war;
  if (b === 'byz') return G.factions[a].war;
  if (a === 'rebel' || b === 'rebel') return false;
  return G.aiwars.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
}
function canSail(owner) { return owner === 'byz' ? G.fleet > 0 : ['venice', 'genoa', 'catalan', 'anjou', 'aydin', 'menteshe', 'karasi', 'achaea'].includes(owner); }
function linkOk(owner, t) { return t !== 'sea' || canSail(owner); }
function canEnter(owner, rid) {
  const o = R(rid).owner;
  if (o === owner) return true;
  if (owner === 'byz' && G.factions[o] && G.factions[o].ally) return true;
  return atWar(owner, o);
}
/* --- движение по провинциям: граф соседства (суша, перевалы, проливы, море) --- */
let PG = null;
function provGraph() {
  if (PG) return PG;
  const M = MAPINFO, P = M.provs, k = M.W / 5298;
  const km = (a, b) => Math.hypot((P[a][1] - P[b][1]) * 0.63 / k, (P[a][2] - P[b][2]) * 0.82 / k);
  const adj = P.map(() => []), reg = P.map(p => p[0] >= 0 ? M.ids[p[0]] : null), byReg = {};
  const RD = typeof ROADS !== 'undefined' ? ROADS : null;
  (M.padj || []).forEach(([a, b, t], i) => {
    const sea = t === 'sea' || t === 'strait';
    // дорога по местности (roads.js): ломаная от центра провинции a к центру b; длина — в км
    let pts = null, len = km(a, b);
    if (RD && RD[i]) {
      const r = RD[i], n = r.length / 2; pts = new Float32Array(r.length); let x = 0, y = 0;
      for (let j = 0; j < n; j++) { x += r[2 * j]; y += r[2 * j + 1]; pts[2 * j] = x; pts[2 * j + 1] = y; }
      len = 0; for (let j = 1; j < n; j++) len += Math.hypot((pts[2 * j] - pts[2 * j - 2]) * 0.63 / k, (pts[2 * j + 1] - pts[2 * j - 1]) * 0.82 / k);
    }
    const td = sea ? null : terrainDays(i, t), d = td != null ? td : Math.max(1, Math.round(len / (sea ? SAIL_KM : MARCH_KM))) + (t === 'pass' ? PASS_DAYS : 0);   // суша — по местности вдоль дороги
    adj[a].push({ to: b, t, d, pts, rev: false, km: len }); adj[b].push({ to: a, t, d, pts, rev: true, km: len });
  });
  reg.forEach((r, i) => { if (r) (byReg[r] = byReg[r] || []).push(i); });
  const main = {};
  for (const r in byReg) { const c = M.pos[r]; main[r] = c ? byReg[r].reduce((b, i) => ((P[i][1] - c[0]) ** 2 + (P[i][2] - c[1]) ** 2 < (P[b][1] - c[0]) ** 2 + (P[b][2] - c[1]) ** 2 ? i : b), byReg[r][0]) : byReg[r][0]; }
  return PG = { adj, reg, byReg, main, km };
}
const provReg = k => provGraph().reg[k];
// точка на дороге от провинции from к to на доле пути f (0..1)
function roadPoint(from, to, f) {
  const g = provGraph(), e = g.adj[from].find(x => x.to === to), P = MAPINFO.provs;
  if (!e || !e.pts) return [P[from][1] + (P[to][1] - P[from][1]) * f, P[from][2] + (P[to][2] - P[from][2]) * f];
  const p = e.pts, n = p.length / 2;
  if (!e.cum) { e.cum = new Float32Array(n); for (let j = 1; j < n; j++) e.cum[j] = e.cum[j - 1] + Math.hypot(p[2 * j] - p[2 * j - 2], p[2 * j + 1] - p[2 * j - 1]); }
  const L = e.cum[n - 1], s = (e.rev ? 1 - f : f) * L;
  let j = 1; while (j < n - 1 && e.cum[j] < s) j++;
  const seg = e.cum[j] - e.cum[j - 1] || 1, u = (s - e.cum[j - 1]) / seg;
  return [p[2 * j - 2] + (p[2 * j] - p[2 * j - 2]) * u, p[2 * j - 1] + (p[2 * j + 1] - p[2 * j - 1]) * u];
}
// вся дорога от from к to (для рисования маршрута)
function roadPts(from, to) {
  const e = provGraph().adj[from].find(x => x.to === to), P = MAPINFO.provs;
  if (!e || !e.pts) return [[P[from][1], P[from][2]], [P[to][1], P[to][2]]];
  const out = []; for (let j = 0; j < e.pts.length; j += 2) out.push([e.pts[j], e.pts[j + 1]]);
  return e.rev ? out.reverse() : out;
}
// провинция, где стоит войско (если не задана или не совпадает с регионом — главная провинция региона)
function armyProv(a) {
  const g = provGraph(), r = RID(a.region);
  if (GRID.ok && a.cell != null) { const p = cellProv(a.cell); if (p >= 0 && g.reg[p] === r) return a.prov = p; }
  if (a.prov == null || g.reg[a.prov] !== r) a.prov = g.main[r] != null ? g.main[r] : (g.byReg[r] || [0])[0];
  return a.prov;
}
// путь по провинциям (Дейкстра по дням): транзит — только через свои регионы, текущий и целевой
function findProvPath(a, toReg, toProv, fromProv) {
  const g = provGraph(), from = fromProv != null ? fromProv : armyProv(a), cur = fromProv != null ? g.reg[fromProv] : RID(a.region); toReg = RID(toReg);
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set(), heap = [[0, from]];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let goal = -1;
  while (heap.length) {
    const [d, v] = pop(); if (done.has(v)) continue; done.add(v);
    if (toProv != null ? v === toProv : (g.reg[v] === toReg && v !== from)) { goal = v; break; }
    for (const e of g.adj[v]) {
      if (done.has(e.to) || !linkOk(a.owner, e.t)) continue;
      const rr = g.reg[e.to];
      if (rr !== cur && rr !== toReg) { if (!canEnter(a.owner, rr) || R(rr).owner !== a.owner) continue; }
      else if (rr === toReg && rr !== cur && !canEnter(a.owner, rr)) continue;
      const nd = d + e.d; if (nd < (dist.has(e.to) ? dist.get(e.to) : 1e9)) { dist.set(e.to, nd); prev.set(e.to, v); push(nd, e.to); }
    }
  }
  if (goal < 0) return null;
  const path = []; let v = goal; while (v !== from) { path.unshift(v); v = prev.get(v); }
  return path;
}
/* --- сетка перемещений (grid.bin, mkgrid.py): клетка 6 px карты. Войско стоит в любой клетке (a.cell); путь — A* по клеткам с 8 соседями,
   время клетки = км / (MARCH_KM × множитель местности), переправы и перевалы — задержки на рёбрах. Решения ИИ — по графу провинций (как раньше),
   а сам путь строится по сетке внутри «коридора» провинций этого пути. Без сетки (файл не загружен) — прежнее движение по дорогам провинций. --- */
const GRID = { ok: false };
function gridInit(buf) {
  try {
    const h = new Uint32Array(buf, 0, 5); if (h[0] !== 0x47524944) return;
    const GW = h[1], GH = h[2], C = h[3], nl = h[4], lens = new Uint32Array(buf, 20, nl), N = GW * GH;
    let off = 20 + nl * 4; const out = [];
    for (let l = 0; l < nl; l++) {
      const src = new Uint16Array(buf.slice(off, off + lens[l] * 2)), a = l === 1 ? new Uint16Array(N) : new Uint8Array(N); let p = 0;
      for (let i = 0; i < src.length; i += 2) { a.fill(src[i], p, p + src[i + 1]); p += src[i + 1]; }
      out.push(a); off += lens[l] * 2;
    }
    const k = MAPINFO.W / 5298, kx = C * 0.63 / k, ky = C * 0.82 / k;
    Object.assign(GRID, { ok: true, GW, GH, C, N, cls: out[0], prov: out[1], flags: out[2], edge: out[3], kx, ky, kd: Math.hypot(kx, ky),
      g: new Float32Array(N), from: new Int32Array(N), stamp: new Int32Array(N), closed: new Int32Array(N), gen: 0, cache: new Map() });
    GRID.mult = new Float32Array(N); for (let i = 0; i < N; i++) GRID.mult[i] = cellMult(i);
  } catch (e) { GRID.ok = false; }
}
if (typeof globalThis !== 'undefined' && globalThis.__GRID_BUF__) gridInit(globalThis.__GRID_BUF__);
else if (!HEADLESS && typeof fetch !== 'undefined' && typeof location !== 'undefined' && location.protocol !== 'file:') fetch('grid.bin').then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) gridInit(b); }).catch(() => { });
// множитель скорости клетки (0 — непроходима для войска на суше): тот же объект MOVE
function cellMult(i) {
  const f = GRID.flags[i], c = GRID.cls[i], m = MOVE.mult;
  if (!(f & 1) || !(f & 2) || (f & 16)) return 0;
  let t = m.plain;
  if (c & 1) t = Math.min(t, m.hills); if (c & 64) t = Math.min(t, m.steppe); if (c & 32) t = Math.min(t, m.desert);
  const forest = c & 2, hard = c & (4 | 8 | 16);
  if (forest) t = Math.min(t, m.forest);
  if (c & (4 | 8)) t = Math.min(t, m.mountains); if (c & 16) t = Math.min(t, m.swamp);
  if (f & 4) t = hard ? t : forest ? Math.max(t, m.forestRoad) : Math.max(t, m.road);   // дорога: по равнине, холмам, степи, пустыне — 1,25; через лес — 0,85; горы и болото — как есть
  return t;
}
const cellXY = c => [(c % GRID.GW) * GRID.C + GRID.C / 2, Math.floor(c / GRID.GW) * GRID.C + GRID.C / 2];
const cellAt = (x, y) => clamp(Math.floor(y / GRID.C), 0, GRID.GH - 1) * GRID.GW + clamp(Math.floor(x / GRID.C), 0, GRID.GW - 1);
const cellProv = c => GRID.prov[c] - 1;
const cellDist = (a, b) => Math.max(Math.abs(a % GRID.GW - b % GRID.GW), Math.abs(Math.floor(a / GRID.GW) - Math.floor(b / GRID.GW)));
// переправа между соседними клетками (dx, dy ∈ −1..1): 0 нет, 1 брод, 2 большая река, 3 мост
function edgeCode(a, dx, dy) {
  const E = GRID.edge, W = GRID.GW;
  if (dy === 0) return dx > 0 ? E[a] & 3 : E[a - 1] & 3;
  if (dx === 0) return dy > 0 ? (E[a] >> 2) & 3 : (E[a - W] >> 2) & 3;
  if (dx === dy) return dy > 0 ? (E[a] >> 4) & 3 : (E[a - W - 1] >> 4) & 3;
  return dy > 0 ? (E[a] >> 6) & 3 : (E[a - W + 1] >> 6) & 3;
}
const EDGE_DAYS = () => [0, MOVE.ford, MOVE.bigRiver, MOVE.bridge];
// ближайшая проходимая клетка (по суше), по возможности — в провинции prov
function snapCell(c, prov, R0 = 12) {
  const W = GRID.GW, x0 = c % W, y0 = Math.floor(c / W); let best = -1, bd = 1e9;
  for (let r = 0; r <= R0 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= W || y >= GRID.GH) continue;
    const i = y * W + x; if (!GRID.mult[i] || (prov != null && cellProv(i) !== prov)) continue;
    const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; }
  }
  return best >= 0 ? best : (prov != null ? snapCell(c, null, R0) : c);
}
// клетка «города» региона (его крепость): у центра региона
const CITY = {};
function cityCell(rid) {
  rid = RID(rid); if (CITY[rid] != null) return CITY[rid];
  const p = MAPINFO.pos[rid], g = provGraph(); if (!p) return CITY[rid] = 0;
  return CITY[rid] = snapCell(cellAt(p[0], p[1]), g.main[rid]);
}
const MEET = 2;   // встреча и бой — враги в пределах 2 клеток (~10 км); осада — в тех же пределах от города
const nearCity = (a, rid) => !GRID.ok || cellDist(armyCell(a), cityCell(rid)) <= MEET;
// клетка войска: если не задана или не в его регионе — у города региона (новое войско, отступление, событие)
function armyCell(a) {
  if (!GRID.ok) return 0;
  if (a.cell == null || provReg(cellProv(a.cell)) !== RID(a.region)) { a.pos = null; a.cell = cityCell(a.region); const k = G.armies.filter(x => x !== a && x.cell === a.cell).length; if (k) a.cell = snapCell(a.cell + (k % 3 - 1) + (k > 2 ? GRID.GW : -GRID.GW), provGraph().main[RID(a.region)], 3); a.route = null; }
  return a.cell;
}
// куда войску можно: свои регионы, текущий и те, куда разрешён вход (война, союз); море — с флотом, без флота — только проливы
function provAllow(a) {
  const pg = provGraph(), cur = RID(a.region), key = a.owner + ':' + cur + ':' + G.year + ':' + G.season + ':' + (G.day || 0);
  if (a._allowKey === key) return a._allow;
  const regOk = {}, allow = new Uint8Array(pg.reg.length);
  pg.reg.forEach((r, k) => { if (!r) return; if (!(r in regOk)) regOk[r] = r === cur || R(r).owner === a.owner || canEnter(a.owner, r); allow[k] = regOk[r] ? 1 : 0; });
  a._allowKey = key; a._allow = allow; return allow;
}
// A* по сетке: от клетки s прямо до клетки t (8 соседей). Возвращает список клеток или null
function gridPath(s, t, allow, sail, maxN = 300000) {
  const W = GRID.GW, Hh = GRID.GH, g = GRID.g, from = GRID.from, st = GRID.stamp, cl = GRID.closed, M = GRID.mult, F = GRID.flags, P = GRID.prov;
  const gen = ++GRID.gen, ED = EDGE_DAYS(), vh = Math.max(sail ? SAIL_KM : 0, MARCH_KM * MOVE.mult.road);
  const tx = t % W, ty = Math.floor(t / W), hf = c => Math.hypot((c % W - tx) * GRID.kx, (Math.floor(c / W) - ty) * GRID.ky) / vh;
  const ok = c => (F[c] & 1) ? (M[c] > 0 && allow[P[c] - 1] === 1) : ((F[c] & 64) || (sail && (F[c] & (32 | 128))));   // 128 — судоходная большая река (вода)
  const heap = [], push = (f, c) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  st[s] = gen; g[s] = 0; from[s] = -1; push(hf(s), s); let n = 0;
  while (heap.length && n++ < maxN) {
    const [, c] = pop(); if (cl[c] === gen) continue; cl[c] = gen;
    if (c === t) { const cells = []; let v = t; while (v >= 0) { cells.push(v); v = from[v]; } return cells.reverse(); }
    const cx = c % W, cy = (c - cx) / W, sea = !(F[c] & 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
      const v = y * W + x; if (cl[v] === gen || !ok(v)) continue;
      const vsea = !(F[v] & 1), km = dx && dy ? GRID.kd : dx ? GRID.kx : GRID.ky;
      const rs = sail && MOVE.riverSail && (F[c] & 128) && (F[v] & 128);   // J5: вдоль большой реки — на судах
      const vbr = (F[v] & 64) && (F[v] & 128);   // мост через водный участок большой реки — пешком, без лодок
      let d = vsea || sea || rs ? (sail ? km / SAIL_KM : km / MARCH_KM + (vsea && !sea && !vbr ? 1 : 0)) : km / (MARCH_KM * M[v]);   // без флота пролив — на лодках: 20 км/день и день на переправу
      if (!vsea && !sea && !rs) { const ec = ED[edgeCode(c, dx, dy)]; if (ec === Infinity) continue; d += ec; if ((F[v] & 8) && !(F[c] & 8)) d += MOVE.pass; }   // большая река без моста — непроходима
      const nd = g[c] + d; if (st[v] === gen && nd >= g[v]) continue;
      st[v] = gen; g[v] = nd; from[v] = c; push(nd + hf(v), v);
    }
  }
  return null;
}
// клетки вдоль отрезка между центрами клеток a и b (шаг — полклетки)
function lineCells(a, b) {
  const [x0, y0] = cellXY(a), [x1, y1] = cellXY(b), n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (GRID.C / 2))), out = [a];
  for (let i = 1; i <= n; i++) { const c = cellAt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); if (c !== out[out.length - 1]) out.push(c); }
  return out;
}
// «натягивание нити»: узел убирается, если прямой отрезок между соседними узлами идёт только по клеткам не медленнее исходного участка,
// не выходит в море, на непроходимые клетки и не пересекает больше рек (бродов, больших рек), чем исходный участок
function pullString(cells, allow) {
  const F = GRID.flags, M = GRID.mult, P = GRID.prov, W = GRID.GW;
  const isLand = c => !!(F[c] & 1);
  const cross = seq => { let f = 0, b = 0; for (let i = 1; i < seq.length; i++) { const a = seq[i - 1], c = seq[i], dx = c % W - a % W, dy = Math.floor(c / W) - Math.floor(a / W); if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue; const e = edgeCode(a, dx, dy); if (e === 1) f++; else if (e === 2) b++; } return [f, b]; };
  const out = [cells[0]]; let i = 0;
  while (i < cells.length - 1) {
    let j = i + 1;
    if (isLand(cells[i])) {
      let minM = M[cells[i + 1]] || 0, best = i + 1;
      for (let k = i + 2; k < cells.length && k < i + 80; k++) {
        const c = cells[k]; if (!isLand(c)) break; minM = Math.min(minM, M[c]);
        const ln = lineCells(cells[i], c); let good = true;
        for (const q of ln) if (!isLand(q) || !M[q] || M[q] < minM - 1e-6 || allow[P[q] - 1] !== 1 || ((F[q] & 8) !== (F[c] & 8) && (F[q] & 8))) { good = false; break; }
        if (good) { const [f1, b1] = cross(ln), [f0, b0] = cross(cells.slice(i, k + 1)); if (f1 > f0 || b1 > b0) good = false; }
        if (good) best = k;
      }
      j = best;
    }
    out.push(cells[j]); i = j;
  }
  return out;
}
// сглаживание Catmull-Rom и время в пути вдоль кривой: скорость — 20 км/день × множитель клетки, переправы и перевалы — остановки на месте
function buildRoute(x0, y0, nodes, sail) {
  const pts = [[x0, y0]].concat(nodes.slice(1).map(cellXY));
  const X = [], Y = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t;
      X.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3));
      Y.push(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)); }
  }
  const last = pts[pts.length - 1]; X.push(last[0]); Y.push(last[1]);
  const k = MAPINFO.W / 5298, ED = EDGE_DAYS(), F = GRID.flags, M = GRID.mult, W = GRID.GW;
  const RX = [X[0]], RY = [Y[0]], T = [0]; let t = 0, pc = cellAt(X[0], Y[0]), pm = M[pc] || MOVE.mult.plain;
  for (let i = 1; i < X.length; i++) {
    const c = cellAt(X[i], Y[i]), km = Math.hypot((X[i] - X[i - 1]) * 0.63 / k, (Y[i] - Y[i - 1]) * 0.82 / k), sea = !(F[c] & 1);
    let m = sea ? 0 : M[c]; if (!sea && !m) m = pm; if (m) pm = m;
    if (c !== pc && !sea && (F[pc] & 1)) {   // переход в соседнюю клетку: переправа, перевал — остановка
      const dx = Math.sign(c % W - pc % W), dy = Math.sign(Math.floor(c / W) - Math.floor(pc / W));
      const rs = sail && MOVE.riverSail && (F[c] & 128) && (F[pc] & 128), e0 = rs ? 0 : ED[edgeCode(pc, dx, dy)];
      const stop = (Number.isFinite(e0) ? e0 : 0) + ((F[c] & 8) && !(F[pc] & 8) ? MOVE.pass : 0);
      if (stop) { RX.push(X[i - 1]); RY.push(Y[i - 1]); t += stop; T.push(t); }
    }
    if (sea && !sail && (F[pc] & 1) && !((F[c] & 64) && (F[c] & 128))) t += 1;   // переправа на лодках (по мосту — без задержки)
    const onRiv = sail && MOVE.riverSail && (F[c] & 128) && (F[pc] & 128);   // вдоль большой реки на судах
    t += sea ? km / (sail ? SAIL_KM : MARCH_KM) : onRiv ? km / SAIL_KM : km / (MARCH_KM * m);
    RX.push(X[i]); RY.push(Y[i]); T.push(t); pc = c;
  }
  return { x: RX.map(v => Math.round(v * 10) / 10), y: RY.map(v => Math.round(v * 10) / 10), t: T.map(v => Math.round(v * 1000) / 1000) };
}
// маршрут войска до клетки goal: A* напрямую, нить, сглаживание; кэш по началу, цели и владельцу
function planRoute(a, goal) {
  const s = armyCell(a); if (goal == null || goal === s) return null;
  const allow = provAllow(a), sail = canSail(a.owner), key = a.owner + ':' + s + '>' + goal + ':' + sail;
  let cells = GRID.cache.get(key);
  if (cells === undefined) { cells = gridPath(s, goal, allow, sail); if (!cells) GRID.fails = (GRID.fails || 0) + 1; GRID.plans = (GRID.plans || 0) + 1; if (GRID.cache.size > 400) GRID.cache.delete(GRID.cache.keys().next().value); GRID.cache.set(key, cells); }
  if (!cells || cells.length < 2) return null;
  const [x0, y0] = a.pos || cellXY(s);
  return buildRoute(x0, y0, pullString(cells, allow), sail);
}
function routeDaysLeft(a) { const r = a.route; return r ? Math.max(0, r.t[r.t.length - 1] - (a.rt || 0)) : 0; }
// точка маршрута в момент t (дней от начала): координаты и направление
function routeAt(r, t) {
  const T = r.t, n = T.length; if (t <= 0) return [r.x[0], r.y[0], 0, 0];
  if (t >= T[n - 1]) return [r.x[n - 1], r.y[n - 1], n - 1, n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const u = T[hi] > T[lo] ? (t - T[lo]) / (T[hi] - T[lo]) : 1;
  return [r.x[lo] + (r.x[hi] - r.x[lo]) * u, r.y[lo] + (r.y[hi] - r.y[lo]) * u, lo, hi];
}
function routeHeading(r, i) { for (let j = Math.max(1, i); j < r.x.length; j++) { const dx = r.x[j] - r.x[j - 1], dy = r.y[j] - r.y[j - 1]; if (dx || dy) return Math.atan2(dy, dx); } return 0; }
const gridFoe = (a, c) => G.armies.find(x => x !== a && atWar(a.owner, x.owner) && x.units.length && cellDist(armyCell(x), c) <= MEET);
// день войска: время идёт на сутки, войско проходит по кривой; по пути — вход в регионы (stepArmy: захват) и встречи (бой)
async function gridDay(a) {
  armyCell(a);
  { const foe = gridFoe(a, a.cell); if (foe) { const won = await fieldBattle(a, foe, R(provReg(cellProv(a.cell)) || a.region)); GRID.meets = (GRID.meets || 0) + 1; if (G.over) return; a.route = null; if (!won || !G.armies.includes(a)) { a.path = []; return; } } }
  if (!a.path.length) { a.route = null; return; }                    // «стоять»: остаётся там, где стоит
  if (a.route && !a.route.t) a.route = null;   // старое сохранение
  if (!a.route) { const r = planRoute(a, a.goal); if (!r) { a.path = []; a.route = null; return; } a.route = r; a.rt = 0; a.siege = 0; }
  const R0 = a.route, t0 = a.rt || 0, t1 = t0 + 1; a.rt = t1;
  const [, , i0] = routeAt(R0, t0), [, , i1] = routeAt(R0, t1);
  for (let i = i0 + 1; i <= Math.min(i1 + 1, R0.x.length - 1); i++) {
    if (R0.t[i] > t1) break;
    const nc = cellAt(R0.x[i], R0.y[i]); if (nc === a.cell) continue;
    const np = cellProv(nc);
    if (np >= 0 && np !== a.prov) {
      const rt = provReg(np);
      if (rt !== RID(a.region)) {
        if (a.owner === 'byz' && !canEnter('byz', rt)) { a.path = []; a.route = null; a.pos = [R0.x[i - 1], R0.y[i - 1]]; return; }
        await stepArmy(a, rt); if (G.over) return;
        if (!G.armies.includes(a) || RID(a.region) !== rt) { a.path = []; a.route = null; return; }
      }
      a.prov = np;
    }
    a.cell = nc; a.pos = [R0.x[i], R0.y[i]];
    const foe = gridFoe(a, nc);
    if (foe) {
      const won = await fieldBattle(a, foe, R(provReg(np >= 0 ? np : a.prov) || a.region)); if (G.over) return;
      GRID.meets = (GRID.meets || 0) + 1; a.route = null; if (!won || !G.armies.includes(a)) { a.path = []; return; }
      return;   // после боя — новый расчёт пути на следующий день
    }
  }
  const [px, py] = routeAt(R0, t1); a.pos = [px, py];
  if (t1 >= R0.t[R0.t.length - 1]) { a.route = null; a.path = []; a.cell = a.goal != null ? a.goal : a.cell; }
}
function pathDays(a) { if (GRID.ok && a.path.length) { if (!a.route) { const r = planRoute(a, a.goal); if (r) { a.route = r; a.rt = 0; } } return Math.round(routeDaysLeft(a)); } const g = provGraph(); let s = 0, v = armyProv(a); for (const w of a.path) { const e = g.adj[v].find(x => x.to === w); s += e ? e.d : 0; v = w; } return s; }
function findPath(a, to) { const p = findProvPath(a, to); return p; }
// свой маршрут: продолжить путь от последней точки похода до новой провинции (Ctrl/Shift + щелчок)
function addWaypoint(a, to, prov, cell) {
  if (GRID.ok) return setArmyPath(a, to, prov, cell);   // сетка: приказ всегда в точку — путь пересчитывается напрямую
  const last = a.path.length ? a.path[a.path.length - 1] : armyProv(a);
  if (prov === last) return true;
  const p = findProvPath(a, to, prov, last); if (!p) return false;
  a.path = a.path.concat(p); return true;
}
// отряды между войсками в одной провинции
function armiesTogether(a, b) { return a !== b && a.owner === b.owner && !a.leg && !b.leg && !a.route && !b.route && (GRID.ok ? cellDist(armyCell(a), armyCell(b)) <= 2 : armyProv(a) === armyProv(b)); }
function transferUnits(from, to, idx) {
  const room = 12 - to.units.length, take = idx.slice().sort((x, y) => y - x).slice(0, Math.max(0, room));
  const moved = take.map(i => from.units.splice(i, 1)[0]).reverse(); to.units.push(...moved);
  if (!from.units.length) removeArmy(from);
  return moved.length;
}
function splitArmy(a, idx) {
  if (!idx.length || idx.length >= a.units.length) return null;
  if (a.owner === 'byz' && myArmies().length >= 2 + G.heroes.filter(h => h.role === 'general' && h.status === 'court').length) return null;
  const n = addArmy(a.owner, a.region, [], 'Войско ' + (myArmies().length + 1)); n.prov = armyProv(a); if (GRID.ok) n.cell = armyCell(a);
  transferUnits(a, n, idx); return n;
}
function setArmyPath(a, to, prov, cell) {
  to = RID(to); a.route = null;
  if (GRID.ok) {   // сетка: приказ в точку — клетка щелчка; щелчок по городу (или цель ИИ — регион) — к городу региона: осада/вход
    armyCell(a);
    const pg = provGraph(), goal = cell != null ? snapCell(cell, prov != null ? prov : cellProv(cell)) : (prov != null ? snapCell(cellAt(MAPINFO.provs[prov][1], MAPINFO.provs[prov][2]), prov) : cityCell(to));
    const gp = cellProv(goal); if (gp < 0) return false;
    if (goal === a.cell) { a.path = []; return true; }
    if (pg.reg[gp] !== RID(a.region) && !canEnter(a.owner, pg.reg[gp])) return false;
    a.goal = goal; a.path = [gp];   // a.path — только для подписи «поход в …» и признака «в пути»
    const r = planRoute(a, goal); if (!r) { a.path = []; return false; }
    a.route = r; a.rt = 0; return true;
  }
  if (to === RID(a.region) && (prov == null || prov === armyProv(a))) { a.path = []; return true; }
  if (to !== RID(a.region) && !canEnter(a.owner, to)) return false;
  const p = findProvPath(a, to, prov); if (!p) return false;
  a.path = p; return true;
}
function recruitCost(t) { let c = UNIT[t].cost; if (t === 'inf' && G.laws.pronoia) c *= 1.2; return Math.round(c); }
function canRecruit(a) { const r = R(a.region); return a.owner === 'byz' && r.owner === 'byz' && !armiesIn(a.region).some(x => atWar('byz', x.owner)) && a.units.length < 12; }
function recruit(a, t) {
  const c = recruitCost(t);
  if (!canRecruit(a) || G.treasury < c) return false;
  if (t !== 'merc') { const r = R(a.region); if (r.pop < 20) return false; r.pop -= UNIT[t].men / 1000 * 0.5; }
  G.treasury -= c; const u = mkUnit(t); u.men = Math.round(u.men * 0.8); a.units.push(u); return true;
}
function newArmyAt(rid) {
  if (R(rid).owner !== 'byz' || G.treasury < 30) return null;
  if (myArmies().length >= 2 + Math.floor(G.heroes.filter(h => h.role === 'general' && h.status === 'court').length)) return null;
  G.treasury -= 10;
  const a = addArmy('byz', rid, [], 'Войско ' + (myArmies().length + 1));
  return a;
}
function upkeepOf(a) { return a.units.reduce((s, u) => s + u.men / 100 * UNIT[u.type].up, 0) * BAL.upkeepMul; }

/* --- герои --- */
function makeHero(role, opt = {}) {
  const lvl = opt.level || ri(1, 2);
  const traits = opt.traits || (() => { const t = [pick(TRAIT_LIST)]; let b; do b = pick(TRAIT_LIST); while (b === t[0]); if (rnd() < 0.7) t.push(b); return t; })();
  const h = {
    id: G.nextId++, name: opt.name || (pick(FIRST) + ' ' + pick(LAST)), role, level: lvl, xp: 0,
    sk: [clamp(ri(1, 2) + Math.floor(lvl / 2), 1, 5), clamp(ri(1, 2) + Math.floor(lvl / 3), 1, 5)],
    traits, loyalty: ri(55, 80), age: opt.age || ri(25, 45),
    desc: opt.desc || ('Ромей, ' + pick(ROLE_DESC[role]) + '.'), status: 'court', mission: null, slot: -1, hist: !!opt.hist,
    until: opt.until || 9999,
  };
  if (traits.includes('Верный')) h.loyalty = 90;
  return h;
}
function makeHistHero(d) { return makeHero(d[1], { name: d[0], level: d[2], traits: d[3], desc: d[4], hist: true, until: d[6], age: ri(30, 45) }); }
function has(h, t) { return h.traits.includes(t); }
function heroPow(h, k = 0) {
  let p = h.sk[k] + h.level * 0.5;
  if (has(h, 'Честолюбивый')) p *= 1.1; if (has(h, 'Пьяница')) p *= 0.9;
  return p;
}
function courtHeroes() { return G.heroes.filter(h => h.status === 'court'); }
const COUNCIL = 7;
function refreshCandidates() {
  const used = new Set(G.heroes.map(h => h.name).concat(G.flags.usedHist || []));
  const hist = HIST_HEROES.filter(h => h[5] <= G.year && h[6] > G.year + 2 && !used.has(h[0]));
  G.candidates = [];
  if (hist.length) G.candidates.push(makeHistHero(pick(hist)));
  const roles = Object.keys(ROLES);
  while (G.candidates.length < 3) G.candidates.push(makeHero(pick(roles)));
}
function hireCost(h) { return 20 + h.level * 12 + (h.hist ? 15 : 0); }
function hire(i) {
  const h = G.candidates[i]; if (!h) return false;
  if (courtHeroes().length >= COUNCIL || G.treasury < hireCost(h)) return false;
  G.treasury -= hireCost(h);
  const taken = new Set(courtHeroes().map(x => x.slot));
  for (let s = 0; s < COUNCIL; s++) if (!taken.has(s)) { h.slot = s; break; }
  G.heroes.push(h); G.candidates.splice(i, 1);
  if (h.hist) (G.flags.usedHist = G.flags.usedHist || []).push(h.name);
  log(`${h.name} (${ROLES[h.role].name}) принят в совет.`);
  return true;
}
function dismiss(h) {
  if (h.role === 'general') unassignGeneral(h);
  h.status = 'gone'; h.mission = null; log(`${h.name} удалён от двора.`);
  if (h.loyalty < 40 && has(h, 'Честолюбивый')) { G.order -= 3; log(`Обиженный ${h.name} плетёт заговоры. Порядок −3.`); }
}
function assignGeneral(h, a) {
  unassignGeneral(h);
  const old = genOf(a); if (old && old.id) old.mission = null;
  a.gen = h.id; h.mission = { type: 'army', target: a.id };
}
function unassignGeneral(h) { G.armies.forEach(a => { if (a.gen === h.id) a.gen = null; }); if (h.mission && h.mission.type === 'army') h.mission = null; }
function heroArmy(h) { return G.armies.find(a => a.gen === h.id); }
// поручения для каждой роли: [тип, подпись, нужна цель: 'region'|'enemyRegion'|'faction'|'trade'|null]
const MISSIONS = {
  general: [['army', 'Командовать армией', 'army'], ['train', 'Обучать войска в столице', null]],
  merchant: [['trade', 'Торговать', 'trade']],
  governor: [['govern', 'Управлять областью', 'region']],
  priest: [['preach', 'Проповедовать в области', 'region'], ['church', 'Укреплять Церковь', null], ['union', 'Переговоры об унии', null]],
  spy: [['scout', 'Разведка', 'faction'], ['bribe', 'Подкупить гарнизон', 'enemyRegion'], ['sabotage', 'Посеять смуту', 'faction'], ['counter', 'Охранять двор', null]],
  diplomat: [['relations', 'Улучшать отношения', 'faction'], ['peace', 'Добиться мира', 'faction'], ['alliance', 'Заключить союз', 'faction'], ['marriage', 'Брачный союз', 'faction']],
};
function setMission(h, type, target) {
  if (h.role === 'general' && type !== 'army') unassignGeneral(h);
  if (type === 'govern' && G.heroes.some(x => x !== h && x.status === 'court' && x.mission && x.mission.type === 'govern' && x.mission.target === target)) return false;
  if (type === 'bribe') { if (G.treasury < 30) return false; G.treasury -= 30; }
  if (type === 'marriage') { if (G.treasury < 40 || G.factions[target].married) return false; G.treasury -= 40; }
  h.mission = { type, target, t: 0 };
  return true;
}
function missionText(h) {
  const m = h.mission; if (!m) return 'без поручения';
  const lab = (MISSIONS[h.role].find(x => x[0] === m.type) || [0, m.type])[1];
  let tg = '';
  if (m.type === 'army') { const a = G.armies.find(x => x.id === m.target); tg = a ? a.name : ''; }
  else if (m.type === 'trade') tg = m.target === 'genoa' ? 'с Генуей' : m.target === 'venice' ? 'с Венецией' : 'в Трапезунде';
  else if (m.target && G.regions[m.target]) tg = RNAME[m.target];
  else if (m.target && FACTIONS[m.target]) tg = fshort(m.target);
  return lab + (tg ? ': ' + tg : '');
}
function gainXp(h, x) {
  if (has(h, 'Талантливый')) x *= 1.5;
  h.xp += x;
  while (h.xp >= h.level * 60 && h.level < 10) {
    h.xp -= h.level * 60; h.level++;
    const k = rnd() < 0.5 ? 0 : 1; if (h.sk[k] < 5) h.sk[k]++; else if (h.sk[1 - k] < 5) h.sk[1 - k]++;
    log(`${h.name} достиг ${h.level}-го уровня.`);
  }
}
function heroGone(h, how, captor) {
  if (h.role === 'general') unassignGeneral(h);
  h.mission = null;
  if (how === 'captive') { h.status = 'captive'; h.captor = captor; h.ransom = 30 + h.level * 15; }
  else h.status = how;
}

/* --- экономика --- */
const TAX = { low: { m: 0.8, mood: 4, name: 'Низкие' }, normal: { m: 1, mood: 0, name: 'Обычные' }, high: { m: 1.25, mood: -6, name: 'Высокие' }, extreme: { m: 1.5, mood: -14, name: 'Непосильные' } };
function governorOf(rid) { return G.heroes.find(h => h.status === 'court' && h.mission && h.mission.type === 'govern' && h.mission.target === rid); }
function regionIncome(r) {
  if (r.owner !== 'byz') return 0;
  let inc = r.wealth * (0.5 + r.mood / 200) * TAX[G.tax].m;
  const gv = governorOf(r.id);
  if (gv) { inc *= 1 + 0.05 + heroPow(gv, 0) * 0.04; if (has(gv, 'Щедрый')) inc *= 0.92; }
  if (r.siege || armiesIn(r.id).some(a => atWar('byz', a.owner))) inc *= 0.3;
  inc *= 1 - Math.min(0.6, r.devast / 100);
  return inc * BAL.incomeMul * (1 + ruler().stw * 0.02);
}
function tradeIncome(h) {
  const f = h.mission.target, fac = G.factions[f];
  if (!fac || fac.war) return 0;
  let v = (4 + heroPow(h, 0) * 2.5) * (1 + fac.rel / 200) * (G.coin / 15);
  if (G.fleet === 0) v *= 0.85;
  if (f === 'genoa' && G.laws.genoapriv) v *= 1.3;
  if (G.laws.grain) v *= 0.8;
  if (f === 'trebizond' && R('trebiz').owner !== 'trebizond') v *= 0.5;
  if (has(h, 'Жадный')) v *= 1.1;
  return v;
}
function computeIncome() {
  const I = { regions: 0, customs: 0, trade: 0, laws: 0, army: 0, fleet: 0, heroes: 0, build: 0 };
  myRegions().forEach(r => I.regions += regionIncome(r));
  if (G.laws.monktax) I.laws += I.regions * 0.08;
  if (G.laws.pronoia) I.laws -= I.regions * 0.05;
  if (G.laws.akritai) I.laws -= 8;
  if (G.laws.judges) I.laws -= 6;
  if (R('konst').owner === 'byz') I.customs = 22 * (G.coin / 15) * (G.laws.genoapriv ? 0.72 : 1) * (G.laws.grain ? 0.85 : 1) * (G.flags.galata ? 0.85 : 1);
  courtHeroes().forEach(h => { if (h.role === 'merchant' && h.mission && h.mission.type === 'trade') I.trade += tradeIncome(h); });
  myArmies().forEach(a => I.army -= upkeepOf(a));
  I.fleet = -BAL.fleetCost[G.fleet];
  courtHeroes().forEach(h => I.heroes -= 2 + h.level * 0.8);
  const gross = I.regions + I.customs + I.trade + Math.max(0, I.laws);
  I.build = -Math.max(0, gross * G.build.share / 100);
  I.total = I.regions + I.customs + I.trade + I.laws + I.army + I.fleet + I.heroes + I.build;
  return I;
}
function economy() {
  const I = computeIncome(); G.lastIncome = I;
  G.treasury += I.total;
  G.build.fund += -I.build;
  doBuilding();
  if (G.treasury < 0) {
    const deep = G.treasury < -150;
    G.order -= deep ? 4 : 2; G.prestige -= deep ? 1 : 0;
    let left = 0;
    myArmies().forEach(a => {
      const n0 = a.units.length;
      a.units = a.units.filter(u => !(rnd() < (u.type === 'merc' ? 0.35 : deep ? 0.22 : 0.1)));
      left += n0 - a.units.length;
    });
    if (left) log(`Казна пуста: ${left} отр. разбежались, не получив жалованья.`, 'imp');
  }
}
function borderRegion(r) { return NEIGH[r.id].some(n => R(n.to).owner !== 'byz'); }
function doBuilding() {
  const b = G.build;
  for (let guard = 0; guard < 3; guard++) {
    if (b.prio === 'forts') {
      const c = myRegions().filter(r => borderRegion(r) && r.fort < 5 && r.id !== 'konst').sort((x, y) => x.fort - y.fort)[0];
      if (!c) { b.prio = 'econ'; continue; }
      const cost = 30 * (c.fort + 1); if (b.fund < cost) return;
      b.fund -= cost; c.fort++; log(`Укрепления в области ${RNAME[c.id]} достроены (ур. ${c.fort}).`);
    } else if (b.prio === 'econ') {
      const c = myRegions().filter(r => r.dev < 5).sort((x, y) => x.dev - y.dev || y.mood - x.mood)[0];
      if (!c) return; const cost = 40 + c.dev * 20; if (b.fund < cost) return;
      b.fund -= cost; c.dev++; c.wealth += 2; log(`В области ${RNAME[c.id]} построены дороги и мельницы: доход +2.`);
    } else if (b.prio === 'church') {
      if (b.fund < 45) return; b.fund -= 45; G.church = clamp(G.church + 3, 0, 100);
      const c = pick(myRegions()); if (c) c.mood = clamp(c.mood + 6, 0, 100); log('Восстановлен храм. Церковь +3.');
    } else if (b.prio === 'walls') {
      const k = R('konst'); if (k.owner !== 'byz') { b.prio = 'forts'; continue; }
      if (b.fund < 60) return; b.fund -= 60;
      if (k.fort < 6) { k.fort++; log('Стены Константинополя подновлены.'); } else { k.garrison += 150; G.order += 1; }
    }
  }
}
function manualBuild(r, what) {
  if (r.owner !== 'byz') return false;
  const cost = what === 'fort' ? 30 * (r.fort + 1) + 10 : what === 'econ' ? 50 + r.dev * 20 : 12;
  if (G.treasury < cost) return false;
  if (what === 'fort' && r.fort >= (r.id === 'konst' ? 6 : 5)) return false;
  if (what === 'econ' && r.dev >= 5) return false;
  G.treasury -= cost;
  if (what === 'fort') r.fort++; else if (what === 'econ') { r.dev++; r.wealth += 2; } else r.garrison += 200;
  return true;
}
function buildCost(r, what) { return what === 'fort' ? 30 * (r.fort + 1) + 10 : what === 'econ' ? 50 + r.dev * 20 : 12; }
function garCap(r) { return (r.id === 'konst' ? 1200 : 200) + r.fort * 150; }

/* --- области --- */
function updateRegions() {
  const greekChurch = (G.church - 50) / 8;
  for (const r of Object.values(G.regions)) {
    const hostileHere = armiesIn(r.id).some(a => atWar(r.owner, a.owner));
    if (r.owner === 'byz') {
      const greek = GREEK_REGIONS.includes(r.id);
      let t = 28 + G.order * 0.35 + TAX[G.tax].mood + (greek ? 6 + greekChurch : -6);
      if (G.union === 'accepted' && greek) t -= 9;
      if (G.laws.grain) t += 2; if (G.laws.judges) t += 3;
      if (ANATOLIA.includes(r.id) && G.laws.akritai) t += 4;
      if (G.coin < 12) t -= (12 - G.coin) * 1.5;
      if (G.treasury < 0) t -= 6;
      const gv = governorOf(r.id);
      if (gv) { t += 3 + heroPow(gv, 1) * 1.5; if (has(gv, 'Жестокий')) t -= 8; if (has(gv, 'Щедрый')) t += 5; }
      if (hostileHere) t -= 12;
      t -= r.devast / 5;
      r.mood += (t - r.mood) * 0.18;
    } else {
      r.mood += (55 - r.mood) * 0.06;
    }
    r.mood = clamp(r.mood, 0, 100);
    r.devast = Math.max(0, r.devast - 4);
    if (!hostileHere) {
      const cap = garCap(r) * (r.owner === 'byz' ? 1 : 1.1);
      if (r.garrison < cap) r.garrison = Math.min(cap, r.garrison + cap * 0.07);
      r.siege = 0;
    }
    r.pop = clamp(r.pop * (1 + (r.mood - 40) / 20000), 5, 400);
    // бунты
    if (r.owner === 'byz' && r.mood < 20 && r.id !== 'konst' && !hostileHere && rnd() < 0.12) {
      r.owner = 'rebel'; r.garrison = Math.max(r.garrison, 300); r.mood = 40; G.order -= 4; G.stats.lostR++;
      log(`Восстание в области ${RNAME[r.id]}! Жители перестали подчиняться Городу.`, 'imp');
      dropGovernor(r.id);
    } else if (r.owner === 'rebel' && !hostileHere && G.order > 55 && rnd() < 0.04 && !G.flags.civilwar) {
      r.owner = 'byz'; r.mood = 45; log(`Область ${RNAME[r.id]} добровольно вернулась под власть василевса.`, 'imp');
    }
  }
  G.order = clamp(G.order + (52 + ruler().stw * 2 - G.order) * 0.04 - (G.flags.civilwar ? 1.2 : 0) + (G.laws.pronoia ? 0.3 : 0) + (G.laws.judges ? 0.4 : 0), 0, 100);
  if (G.laws.monktax) G.church = clamp(G.church - 1, 0, 100);
  G.church = clamp(G.church + (45 + ruler().pie * 2 - G.church) * 0.02, 0, 100);
  if (G.church < 20) G.order -= 1;
  G.prestige = clamp(G.prestige + (30 - G.prestige) * 0.01, 0, 100);
}
function dropGovernor(rid) { rid = RID(rid); const gv = governorOf(rid); if (gv) gv.mission = null; }

/* --- захват областей и осады --- */
function siegeTurns(r) { return [1, 2, 3, 4, 5, 7, 9][r.fort] || 2; }
function capture(r, by) {
  const old = r.owner;
  r.owner = by; r.siege = 0; r.garrison = 150; r.devast = 30;
  r.mood = by === 'byz' ? (GREEK_REGIONS.includes(r.id) ? 45 : 28) : 30;
  dropGovernor(r.id);
  G.armies.forEach(a => { if (a.region === r.id) a.siege = 0; });
  if (by === 'byz') { G.stats.gained++; G.prestige = clamp(G.prestige + 4, 0, 100); log(`Наши войска взяли область ${RNAME[r.id]} у: ${fshort(old)}.`, 'imp'); if (G.factions[old]) G.factions[old].weary += 6; }
  else if (old === 'byz') {
    G.stats.lostR++; G.prestige = clamp(G.prestige - 4, 0, 100); G.order -= 2;
    log(`Область ${RNAME[r.id]} потеряна — её взяли ${fshort(by)}.`, 'imp');
    if (r.id === 'konst') { G.over = 'konst'; }
  } else log(`${fshort(by)} захватили область ${RNAME[r.id]} (прежде: ${fshort(old)}).`);
  if (myRegions().length > G.stats.peakRegions) G.stats.peakRegions = myRegions().length;
}
async function processSieges() {
  for (const r of Object.values(G.regions)) {
    const bes = G.armies.filter(a => a.region === r.id && atWar(a.owner, r.owner) && nearCity(a, r.id));   // осада — у города (на сетке)
    if (!bes.length) continue;
    // защитники-армии в области: сначала бой (обычно уже был при входе)
    if (G.armies.some(a => a.region === r.id && a.owner === r.owner)) continue;
    const seaSupply = r.id === 'konst' && r.owner === 'byz' && (G.fleet > 0 || !G.factions.genoa.war || !G.factions.venice.war);
    if (seaSupply) {
      r.garrison *= 0.97; r.mood -= 3; r.devast = Math.min(100, r.devast + 5); bes.forEach(a => a.siege = 0);
      if (!G.flags.seaSupplyMsg) { G.flags.seaSupplyMsg = true; log('Константинополь осаждён, но хлеб идёт морем: голодом Город не взять — только штурмом.', 'imp'); }
      continue;
    }
    r.siege++;
    r.garrison *= 0.9; r.mood -= 4; r.devast = Math.min(100, r.devast + 8);
    const hunger = r.garrison < 60;
    if (r.siege >= siegeTurns(r) || hunger) {
      const by = bes[0].owner;
      log(`${RNAME[r.id]}: после ${r.siege} сезонов осады гарнизон сдался.`);
      capture(r, by); bes.forEach(a => a.siege = 0);
    } else bes.forEach(a => a.siege = r.siege);
  }
}

/* --- бои на стратегической карте --- */
function garrisonUnits(r) {
  const out = []; let g = Math.round(r.garrison);
  let inf = Math.round(g * 0.6), arch = g - inf;
  while (inf > 0) { const m = Math.min(400, inf); out.push({ type: 'inf', men: m }); inf -= m; }
  while (arch > 0) { const m = Math.min(300, arch); out.push({ type: 'arch', men: m }); arch -= m; }
  return out.slice(0, 10);
}
function sideFromArmy(a) {
  const g = genOf(a);
  return {
    faction: a.owner, name: a.name, color: FACTIONS[a.owner].color, player: a.owner === 'byz',
    units: a.units.map(u => ({ type: u.type, men: u.men, xp: u.xp })),
    general: g ? { name: g.name, tactics: g.skill != null ? g.skill : g.sk[0] + g.level * 0.3, leader: g.skill != null ? g.skill : g.sk[1] + g.level * 0.3, brave: g.traits ? has(g, 'Храбрый') : false, careful: g.traits ? has(g, 'Осторожный') : false } : null,
    ruler: a.owner === 'byz' ? ruler().mar : 0,
  };
}
function battleInput(att, defA, r, storm) {
  const A = sideFromArmy(att);
  let D;
  if (defA) D = sideFromArmy(defA);
  else D = { faction: r.owner, name: 'Гарнизон: ' + RNAME[r.id], color: FACTIONS[r.owner].color, player: r.owner === 'byz', units: garrisonUnits(r), general: null, ruler: 0 };
  return { attacker: A, defender: D, terrain: storm ? 'walls' : (r.ter === 'walls' ? 'plain' : r.ter), fort: storm ? r.fort : 0, place: RNAME[r.id], date: dateStr(), storm: !!storm };
}
let battleHook = null; // интерфейс подменяет: открывает экран боя
async function runBattle(input) {
  const interactive = !HEADLESS && (input.attacker.player || input.defender.player) && battleHook;
  if (interactive) return await battleHook(input);
  return Battle.autoResolve(input);
}
function applySurvivors(a, survivors, won) {
  a.units = survivors.filter(s => s.men >= 20).map(s => ({ type: s.type, men: Math.round(s.men), max: UNIT[s.type].men, xp: Math.min(10, (s.xp || 0) + (won ? 1 : 0.5)) }));
}
function generalFate(a, fate) {
  const g = genOf(a); if (!g || !fate || fate === 'ok') return;
  if (g.id) {
    if (fate === 'killed') { log(`${g.name} пал в бою.`, 'imp'); heroGone(g, 'dead'); }
    else if (fate === 'captured') {
      const captor = G.lastEnemy || 'seljuk';
      log(`${g.name} попал в плен.`, 'imp'); heroGone(g, 'captive', captor);
    }
  } else if (fate !== 'ok') { a.gen = { name: aiGeneralName(a.owner), skill: ri(1, 3) }; }
}
function retreatArmy(a, from) {
  const opts = NEIGH[from].filter(n => linkOk(a.owner, n.t) && R(n.to).owner === a.owner && !G.armies.some(x => x.region === n.to && atWar(x.owner, a.owner)));
  if (!opts.length) {
    log(`${a.name} (${fshort(a.owner)}) окружено и рассеяно.`);
    removeArmy(a); return false;
  }
  a.region = pick(opts).to; a.path = []; a.siege = 0; return true;
}
function removeArmy(a) {
  const g = genOf(a);
  if (g && g.id) { if (rnd() < 0.5) { heroGone(g, 'captive', G.lastEnemy || 'rebel'); log(`${g.name} попал в плен.`); } else unassignGeneral(g); }
  G.armies = G.armies.filter(x => x !== a);
}
function heroXpBattle(a, won) { const g = genOf(a); if (g && g.id) gainXp(g, won ? 40 : 15); }
async function fieldBattle(att, def, r) {
  G.lastEnemy = att.owner === 'byz' ? def.owner : att.owner;
  const input = battleInput(att, def, r, false);
  const res = await runBattle(input);
  const aWon = res.winner === 'attacker';
  applySurvivors(att, res.attacker.survivors, aWon); applySurvivors(def, res.defender.survivors, !aWon);
  generalFate(att, res.attacker.generalFate); generalFate(def, res.defender.generalFate);
  heroXpBattle(att, aWon); heroXpBattle(def, !aWon);
  battleStats(att.owner, def.owner, aWon, input.place, res);
  if (!att.units.length) removeArmy(att);
  if (!def.units.length) removeArmy(def);
  if (aWon) { if (G.armies.includes(def)) retreatArmy(def, r.id); }
  return aWon;
}
async function stormBattle(att, r) {
  G.lastEnemy = att.owner === 'byz' ? r.owner : att.owner;
  const input = battleInput(att, null, r, true);
  const res = await runBattle(input);
  const aWon = res.winner === 'attacker';
  applySurvivors(att, res.attacker.survivors, aWon);
  generalFate(att, res.attacker.generalFate); heroXpBattle(att, aWon);
  r.garrison = res.defender.survivors.reduce((s, u) => s + u.men, 0);
  battleStats(att.owner, r.owner, aWon, input.place + ' (штурм)', res);
  if (!att.units.length) removeArmy(att);
  if (aWon) capture(r, att.owner);
  att.stormed = true;
  return aWon;
}
function battleStats(a, d, aWon, place, res) {
  const lossA = res.attacker.lost, lossD = res.defender.lost;
  const txt = `Битва: ${place}. ${fshort(a)} против ${fshort(d)} — победа ${aWon ? fshort(a) : fshort(d)}. Потери: ${fmt(lossA)} и ${fmt(lossD)}.`;
  const mine = a === 'byz' || d === 'byz';
  log(txt, mine ? 'imp' : '');
  if (mine) {
    const won = (a === 'byz') === aWon;
    if (won) { G.stats.won++; G.prestige = clamp(G.prestige + 3, 0, 100); const o = a === 'byz' ? d : a; if (G.factions[o]) G.factions[o].weary += 4; }
    else { G.stats.lost++; G.prestige = clamp(G.prestige - 3, 0, 100); }
  }
}
// перемещение одной армии на соседнюю область (с боем, если нужно)
async function stepArmy(a, to) {
  if (!G.armies.includes(a)) return;
  const r = R(to);
  const enemies = GRID.ok ? [] : G.armies.filter(x => x.region === to && atWar(a.owner, x.owner));   // на сетке бой — при встрече (соседние клетки)
  if (enemies.length) {
    const def = enemies.sort((x, y) => armyPower(y) - armyPower(x))[0];
    const won = await fieldBattle(a, def, r);
    if (!won || !G.armies.includes(a)) { a.path = []; return; }
    if (G.armies.some(x => x.region === to && atWar(a.owner, x.owner))) { a.path = []; return; }
  }
  a.region = to; a.moved = true; a.siege = 0;
  if (atWar(a.owner, r.owner) && r.garrison < 40) capture(r, a.owner);
}
// перевал: войско задерживается на нём на один сезон
function crossPass(a, to) {
  const lk = NEIGH[a.region].find(n => n.to === to);
  if (lk && lk.t === 'pass' && a.passWait !== to) { a.passWait = to; if (a.owner === 'byz') log(`${a.name} поднимается на перевал: путь в регион «${RNAME[to]}» займёт лишний сезон.`); return true; }
  a.passWait = null; return false;
}
async function movePlayerArmies() {
  for (const a of myArmies().slice()) {
    if (!a.path.length || !G.armies.includes(a)) continue;
    const nxt = a.path[0];
    if (!canEnter('byz', nxt)) { a.path = []; continue; }
    if (crossPass(a, nxt)) continue;
    a.path.shift();
    await stepArmy(a, nxt);
    if (G.over) return;
  }
}
async function playerStorm(a) {
  const r = R(a.region);
  if (!atWar('byz', r.owner) || a.stormed || !nearCity(a, r.id)) return false;   // штурм — только у города
  await stormBattle(a, r);
  return true;
}

/* --- ИИ держав --- */
function factionAlive(f) { return Object.values(G.regions).some(r => r.owner === f) || G.armies.some(a => a.owner === f); }
function aiIncome(f) {
  let inc = Object.values(G.regions).filter(r => r.owner === f).reduce((s, r) => s + r.wealth * (0.5 + r.mood / 200), 0) * BAL.aiIncomeMul;
  inc += G.factions[f].bonus || 0;
  return inc;
}
function aiStaging(f, enemyOf) {
  // своя область, граничащая с врагом
  const own = Object.values(G.regions).filter(r => r.owner === f);
  const front = own.filter(r => NEIGH[r.id].some(n => linkOk(f, n.t) && atWar(f, R(n.to).owner)));
  return (front.length ? pick(front) : pick(own)) || null;
}
function aiWars(f) { return Object.keys(FACTIONS).filter(o => atWar(f, o) && factionAlive(o)); }
function defPower(rid, owner) {
  const r = R(rid);
  let p = G.armies.filter(a => a.region === rid && atWar(owner, a.owner)).reduce((s, a) => s + armyPower(a), 0);
  if (atWar(owner, r.owner)) p += garPower(r) * 0.6;
  return p;
}
async function aiTurn() {
  for (const f of Object.keys(FACTIONS)) {
    if (f === 'byz' || !factionAlive(f)) continue;
    const F = G.factions[f], D = FACTIONS[f];
    const myArm = G.armies.filter(a => a.owner === f);
    F.treasury += aiIncome(f) - myArm.reduce((s, a) => s + upkeepOf(a) * 0.6, 0);
    if (F.truce > 0) F.truce--;
    const wars = aiWars(f);
    // объявление войны ромеям
    if (!F.war && F.truce === 0 && !F.ally && f !== 'genoa' && F.rel < -35 && rnd() < (D.aggr || 0.2) * 0.05 && Object.values(G.regions).some(r => r.owner === f && NEIGH[r.id].some(n => R(n.to).owner === 'byz'))) {
      F.war = true; F.weary = 0; log(`${fname(f)} объявляет войну ромеям!`, 'imp');
    }
    if (F.war) F.weary += 0.5;
    F.rel += ((D.rel || 0) - F.rel) * 0.02 + (F.married ? 0.4 : 0);
    // предложение мира
    if (F.war && f !== 'rebel' && F.weary > 14 && rnd() < 0.12) {
      G.pendingPeace = G.pendingPeace || []; if (!G.pendingPeace.includes(f)) G.pendingPeace.push(f);
    }
    if (!wars.length) continue;
    // набор войск
    const cap = D.trade ? 1 : Math.max(1, Math.min(4, Math.ceil(Math.min(F.start || 2, Object.values(G.regions).filter(r => r.owner === f).length + 1) / 2))) + (f === 'osman' && G.year > 1320 ? 1 : 0);
    let guard = 0;
    while (F.treasury > 30 && guard++ < 6) {
      let a = myArm.filter(x => x.units.length < 10 && R(x.region).owner === f).sort((x, y) => y.units.length - x.units.length)[0];
      if (!a && myArm.length < cap) { const st = aiStaging(f); if (!st) break; a = addArmy(f, st.id, []); myArm.push(a); }
      if (!a) break;
      const mix = D.mix || [3, 2, 2, 1], tot = mix.reduce((s, v) => s + v, 0);
      let x = rnd() * tot, t = 'inf';
      for (let i = 0; i < 4; i++) { x -= mix[i]; if (x <= 0) { t = UTYPES[i]; break; } }
      F.treasury -= UNIT[t].cost; a.units.push(mkUnit(t));
    }
  }
}
// походы ИИ: раз в неделю каждое свободное войско выбирает цель (дорога займёт дни)
const AI_EVERY = 7;
async function aiMoves() {
  for (const f of Object.keys(FACTIONS)) {
    if (f === 'byz' || !factionAlive(f) || !aiWars(f).length) continue;
    const F = G.factions[f], D = FACTIONS[f];
    const myArm = G.armies.filter(a => a.owner === f);
    // движение
    for (const a of myArm.slice()) {
      if (!G.armies.includes(a) || !a.units.length) { if (!a.units.length) G.armies = G.armies.filter(x => x !== a); continue; }
      if (a.leg || a.path.length || a.route) continue;   // уже в пути
      const here = R(a.region);
      const pow = armyPower(a);
      if (atWar(f, here.owner) && !nearCity(a, here.id)) { setArmyPath(a, here.id); continue; }   // на сетке: сначала дойти до города
      if (atWar(f, here.owner)) {
        // осада: штурм или ждём
        const gp = garPower(here) * (1 + here.fort * 0.35);
        if (pow > gp * 2.0 && rnd() < 1 - Math.pow(1 - (0.6 + (D.aggr || 0) * 0.3), AI_EVERY / SEASON_DAYS)) await stormBattle(a, here);
        continue;
      }
      if (a.units.length < 3 && rnd() < Math.pow(0.7, AI_EVERY / SEASON_DAYS)) continue;   // малые отряды выходят редко (как раньше — раз в сезон с вероятностью 0,3)
      let best = null, bs = 0;
      for (const n of NEIGH[a.region]) {
        if (!linkOk(f, n.t)) continue;
        const o = R(n.to).owner;
        const hostileArmy = G.armies.some(x => x.region === n.to && atWar(f, x.owner));
        if (!atWar(f, o) && !hostileArmy) continue;
        if (!atWar(f, o) && o !== f) continue;
        const dp = defPower(n.to, f) + 1;
        let s = pow / dp;
        if (o === 'byz' && n.to === 'konst') s *= 0.5;
        if (o === f) s *= 1.4; // освободить свою землю
        if (s > bs) { bs = s; best = n.to; }
      }
      const ownedNow = Object.values(G.regions).filter(r => r.owner === f).length;
      const extra = Math.max(0, ownedNow - (F.start || 2));
      let need = (1.75 - (D.aggr || 0.3) * 0.7) * (1 + extra * (f === 'osman' ? 0.12 : 0.4));
      if (extra >= (f === 'osman' ? 7 : 4) && best && R(best).owner !== f) best = null;
      if (best && D.trade && !SEA_PORTS.includes(best)) best = null;
      if (best && bs > need) setArmyPath(a, best);
      if (G.over) return;
    }
  }
}

/* --- герои за сезон --- */
function processHeroes() {
  const counter = courtHeroes().some(h => h.role === 'spy' && h.mission && h.mission.type === 'counter');
  for (const h of G.heroes.filter(x => x.status === 'court' || x.status === 'captive')) {
    if (G.season === 0) h.age++;
    if (h.status === 'captive') {
      if (rnd() < 0.03) { h.status = 'dead'; log(`${h.name} умер в плену.`); }
      else if (G.factions[h.captor] && !G.factions[h.captor].war && rnd() < 0.15) { h.status = 'court'; log(`${h.name} отпущен из плена после заключения мира.`); }
      continue;
    }
    // смерть от старости
    if (h.age > 55 && rnd() < (h.age - 55) * 0.004) { log(`${h.name} скончался в возрасте ${h.age} лет.`, 'imp'); heroGone(h, 'dead'); continue; }
    if (h.hist && G.year >= h.until && rnd() < 0.25) { log(`${h.name} покидает сцену истории.`); heroGone(h, 'dead'); continue; }
    // верность
    let dl = G.treasury > 0 ? 0.4 : -3;
    if (has(h, 'Честолюбивый')) dl -= 0.6; if (has(h, 'Жадный')) dl -= G.treasury > 0 ? 0.2 : 2;
    if (G.order < 30) dl -= 1; if (G.laws.pronoia) dl += 0.3; if (G.prestige > 60) dl += 0.3;
    if (G.flags.civilwar) dl -= 0.4;
    h.loyalty = clamp(h.loyalty + dl, has(h, 'Верный') ? 60 : 0, 100);
    if (h.loyalty < 25 && !has(h, 'Верный') && rnd() < (counter ? 0.03 : 0.08)) { betray(h); continue; }
    const m = h.mission;
    if (!m) continue;
    m.t = (m.t || 0) + 1;
    const p0 = heroPow(h, 0), p1 = heroPow(h, 1);
    switch (m.type) {
      case 'army': gainXp(h, 4); break;
      case 'train': gainXp(h, 6); myArmies().filter(a => a.region === 'konst').forEach(a => a.units.forEach(u => u.xp = Math.min(10, u.xp + 0.3))); break;
      case 'trade': gainXp(h, 8); if (G.factions[m.target]) G.factions[m.target].rel = clamp(G.factions[m.target].rel + p1 * 0.4, -100, 100);
        if (has(h, 'Жадный') && rnd() < 0.06) { const s = ri(10, 25); G.treasury -= s; log(`${h.name} прикарманил ${s} тыс. иперпиров.`); } break;
      case 'govern': gainXp(h, 8); if (R(m.target).owner !== 'byz') h.mission = null; else if (has(h, 'Жестокий')) G.order += 0.2; break;
      case 'preach': gainXp(h, 7); { const r = R(m.target); if (r.owner === 'byz') r.mood = clamp(r.mood + 1 + p0 * 0.6 * (has(h, 'Красноречивый') ? 1.15 : 1), 0, 100); else h.mission = null; } break;
      case 'church': gainXp(h, 7); G.church = clamp(G.church + 0.4 + p1 * 0.25 * (has(h, 'Набожный') ? 1.3 : 1), 0, 100); break;
      case 'union':
        gainXp(h, 7); if (G.union === 'accepted' || G.union === 'repudiated') { h.mission = null; break; }
        G.unionProg += 1 + p1 * 0.5; G.church = clamp(G.church - 0.6, 0, 100); G.anjou = Math.max(0, G.anjou - 0.8); G.union = 'talks'; break;
      case 'scout': gainXp(h, 6); break;
      case 'counter': gainXp(h, 5); break;
      case 'sabotage': gainXp(h, 8); {
        const F = G.factions[m.target]; F.treasury -= 6 + p1 * 3; if (rnd() < 0.2) G.armies.filter(a => a.owner === m.target).forEach(a => a.units.forEach(u => u.men *= 0.93));
        if (rnd() < 0.06 - p0 * 0.008) { log(`Шпион ${h.name} схвачен: ${fshort(m.target)}.`, 'imp'); heroGone(h, 'captive', m.target); }
      } break;
      case 'bribe': if (m.t >= 2) {
        const r = R(m.target);
        const ch = 0.25 + p1 * 0.06 - r.fort * 0.04 + (100 - r.mood) / 300 + (has(h, 'Хитрый') ? 0.1 : 0);
        if (r.owner !== 'byz' && rnd() < ch) {
          gainXp(h, 50);
          if (GREEK_REGIONS.includes(r.id) && r.mood < 55 && NEIGH[r.id].some(n => R(n.to).owner === 'byz') && rnd() < 0.5) { log(`Подкуп удался: ворота города ${RNAME[r.id]} открыты нашим людям!`, 'imp'); capture(r, 'byz'); }
          else { r.garrison *= 0.4; r.mood -= 15; log(`${h.name} подкупил часть гарнизона: ${RNAME[r.id]} почти беззащитна.`, 'imp'); }
        } else if (rnd() < 0.35 - p0 * 0.04) { log(`Заговор раскрыт! ${h.name} схвачен (${RNAME[r.id]}).`, 'imp'); heroGone(h, 'captive', r.owner); break; }
        else log(`${h.name} не смог подкупить гарнизон: ${RNAME[r.id]}.`);
        if (h.status === 'court') h.mission = null;
      } break;
      case 'relations': gainXp(h, 7); { const F = G.factions[m.target]; F.rel = clamp(F.rel + 1 + p0 * 0.5 + ruler().dip * 0.3 + (has(h, 'Красноречивый') ? 0.5 : 0), -100, 100);
        if (F.war && rnd() < 0.04) { log(`Дипломат ${h.name} задержан: ${fshort(m.target)}.`); heroGone(h, 'captive', m.target); } } break;
      case 'peace': if (m.t >= 2) {
        const F = G.factions[m.target], D = FACTIONS[m.target];
        if (!F.war) { h.mission = null; break; }
        const ch = 0.15 + p0 * 0.06 + (F.rel + 100) / 500 + F.weary * 0.02 + G.prestige / 400 + ruler().dip * 0.03 - (D.aggr || 0.3) * 0.25 + (has(h, 'Хитрый') || has(h, 'Красноречивый') ? 0.08 : 0);
        if (m.target !== 'rebel' && rnd() < ch) { makePeace(m.target); gainXp(h, 50); log(`${h.name} заключил мир с державой: ${fname(m.target)}.`, 'imp'); }
        else { log(`${h.name}: переговоры о мире с ${fshort(m.target)} провалились.`); F.rel -= 3; }
        h.mission = null;
      } break;
      case 'alliance': if (m.t >= 2) {
        const F = G.factions[m.target];
        const ch = F.war ? 0 : 0.1 + p0 * 0.05 + (F.rel - 30) / 150 + G.prestige / 300;
        if (rnd() < ch) { F.ally = true; F.rel = clamp(F.rel + 10, -100, 100); G.prestige += 3; gainXp(h, 50); log(`Союз с державой ${fname(m.target)} заключён.`, 'imp'); }
        else log(`${h.name}: ${fshort(m.target)} отказались от союза.`);
        h.mission = null;
      } break;
      case 'marriage': if (m.t >= 2) {
        const F = G.factions[m.target];
        const ch = F.war ? 0.15 : 0.45 + p0 * 0.05 + (F.rel + 50) / 300;
        if (rnd() < ch) { F.married = true; F.rel = clamp(F.rel + 30, -100, 100); G.prestige += 5; if (F.war && rnd() < 0.6) makePeace(m.target); gainXp(h, 60); log(`Брачный союз с державой ${fname(m.target)}: царевна отправилась к новому двору.`, 'imp'); }
        else { log(`${h.name}: сватовство к ${fshort(m.target)} отвергнуто. Приданое потеряно.`); }
        h.mission = null;
      } break;
    }
  }
  G.order = clamp(G.order, 0, 100);
}
function makePeace(f) { const F = G.factions[f]; F.war = false; F.truce = 8; F.weary = 0; F.rel = clamp(F.rel + 15, -100, 100); if (G.pendingPeace) G.pendingPeace = G.pendingPeace.filter(x => x !== f); }
function declareWar(f) { const F = G.factions[f]; if (F.war || f === 'rebel') return; F.war = true; F.ally = false; F.weary = 0; F.rel = clamp(F.rel - 30, -100, 100); G.prestige -= F.truce > 0 ? 8 : 0; F.truce = 0; log(`Мы объявили войну: ${fname(f)}.`, 'imp'); }
function betray(h) {
  const arm = h.role === 'general' ? heroArmy(h) : null;
  heroGone(h, 'traitor');
  if (h.role === 'general') {
    log(`Измена! Полководец ${h.name} перешёл к врагам.`, 'imp');
    if (arm && arm.units.length >= 2 && rnd() < 0.5) { arm.owner = 'rebel'; arm.name = 'Мятежники ' + (h.name.split(' ')[1] || ''); arm.gen = { name: h.name, skill: Math.round(h.sk[0]) }; arm.path = []; G.factions.rebel.war = true; log(`${h.name} увёл с собой войско!`, 'imp'); }
  } else if (h.role === 'governor') {
    const r = myRegions().filter(x => x.id !== 'konst' && x.mood < 60)[0];
    if (r) { r.owner = 'rebel'; log(`Изменник ${h.name} поднял мятеж: ${RNAME[r.id]} отложилась.`, 'imp'); }
    else log(`${h.name} бежал, прихватив налоговые описи.`, 'imp');
  } else if (h.role === 'merchant') { const s = ri(30, 60); G.treasury -= s; log(`Купец ${h.name} бежал к итальянцам, прихватив ${s} тыс. иперпиров.`, 'imp'); }
  else if (h.role === 'spy') { const r = pick(myRegions()); if (r) r.garrison *= 0.6; log(`Шпион ${h.name} продал наши секреты врагу.`, 'imp'); }
  else { G.prestige -= 5; log(`${h.name} бежал от двора и чернит имя императора.`, 'imp'); }
}

/* --- мир вокруг: набеги, рост бейликов, Анжу --- */
function worldTick() {
  const y = G.year;
  // рост османов и прочих бейликов
  if (factionAlive('osman')) G.factions.osman.bonus = (8 + Math.max(0, y - 1299) * 0.75) * BAL.osmanGrowth;
  ['aydin', 'karasi', 'menteshe', 'germiyan'].forEach(f => { if (factionAlive(f)) G.factions[f].bonus = 5 + Math.max(0, y - 1300) * 0.2; });
  if (factionAlive('serbia')) G.factions.serbia.bonus = y >= 1331 ? 26 : y >= 1282 ? 10 : 3;
  if (factionAlive('catalan')) G.factions.catalan.bonus = 22;
  if (factionAlive('anjou')) G.factions.anjou.bonus = G.flags.vespers ? 2 : 9;
  if (factionAlive('rebel')) G.factions.rebel.bonus = G.flags.civilwar ? 16 : 3;
  // угроза Карла Анжуйского
  if (y >= 1267 && !G.flags.vespers) G.anjou = clamp(G.anjou + (G.union === 'accepted' ? 0.4 : 1.4) - (G.prestige > 60 ? 0.3 : 0), 0, 100);
  // турецкие набеги на анатолийские земли
  const turkish = ['seljuk', 'rum_east', 'denizli', 'osman', 'germiyan', 'menteshe', 'aydin', 'karasi', 'candar'];
  const raid = BAL.raidBase + Math.max(0, y - 1275) * 0.0025;
  for (const r of myRegions().filter(r => ANATOLIA.includes(r.id))) {
    if (!NEIGH[r.id].some(n => turkish.includes(R(n.to).owner))) continue;
    let ch = raid * (G.laws.akritai ? 0.55 : 1) * (G.flags.civilwar ? 1.4 : 1);
    if (myArmies().some(a => a.region === r.id && a.gen)) ch *= 0.4;
    if (rnd() < ch) {
      const loss = ri(6, 16) + Math.max(0, y - 1290) * 0.15;
      r.devast = Math.min(100, r.devast + loss * 2); r.pop = Math.max(5, r.pop - loss / 3); r.mood -= 5; r.garrison *= 0.85;
      if (rnd() < 0.3) log(`Турецкий набег разорил область ${RNAME[r.id]}.`);
    }
  }
  // пираты, если нет флота
  if (G.fleet === 0 && rnd() < 0.25) {
    const isl = myRegions().filter(r => ['lesbos', 'chios', 'morea', 'thessal', 'smyrna', 'konst'].includes(r.id));
    const r = isl.length && pick(isl); if (r) { r.devast += 12; r.mood -= 4; G.treasury -= 6; if (rnd() < 0.4) log(`Пираты грабят побережье: ${RNAME[r.id]}. Флота, чтобы их остановить, у нас нет.`); }
  }
  if (G.fleetRebuild > 0) { G.fleetRebuild--; if (!G.fleetRebuild) { G.fleet = 1; log('Новый флот спущен на воду.', 'imp'); } }
}
