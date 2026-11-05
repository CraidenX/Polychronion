
/* ---------- 4. МОДУЛЬ БОЯ ----------
   Полностью отдельный: ничего не знает о G, областях и ходах.
   Вход (input):  { attacker:{name,color,player,units:[{type,men,xp}],general:{name,tactics,leader,brave,careful}|null,ruler},
                    defender:{...}, terrain:'plain'|'hills'|'mountains'|'forest'|'river'|'coast'|'walls', fort:0..6 }
   Выход (result): { winner:'attacker'|'defender', attacker:{survivors:[{type,men,xp}], lost, generalFate:'ok'|'killed'|'captured'}, defender:{...}, rounds }
   Battle.Rules — чистая математика (удар, защита, мораль): её можно переиспользовать в будущем бою реального времени.
   Battle.Sim   — пошаговое поле (клетки, ходы сторон). Его можно заменить на RTS-симуляцию, не трогая Rules и остальную игру.
   Battle.AI    — решения компьютера на поле.
   Battle.autoResolve(input) — бой без участия игрока. */
const Battle = (() => {
  const UT = { // копия характеристик, чтобы модуль был самодостаточным
    inf: { name: 'Пехота', atk: 5, def: 6, spd: 2, rng: 1 },
    cav: { name: 'Конница', atk: 8, def: 4, spd: 4, rng: 1 },
    arch: { name: 'Лучники', atk: 4, def: 3, spd: 2, rng: 3, ratk: 5 },
    merc: { name: 'Наёмники', atk: 8, def: 7, spd: 3, rng: 1 },
  };
  const W = 18, H = 12, MAX_ROUNDS = 12;
  const CELL = { // стоимость движения, защита
    g: { n: 'Поле', cost: 1, def: 1 }, h: { n: 'Холм', cost: 2, def: 1.25 }, f: { n: 'Лес', cost: 2, def: 1.2 },
    w: { n: 'Река', cost: 99, def: 1 }, d: { n: 'Брод', cost: 2, def: 0.75 }, r: { n: 'Скалы', cost: 99, def: 1 },
    s: { n: 'Море', cost: 99, def: 1 }, W: { n: 'Стена', cost: 3, def: 1.6 }, G: { n: 'Ворота', cost: 1, def: 1.3 }, t: { n: 'Город', cost: 1, def: 1.1 },
  };

  /* ===== Rules: чистые функции ===== */
  const Rules = {
    UT, CELL,
    startMorale(side, isDefWalls) { const g = side.general; return 70 + (g ? g.leader * 4 : -8) + (side.ruler || 0) * 2 + (isDefWalls ? 10 : 0); },
    atkPower(u, side, ctx = {}) {
      const d = UT[u.type], g = side.general;
      let a = (ctx.ranged ? d.ratk : d.atk) * (1 + (u.xp || 0) * 0.04);
      if (g) a *= 1 + g.tactics * 0.05 + (g.brave ? 0.1 : 0);
      a *= 1 + (side.ruler || 0) * 0.02;
      a *= 0.6 + 0.4 * Math.max(0, u.morale) / 100;
      return a;
    },
    defPower(u, side, cellType, fort) {
      const d = UT[u.type], g = side.general;
      let v = d.def * (1 + (u.xp || 0) * 0.04);
      let cd = CELL[cellType].def; if (cellType === 'W') cd += (fort || 0) * 0.12;
      if (u.type === 'cav' && cellType === 'f') cd = 0.9;
      v *= cd;
      if (u.stance === 'defend') v *= 1.35;
      if (g && g.careful) v *= 1.1;
      return v;
    },
    // расчёт удара: возвращает потери цели и (для ближнего боя) потери атакующего от ответного удара
    strike(att, attSide, tgt, tgtSide, env) {
      const ranged = env.ranged;
      let a = Rules.atkPower(att, attSide, { ranged });
      if (!ranged && att.type === 'cav' && env.charge && !['f', 'W'].includes(env.tgtCell)) a *= (tgt.type === 'inf' && tgt.stance === 'defend') ? 0.85 : 1.5;
      if (ranged) { if (env.tgtCell === 'f') a *= 0.6; if (env.tgtCell === 'W') a *= 0.5; if (env.attCell === 'h') a *= 1.2; if (env.adjacent) a *= 0.7; }
      if (!ranged) a *= 1 + 0.2 * (env.flank || 0);
      if (env.attCell === 'd') a *= 0.8;
      const dv = Rules.defPower(tgt, tgtSide, env.tgtCell, env.fort);
      const rnd = env.rnd != null ? env.rnd : 0.85 + Math.random() * 0.3;
      const K = ranged ? 9 : 7;
      const cas = Math.min(tgt.men, Math.round(att.men * a / (dv * K) * rnd));
      let counter = 0;
      if (!ranged && tgt.men - cas > 0) {
        const ca = Rules.atkPower({ ...tgt, men: tgt.men - cas }, tgtSide, {}) * (tgt.type === 'arch' ? 0.3 : 0.5);
        const ad = Rules.defPower(att, attSide, env.attCell, 0);
        counter = Math.min(att.men, Math.round((tgt.men - cas) * ca / (ad * K) * (0.85 + Math.random() * 0.3)));
      }
      return { cas, counter };
    },
    moraleHit(u, cas) { return u.men > 0 ? 100 * cas / Math.max(1, u.men) * 1.5 + 3 : 100; },
    routThreshold: 15,
    pursuit(hasCav) { return hasCav ? 0.35 : 0.25; },
    generalFate(g, unitBroken, sideLost) {
      if (!g) return 'ok';
      const r = Math.random();
      if (unitBroken) { const k = g.brave ? 0.33 : g.careful ? 0.15 : 0.24; if (r < k) return 'killed'; if (r < k + 0.22) return 'captured'; return 'ok'; }
      if (sideLost && r < 0.08) return 'captured';
      return 'ok';
    },
  };

  /* ===== Sim: пошаговое поле ===== */
  function genTerrain(t, fort) {
    const g = []; for (let y = 0; y < H; y++) { g.push([]); for (let x = 0; x < W; x++) g[y].push('g'); }
    const blob = (type, n, size) => { for (let i = 0; i < n; i++) { let cx = 3 + Math.floor(Math.random() * (W - 6)), cy = Math.floor(Math.random() * H); for (let k = 0; k < size; k++) { if (cx >= 0 && cx < W && cy >= 0 && cy < H && g[cy][cx] === 'g') g[cy][cx] = type; cx += Math.floor(Math.random() * 3) - 1; cy += Math.floor(Math.random() * 3) - 1; } } };
    const P = { plain: [2, 2, 0], hills: [6, 1, 0], mountains: [6, 1, 3], forest: [2, 6, 0], river: [2, 2, 0], coast: [2, 1, 0], walls: [1, 1, 0] }[t] || [2, 2, 0];
    blob('h', P[0], 6); blob('f', P[1], 7); blob('r', P[2], 3);
    if (t === 'river') { let x = 8 + Math.floor(Math.random() * 2); for (let y = 0; y < H; y++) { g[y][x] = 'w'; if (Math.random() < 0.3) x = Math.max(6, Math.min(11, x + (Math.random() < 0.5 ? -1 : 1))), g[y][x] = 'w'; } const fords = [2 + Math.floor(Math.random() * 2), 6, 9 + Math.floor(Math.random() * 2)]; fords.forEach(fy => { for (let x2 = 5; x2 < 13; x2++) if (g[fy][x2] === 'w') g[fy][x2] = 'd'; }); }
    if (t === 'coast') { for (let x = 0; x < W; x++) { g[0][x] = 's'; if (Math.random() < 0.5) g[1][x] = 's'; } }
    if (t === 'walls') { for (let y = 0; y < H; y++) { g[y][12] = 'W'; for (let x = 13; x < W; x++) g[y][x] = 't'; } g[5][12] = 'G'; g[6][12] = 'G'; }
    return g;
  }
  function deploy(b, sideKey, units, left) {
    const isWalls = b.terrain === 'walls' && !left;
    const cols = left ? [2, 1, 0] : (isWalls ? [12, 14, 16] : [15, 16, 17]);
    const front = units.filter(u => u.type === 'inf' || u.type === 'merc'), arch = units.filter(u => u.type === 'arch'), cav = units.filter(u => u.type === 'cav');
    const place = (list, col) => {
      const rows = []; const mid = Math.floor(H / 2); for (let i = 0; i < H; i++) rows.push(mid + (i % 2 ? -1 : 1) * Math.ceil(i / 2)); rows.sort((a, c) => Math.abs(a - mid) - Math.abs(c - mid));
      for (const u of list) {
        let placed = false;
        for (const c of [col, ...cols]) { for (const y of rows) { if (y < 0 || y >= H) continue; if (!free(b, c, y)) continue; const ct = b.grid[y][c]; if (CELL[ct].cost >= 99) continue; u.x = c; u.y = y; placed = true; break; } if (placed) break; }
        if (!placed) for (let y = 0; y < H && !placed; y++) for (let x = left ? 0 : W - 1; left ? x < W : x >= 0; left ? x++ : x--) if (free(b, x, y) && CELL[b.grid[y][x]].cost < 99) { u.x = x; u.y = y; placed = true; break; }
      }
    };
    if (isWalls) { place(arch, 12); place(front, 12); place(cav, 14); }
    else { place(front, cols[0]); place(arch, cols[1]); place(cav, cols[1]); }
  }
  function free(b, x, y) { return x >= 0 && y >= 0 && x < W && y < H && !b.units.some(u => !u.out && u.x === x && u.y === y); }
  const Sim = {
    W, H, MAX_ROUNDS,
    create(input) {
      const b = { input, terrain: input.terrain, fort: input.fort || 0, grid: genTerrain(input.terrain, input.fort), units: [], round: 1, active: 'A', over: false, winner: null, log: [], inspired: { A: false, D: false }, retreated: null, nextId: 1 };
      b.sides = { A: input.attacker, D: input.defender };
      ['A', 'D'].forEach(k => {
        const side = b.sides[k]; const sm = Rules.startMorale(side, k === 'D' && b.terrain === 'walls');
        const list = side.units.filter(u => u.men > 0).slice(0, 16).map(u => ({ id: b.nextId++, side: k, type: u.type, men: Math.round(u.men), start: Math.round(u.men), xp: u.xp || 0, morale: sm, maxMorale: sm, x: -1, y: -1, moved: false, acted: false, stance: 'normal', out: false, routed: false, gen: false, steps: 0, hit: false }));
        // остальные отряды сверх 16 — в резерве (не участвуют, но сохраняются)
        b['reserve' + k] = side.units.filter(u => u.men > 0).slice(16).map(u => ({ ...u }));
        const gu = list.find(u => u.type === 'cav') || list.find(u => u.type !== 'arch') || list[0];
        if (gu && side.general) gu.gen = true;
        b.units.push(...list);
        deploy(b, k, list, k === 'A');
      });
      b.units.forEach(u => { if (u.x < 0) u.out = true; });
      Sim.log(b, `Битва: ${input.place || ''}. ${input.attacker.name} атакует, ${input.defender.name} обороняется.`);
      Sim.checkEnd(b);
      return b;
    },
    log(b, t) { b.log.push(t); },
    active(b, side) { return b.units.filter(u => u.side === side && !u.out); },
    unitAt(b, x, y) { return b.units.find(u => !u.out && u.x === x && u.y === y); },
    cell(b, x, y) { return b.grid[y][x]; },
    dist(a, c) { return Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)); },
    enemyAdj(b, side, x, y) { return b.units.some(u => !u.out && u.side !== side && Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) === 1); },
    moveCost(b, u, x, y) {
      const c = b.grid[y][x]; let k = CELL[c].cost;
      if (u.type === 'cav' && c === 'f') k = 3; if (u.type === 'cav' && c === 'W') k = 99;
      return k;
    },
    reachable(b, u) {
      const res = new Map(); if (u.moved || u.acted || u.out) return res;
      const sp = UT[u.type].spd; const start = u.x + ',' + u.y;
      const dist = new Map([[start, 0]]); const q = [[u.x, u.y, 0]];
      while (q.length) {
        q.sort((a, c) => a[2] - c[2]); const [x, y, d] = q.shift();
        if (d > dist.get(x + ',' + y)) continue;
        if (!(x === u.x && y === u.y)) res.set(x + ',' + y, d);
        if (!(x === u.x && y === u.y) && Sim.enemyAdj(b, u.side, x, y)) continue; // зона контроля
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          if (!free(b, X, Y)) continue;
          const nd = d + Sim.moveCost(b, u, X, Y) * (dx && dy ? 1.2 : 1);
          if (nd > sp + 0.01) continue;
          const k = X + ',' + Y; if (dist.has(k) && dist.get(k) <= nd) continue;
          dist.set(k, nd); q.push([X, Y, nd]);
        }
      }
      return res;
    },
    move(b, u, x, y) {
      if (b.over || u.side !== b.active) return false;
      const r = Sim.reachable(b, u); if (!r.has(x + ',' + y)) return false;
      u.steps = Sim.dist(u, { x, y }); u.x = x; u.y = y; u.moved = true; if (u.stance === 'defend') u.stance = 'normal';
      return true;
    },
    canAttack(b, u, t) {
      if (b.over || u.out || t.out || u.acted || u.side === t.side || u.side !== b.active) return false;
      const d = Sim.dist(u, t);
      if (u.type === 'arch') return d <= UT.arch.rng;
      return d === 1;
    },
    attack(b, u, t) {
      if (!Sim.canAttack(b, u, t)) return null;
      const ranged = u.type === 'arch' && Sim.dist(u, t) >= 1 && !(Sim.dist(u, t) === 1 && false);
      const isRanged = u.type === 'arch';
      const flank = isRanged ? 0 : b.units.filter(o => !o.out && o.side === u.side && o !== u && Sim.dist(o, t) === 1).length;
      const env = { ranged: isRanged, adjacent: Sim.dist(u, t) === 1, charge: u.type === 'cav' && u.steps >= 2, tgtCell: b.grid[t.y][t.x], attCell: b.grid[u.y][u.x], flank: Math.min(2, flank), fort: b.fort };
      const res = Rules.strike(u, b.sides[u.side], t, b.sides[t.side], env);
      t.men -= res.cas; u.men -= res.counter; t.hit = true;
      t.morale -= Rules.moraleHit({ men: t.men + res.cas }, res.cas);
      if (res.counter) u.morale -= Rules.moraleHit({ men: u.men + res.counter }, res.counter) * 0.6;
      u.acted = true; u.moved = true; if (u.stance === 'defend') u.stance = 'normal';
      const nm = x => `${b.sides[x.side].name.split(':')[0]} — ${UT[x.type].name.toLowerCase()}`;
      Sim.log(b, `${nm(u)} ${isRanged ? 'обстреливает' : env.charge && u.type === 'cav' ? 'бьёт с разгона' : 'атакует'}: ${nm(t)} теряет ${res.cas}` + (res.counter ? `, в ответ −${res.counter}` : '') + '.');
      b.lastFx = { from: [u.x, u.y], to: [t.x, t.y], ranged: isRanged, cas: res.cas, counter: res.counter };
      Sim.checkRout(b, t); Sim.checkRout(b, u);
      Sim.checkEnd(b);
      return res;
    },
    checkRout(b, u) {
      if (u.out) return;
      if (u.men <= 0) { u.men = 0; u.out = true; u.routed = true; Sim.log(b, `Отряд «${UT[u.type].name}» (${b.sides[u.side].name}) уничтожен.`); Sim.afterRout(b, u); return; }
      if (u.morale < Rules.routThreshold) {
        const enemyCav = b.units.some(o => !o.out && o.side !== u.side && o.type === 'cav');
        const lost = Math.round(u.men * Rules.pursuit(enemyCav)); u.men -= lost; u.out = true; u.routed = true;
        Sim.log(b, `Отряд «${UT[u.type].name}» (${b.sides[u.side].name}) бежит! При бегстве погибло ${lost}.`);
        Sim.afterRout(b, u);
      }
    },
    afterRout(b, u) {
      b.units.forEach(o => { if (!o.out && o.side === u.side && Sim.dist(o, u) <= 2) o.morale -= 8; });
      if (u.gen) { u.genBroken = true; b.units.forEach(o => { if (!o.out && o.side === u.side) o.morale -= 15; }); Sim.log(b, `Знамя полководца ${b.sides[u.side].general ? b.sides[u.side].general.name : ''} пало!`); }
      b.units.forEach(o => { if (!o.out && o.side === u.side && o.morale < Rules.routThreshold) Sim.checkRout(b, o); });
    },
    defend(b, u) { if (b.over || u.side !== b.active || u.acted) return false; u.stance = 'defend'; u.acted = true; u.moved = true; return true; },
    wait(b, u) { if (u.side !== b.active) return false; u.acted = true; u.moved = true; return true; },
    inspire(b, side) {
      if (b.inspired[side] || !b.sides[side].general || b.units.some(u => u.side === side && u.gen && u.out)) return false;
      b.inspired[side] = true; Sim.active(b, side).forEach(u => u.morale = Math.min(u.maxMorale + 10, u.morale + 15 + (b.sides[side].general.leader || 0) * 2));
      Sim.log(b, `${b.sides[side].general.name} объезжает строй и воодушевляет воинов!`); return true;
    },
    endSide(b) {
      if (b.over) return;
      const s = b.active;
      Sim.active(b, s).forEach(u => { u.moved = false; u.acted = false; u.steps = 0; });
      if (s === 'A') b.active = 'D';
      else {
        b.round++; b.active = 'A';
        b.units.forEach(u => { if (!u.out) { if (!u.hit) u.morale = Math.min(u.maxMorale, u.morale + 4); u.hit = false; } });
        if (b.round > MAX_ROUNDS) { b.over = true; b.winner = 'D'; Sim.log(b, 'День кончился. Атакующие отходят — победа за обороняющимися.'); }
      }
      Sim.checkEnd(b);
    },
    retreat(b, side) { if (b.over) return; b.retreated = side; Sim.active(b, side).forEach(u => { u.men = Math.round(u.men * 0.85); }); b.over = true; b.winner = side === 'A' ? 'D' : 'A'; Sim.log(b, `${b.sides[side].name} трубит отступление.`); },
    checkEnd(b) {
      if (b.over) return;
      const a = Sim.active(b, 'A').length, d = Sim.active(b, 'D').length;
      if (!a || !d) { b.over = true; b.winner = a ? 'A' : 'D'; Sim.log(b, `Поле боя осталось за: ${b.sides[b.winner].name}.`); }
    },
    result(b) {
      const out = {};
      ['A', 'D'].forEach(k => {
        const won = b.winner === k;
        const list = b.units.filter(u => u.side === k);
        const survivors = list.map(u => ({ type: u.type, men: Math.max(0, Math.round(u.routed ? u.men * (won ? 0.85 : 0.6) : u.men * (won ? 1 : 0.9))), xp: u.xp })).filter(u => u.men > 0).concat(b['reserve' + k] || []);
        const start = b.sides[k].units.reduce((s, u) => s + u.men, 0);
        const after = survivors.reduce((s, u) => s + u.men, 0);
        const gu = list.find(u => u.gen);
        out[k === 'A' ? 'attacker' : 'defender'] = { survivors, lost: Math.max(0, start - after), generalFate: Rules.generalFate(b.sides[k].general, gu ? gu.genBroken : false, !won) };
      });
      return { winner: b.winner === 'A' ? 'attacker' : 'defender', attacker: out.attacker, defender: out.defender, rounds: b.round, log: b.log };
    },
  };

  /* ===== AI: одно действие за раз (удобно анимировать) ===== */
  const AI = {
    // вернёт описание действия или null, если стороне больше нечего делать
    next(b, side) {
      if (b.over) return null;
      const mine = Sim.active(b, side).filter(u => !u.acted);
      const foes = Sim.active(b, side === 'A' ? 'D' : 'A');
      if (!foes.length) return null;
      // отступление при безнадёжном положении
      const my = Sim.active(b, side).reduce((s, u) => s + u.men, 0), th = foes.reduce((s, u) => s + u.men, 0);
      const myStart = b.units.filter(u => u.side === side).reduce((s, u) => s + u.start, 0);
      if (my < myStart * 0.3 && th > my * 2.2) return { kind: 'retreat' };
      if (!b.inspired[side] && b.sides[side].general && mine.length) { const avg = Sim.active(b, side).reduce((s, u) => s + u.morale, 0) / Sim.active(b, side).length; if (avg < 45) return { kind: 'inspire' }; }
      const order = mine.sort((a, c) => (a.type === 'arch' ? 0 : a.type === 'cav' ? 1 : 2) - (c.type === 'arch' ? 0 : c.type === 'cav' ? 1 : 2));
      const holdWalls = b.terrain === 'walls' && side === 'D';
      const defensive = side === 'D' && my < th * 0.9;
      for (const u of order) {
        // 1) можно ударить с места
        const inRange = foes.filter(t => Sim.canAttack(b, u, t));
        if (inRange.length) return { kind: 'attack', u, t: AI.bestTarget(b, u, inRange) };
        if (u.moved) { return { kind: 'wait', u }; }
        const reach = Sim.reachable(b, u);
        if (u.type === 'arch') {
          let best = null, bs = -1e9;
          for (const [k, c] of reach) { const [x, y] = k.split(',').map(Number); const dmin = Math.min(...foes.map(t => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)))); let s = -Math.abs(dmin - 3) * 3 - (dmin <= 1 ? 6 : 0) + (b.grid[y][x] === 'h' ? 2 : 0) + (b.grid[y][x] === 'W' ? 3 : 0); if (dmin <= 3) s += 5; if (s > bs) { bs = s; best = [x, y]; } }
          if (holdWalls && b.grid[u.y][u.x] === 'W') return { kind: 'wait', u };
          if (best && bs > -100) return { kind: 'move', u, x: best[0], y: best[1] };
          return { kind: 'wait', u };
        }
        // 2) подойти и ударить
        let best = null, bs = -1e9;
        for (const t of foes) {
          for (const [k] of reach) {
            const [x, y] = k.split(',').map(Number);
            if (Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) !== 1) continue;
            let s = AI.scoreTarget(b, u, t) + (b.grid[y][x] === 'h' ? 1 : 0) - (b.grid[y][x] === 'd' ? 2 : 0);
            if (s > bs) { bs = s; best = { x, y, t }; }
          }
        }
        if (holdWalls && b.grid[u.y][u.x] === 'W' && (!best || bs < 4)) return { kind: 'defend', u };
        if (best && (!defensive || bs > 3)) return { kind: 'moveAttack', u, x: best.x, y: best.y, t: best.t };
        if (defensive || holdWalls) return { kind: 'defend', u };
        // 3) сблизиться
        let mv = null, md = 1e9;
        for (const [k] of reach) { const [x, y] = k.split(',').map(Number); const dmin = Math.min(...foes.map(t => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)))); const s = dmin - (b.grid[y][x] === 'h' ? 0.3 : 0); if (s < md) { md = s; mv = [x, y]; } }
        if (mv && md < Math.min(...foes.map(t => Sim.dist(u, t)))) return { kind: 'move', u, x: mv[0], y: mv[1] };
        return { kind: 'defend', u };
      }
      return null;
    },
    scoreTarget(b, u, t) { let s = 10 - t.morale / 15 + (t.type === 'arch' ? 3 : 0) - t.men / 200; if (u.type === 'cav' && t.type === 'inf' && t.stance === 'defend') s -= 4; if (t.gen) s += 2; if (b.grid[t.y][t.x] === 'W') s -= 3; return s; },
    bestTarget(b, u, list) { return list.sort((a, c) => AI.scoreTarget(b, u, c) - AI.scoreTarget(b, u, a))[0]; },
    apply(b, side, act) {
      if (!act) { Sim.endSide(b); return false; }
      switch (act.kind) {
        case 'retreat': Sim.retreat(b, side); break;
        case 'inspire': Sim.inspire(b, side); break;
        case 'attack': Sim.attack(b, act.u, act.t); break;
        case 'move': if (!Sim.move(b, act.u, act.x, act.y)) Sim.wait(b, act.u); break;
        case 'moveAttack': if (!Sim.move(b, act.u, act.x, act.y)) { Sim.wait(b, act.u); break; } if (!Sim.attack(b, act.u, act.t)) Sim.wait(b, act.u); break;
        case 'defend': Sim.defend(b, act.u); break;
        case 'wait': Sim.wait(b, act.u); break;
      }
      return true;
    },
    playSide(b, side) { let guard = 0; while (!b.over && b.active === side && guard++ < 200) { const act = AI.next(b, side); if (!AI.apply(b, side, act)) break; } if (!b.over && b.active === side) Sim.endSide(b); },
  };
  function finishAuto(b) { let guard = 0; while (!b.over && guard++ < 100) AI.playSide(b, b.active); return Sim.result(b); }
  function autoResolve(input) { const b = Sim.create(input); return finishAuto(b); }
  return { Rules, Sim, AI, autoResolve, finishAuto };
})();
