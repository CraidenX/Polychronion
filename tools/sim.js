// Безголовый прогон партий: node sim.js [партий] [политика: smart|passive|random]
globalThis.__HEADLESS__ = true;
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/game.js', 'utf8');
vm.runInThisContext(src + `
globalThis.API = { get G(){return G}, newGame, runPrologue, endTurn, myArmies, myRegions, R, NEIGH, atWar, armyPower, garPower, setArmyPath, recruit, courtHeroes, hire, setMission, assignGeneral, genOf, computeIncome, playerStorm, factionAlive, FACTIONS, UNIT, linkOk, canEnter, defPower, newArmyAt, RNAME, setEvChooser: f => { eventChooser = f; }, BAL, siegeTurns, heroArmy, ANATOLIA, manualBuild };`);
const A = globalThis.API;
const N = +process.argv[2] || 10, POL = process.argv[3] || 'smart';
const LOGF = process.argv[4];

function smartTurn() {
  const G = A.G;
  // герои
  const court = A.courtHeroes();
  if (court.length < 7 && G.treasury > 110 && G.candidates.length) {
    const need = ['general', 'merchant', 'governor', 'spy', 'diplomat', 'priest'].find(r => court.filter(h => h.role === r).length < (r === 'general' ? 2 : 1));
    const i = Math.max(0, G.candidates.findIndex(h => h.role === need));
    A.hire(i);
  }
  for (const h of A.courtHeroes()) {
    if (h.role === 'general') { if (!A.heroArmy(h)) { const a = A.myArmies().filter(a => !a.gen).sort((x, y) => A.armyPower(y) - A.armyPower(x))[0]; if (a) A.assignGeneral(h, a); } continue; }
    if (h.mission && !['peace'].includes(h.mission.type)) {
      if (h.role === 'merchant' && G.factions[h.mission.target].war) h.mission = null; else if (h.mission.type !== 'relations') continue;
    }
    if (h.mission && h.mission.type === 'peace') continue;
    if (h.role === 'merchant') A.setMission(h, 'trade', G.factions.genoa.war ? 'venice' : 'genoa');
    if (h.role === 'governor') { const r = A.myRegions().filter(r => !G.heroes.some(x => x !== h && x.mission && x.mission.type === 'govern' && x.mission.target === r.id)).sort((a, b) => b.wealth - a.wealth)[0]; if (r) A.setMission(h, 'govern', r.id); }
    if (h.role === 'priest') { if (G.church < 55) A.setMission(h, 'church'); else { const r = A.myRegions().sort((a, b) => a.mood - b.mood)[0]; A.setMission(h, 'preach', r.id); } }
    if (h.role === 'spy') A.setMission(h, 'counter');
    if (h.role === 'diplomat') {
      const wars = Object.keys(A.FACTIONS).filter(f => f !== 'byz' && f !== 'rebel' && G.factions[f].war && A.factionAlive(f));
      if (wars.length) A.setMission(h, 'peace', wars.sort((a, b) => G.factions[b].weary - G.factions[a].weary)[0]);
      else A.setMission(h, 'relations', A.factionAlive('osman') ? 'osman' : 'serbia');
    }
  }
  // армии
  for (const a of A.myArmies()) {
    const r = A.R(a.region);
    if (r.owner === 'byz' && G.treasury > 120 && a.units.length < 9) A.recruit(a, ['inf', 'arch', 'cav', 'inf'][a.units.length % 4]);
  }
  if (A.myArmies().length < 2 && G.treasury > 150) { const a = A.newArmyAt('konst'); if (a) { A.recruit(a, 'inf'); A.recruit(a, 'arch'); } }
  return A.myArmies();
}
async function smartArmies() {
  const G = A.G;
  const threatened = A.myRegions().filter(r => G.armies.some(x => x.region === r.id && A.atWar('byz', x.owner)));
  for (const a of A.myArmies()) {
    const here = A.R(a.region);
    if (A.atWar('byz', here.owner)) { if (A.armyPower(a) > A.garPower(here) * (1 + here.fort * 0.35) * 1.8) await A.playerStorm(a); continue; }
    if (a.path.length) continue;
    const pow = A.armyPower(a);
    // защита
    const t = threatened.map(r => ({ r, d: A.defPower(r.id, 'byz') })).filter(o => o.d < pow * 1.1).sort((x, y) => x.d - y.d)[0];
    if (t && A.setArmyPath(a, t.r.id) && a.path.length <= 3) continue; else a.path = [];
    // нападение на соседей
    let best = null, bs = 1.6;
    for (const n of A.NEIGH[a.region]) {
      if (!A.linkOk('byz', n.t)) continue; const o = A.R(n.to).owner;
      if (!A.atWar('byz', o)) continue;
      const s = pow / (A.defPower(n.to, 'byz') + 1); if (s > bs) { bs = s; best = n.to; }
    }
    if (best) A.setArmyPath(a, best);
  }
}
(async () => {
  const results = [];
  for (let g = 0; g < N; g++) {
    if (POL === 'strat') A.setEvChooser((ev, opts) => ev.id === 'prologue' ? opts[1] : opts[Math.floor(Math.random() * opts.length)]);
    A.newGame(); await A.runPrologue();
    if (POL === 'first') A.setEvChooser((ev, opts) => opts[0]);
    if (POL === 'strat') A.setEvChooser((ev, opts) => ev.id === 'prologue' ? opts[1] : opts[Math.floor(Math.random() * opts.length)]);
    let errs = 0;
    while (!A.G.over) {
      try {
        if (POL !== 'passive') { smartTurn(); await smartArmies(); }
        if (POL === 'strat' && A.G.turn === 0) console.log('path', A.G.path);
        await A.endTurn();
      } catch (e) { errs++; console.error('ERR', A.G.year, e.stack.split('\n').slice(0, 3).join(' | ')); if (errs > 3) break; }
      const G = A.G;
      if (G.season === 0 && G.year % 20 === 1) process.stdout.write(`  [${G.year}] рег ${A.myRegions().length} казна ${Math.round(G.treasury)} порядок ${Math.round(G.order)} армий ${A.myArmies().length} (${A.myArmies().reduce((s, a) => s + a.units.length, 0)} отр.)\n`);
    }
    const G = A.G, F = G.final || {};
    const owners = {}; Object.values(G.regions).forEach(r => owners[r.owner] = (owners[r.owner] || 0) + 1);
    results.push({ over: G.over, year: G.year, regs: A.myRegions().length, peak: G.stats.peakRegions, tr: Math.round(G.treasury), order: Math.round(G.order), church: Math.round(G.church), pr: Math.round(G.prestige), score: F.score, title: F.title, w: G.stats.won, l: G.stats.lost, mort: F.mort && Math.round(F.mort * 100), owners: JSON.stringify(owners) });
    console.log(JSON.stringify(results[results.length - 1])); if (G.over === "konst") console.log(G.log.slice(0, 14).map(l => l.d + " " + l.t).join("\n"));
  }
  const avg = k => (results.reduce((s, r) => s + (r[k] || 0), 0) / results.length).toFixed(1);
  console.log(`ИТОГ ${POL}: пало ${results.filter(r => r.over === 'konst').length}/${N}, ср.очки ${avg('score')}, ср.областей ${avg('regs')}, казна ${avg('tr')}, порядок ${avg('order')}, побед ${avg('w')} поражений ${avg('l')}`);
})();
