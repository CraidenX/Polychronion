
/* ---------- 2. ЯДРО СТРАТЕГИИ ---------- */
let G = null; // всё состояние партии (сохраняется целиком)
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
const fname = f => (G && G.fnames && G.fnames[f]) || FACTIONS[f].name;
const fshort = f => (G && G.fshort && G.fshort[f]) || FACTIONS[f].short;
const dateStr = (y = G.year, s = G.season) => SEASONS[s] + ' ' + y;
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
    lastIncome: {}, autoBattle: false, over: false, fnames: {}, fshort: {},
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
    osman: ['Осман', 'Орхан', 'Конур Альп', 'Акче Коджа', 'Абдуррахман', 'Сулейман-паша'], seljuk: ['Кылыч-Арслан', 'Масуд', 'Караман-бей'],
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
  if (a === b) return false;
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
function findPath(a, to) {
  const prev = { [a.region]: null }, q = [a.region];
  while (q.length) {
    const c = q.shift(); if (c === to) break;
    for (const n of NEIGH[c]) {
      if (n.to in prev || !linkOk(a.owner, n.t)) continue;
      if (n.to !== to && !canEnter(a.owner, n.to)) continue;
      if (n.to !== to && R(n.to).owner !== a.owner && n.to !== to) continue; // идём через свои земли
      prev[n.to] = c; q.push(n.to);
    }
  }
  if (!(to in prev)) return null;
  const path = []; let c = to; while (c !== a.region) { path.unshift(c); c = prev[c]; }
  return path;
}
function setArmyPath(a, to) {
  if (to === a.region) { a.path = []; return true; }
  if (!canEnter(a.owner, to)) return false;
  const p = findPath(a, to); if (!p) return false;
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
    const bes = G.armies.filter(a => a.region === r.id && atWar(a.owner, r.owner));
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
  const enemies = G.armies.filter(x => x.region === to && atWar(a.owner, x.owner));
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
  if (!atWar('byz', r.owner) || a.stormed) return false;
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
    // движение
    for (const a of myArm.slice()) {
      if (!G.armies.includes(a) || !a.units.length) { if (!a.units.length) G.armies = G.armies.filter(x => x !== a); continue; }
      const here = R(a.region);
      const pow = armyPower(a);
      if (atWar(f, here.owner)) {
        // осада: штурм или ждём
        const gp = garPower(here) * (1 + here.fort * 0.35);
        if (pow > gp * 2.0 && rnd() < 0.6 + (D.aggr || 0) * 0.3) await stormBattle(a, here);
        continue;
      }
      if (a.units.length < 3 && rnd() < 0.7) continue;
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
      if (best && bs > need && !crossPass(a, best)) await stepArmy(a, best);
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
  const turkish = ['seljuk', 'osman', 'germiyan', 'menteshe', 'aydin', 'karasi', 'candar'];
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
