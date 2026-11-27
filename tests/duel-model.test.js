import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDuel,
  normalizeDuel,
  medalFor,
  signalPlan,
  SIGNAL_KINDS,
  createModifierStack,
  createLoadoutSwap,
  resultsLines,
  roundLine,
  formatMs,
} from '../games/pistols-at-dawn/js/duel-model.js';

// A duel with two cutouts, driven by hand. `log` collects every
// announcement so tests can assert on the event stream, which is what
// style, payouts and the announcer will depend on.
function harness(def, rng) {
  const log = [];
  const duel = createDuel(def, { onEvent: (name, detail) => log.push({ name, detail }), rng: rng || (() => 0.5) });
  const names = () => log.map((e) => e.name);
  return { duel, log, names };
}

const TWO_CUTOUTS = [{ id: 'a' }, { id: 'b' }];

// Walk one round up to the signal. Returns the time of the signal.
function toLive(duel, t0 = 0) {
  duel.setHolstered(t0, true);
  assert.equal(duel.phase, 'waiting');
  duel.signal(t0 + 2000);
  assert.equal(duel.phase, 'live');
  return t0 + 2000;
}

test('a round goes setup -> waiting -> live -> resolved and announces each step', () => {
  const { duel, names } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1 } });
  assert.equal(duel.phase, 'idle');
  duel.start(0);
  assert.equal(duel.phase, 'setup');
  duel.setHolstered(100, true);
  assert.equal(duel.phase, 'waiting');
  duel.signal(2000);
  assert.equal(duel.phase, 'live');
  duel.shotFired(2400);
  duel.hit(2400, { id: 'a', zone: 'torso' });
  duel.shotFired(2900);
  duel.hit(2900, { id: 'b', zone: 'head' });
  assert.equal(duel.phase, 'resolved');
  assert.deepEqual(names(), [
    'duel-start', 'duel-setup', 'duel-waiting', 'duel-signal',
    'duel-shot', 'duel-hit', 'duel-shot', 'duel-hit', 'duel-round-end',
  ]);
});

test('the signal only fires from waiting, and setup needs a holstered hand', () => {
  const { duel } = harness({ opponents: TWO_CUTOUTS });
  duel.start(0);
  assert.equal(duel.signal(10), false, 'cannot signal during setup');
  duel.setHolstered(20, false);
  assert.equal(duel.phase, 'setup', 'not holstered: stays in setup');
  duel.setHolstered(30, true);
  assert.equal(duel.phase, 'waiting');
  assert.equal(duel.signal(40), true);
  assert.equal(duel.signal(50), false, 'only once');
});

test('reaction time is signal to first hit; accuracy counts misses', () => {
  const { duel, log } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1 } });
  duel.start(0);
  const t = toLive(duel);
  duel.shotFired(t + 500); // a miss
  duel.shotFired(t + 700);
  duel.hit(t + 700, { id: 'a', zone: 'torso' });
  duel.shotFired(t + 1000);
  duel.hit(t + 1000, { id: 'b', zone: 'legs' });
  const end = log.find((e) => e.name === 'duel-round-end').detail.result;
  assert.equal(end.outcome, 'cleared');
  assert.equal(end.won, true);
  assert.equal(end.reactionMs, 700);
  assert.equal(end.clearMs, 1000);
  assert.equal(end.shots, 3);
  assert.equal(end.hits, 2);
  assert.equal(end.misses, 1);
  assert.ok(Math.abs(end.accuracy - 2 / 3) < 1e-9);
  assert.equal(end.points, 60 + 30);
  assert.deepEqual(end.zones, { torso: 1, legs: 1 });
  assert.equal(end.medal, 'silver', '700ms but 67% accuracy misses gold (75%)');
});

test('a second hit on the same target does not count twice', () => {
  const { duel } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1 } });
  duel.start(0);
  toLive(duel);
  assert.equal(duel.hit(2500, { id: 'a' }), true);
  assert.equal(duel.hit(2600, { id: 'a' }), false);
  assert.equal(duel.cur.hits, 1);
  assert.equal(duel.phase, 'live');
});

test('a live round that runs out of time is lost', () => {
  const { duel, log } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1, roundTimeMs: 3000 } });
  duel.start(0);
  const t = toLive(duel);
  duel.hit(t + 500, { id: 'a' });
  duel.tick(t + 2999);
  assert.equal(duel.phase, 'live');
  duel.tick(t + 3000);
  assert.equal(duel.phase, 'resolved');
  const end = log.find((e) => e.name === 'duel-round-end').detail;
  assert.equal(end.outcome, 'timeout');
  assert.equal(end.won, false);
  assert.equal(end.result.medal, null);
  assert.equal(end.result.reactionMs, 500, 'a partial round still has a reaction time');
});

// ---------- false starts ----------

test('drawing before the signal is a false start that forfeits the round', () => {
  const { duel, log } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1 } });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.setHolstered(500, false); // a gun left its holster in `waiting`
  const fs = log.find((e) => e.name === 'duel-false-start').detail;
  assert.equal(fs.reason, 'draw');
  assert.equal(fs.mode, 'forfeit');
  assert.equal(duel.phase, 'resolved');
  const end = log.find((e) => e.name === 'duel-round-end').detail;
  assert.equal(end.outcome, 'false-start');
  assert.equal(end.won, false);
  assert.equal(end.result.reactionMs, null);
  assert.equal(end.result.points, 0);
  duel.tick(500 + 2500);
  assert.equal(duel.phase, 'results');
  assert.equal(duel.outcome, 'lost');
});

test('firing before the signal is a false start too', () => {
  const { duel, log } = harness({ opponents: TWO_CUTOUTS, rules: { rounds: 1 } });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.shotFired(300);
  assert.equal(log.find((e) => e.name === 'duel-false-start').detail.reason, 'shot');
});

test('a gun in hand during setup is not a false start, just not ready', () => {
  const { duel, names } = harness({ opponents: TWO_CUTOUTS });
  duel.start(0);
  duel.setHolstered(10, false);
  duel.shotFired(20);
  assert.equal(duel.phase, 'setup');
  assert.ok(!names().includes('duel-false-start'));
});

test('penalty mode keeps the round going and adds the penalty to the reaction time', () => {
  const { duel, log } = harness({
    opponents: [{ id: 'a' }],
    rules: { rounds: 1, falseStart: { mode: 'penalty', penaltyMs: 400 } },
  });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.setHolstered(300, false);
  assert.equal(duel.phase, 'waiting', 'penalty does not end the round');
  duel.signal(2000);
  duel.hit(2500, { id: 'a' });
  const end = log.find((e) => e.name === 'duel-round-end').detail.result;
  assert.equal(end.reactionMs, 500 + 400);
  assert.equal(end.penaltyMs, 400);
  assert.equal(end.falseStarts, 1);
  assert.equal(end.won, true);
});

test('redo mode replays the round without counting it, then forfeits after maxRedos', () => {
  const { duel, log } = harness({
    opponents: [{ id: 'a' }],
    rules: { rounds: 3, betweenRoundsMs: 100, falseStart: { mode: 'redo', maxRedos: 1 } },
  });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.setHolstered(20, false);
  assert.equal(duel.results.length, 0, 'a redo is not a decided round');
  duel.tick(200);
  assert.equal(duel.phase, 'setup');
  assert.equal(duel.round, 1, 'still round 1');
  duel.setHolstered(210, true);
  duel.shotFired(250); // second false start: out of redos
  const ends = log.filter((e) => e.name === 'duel-round-end');
  assert.equal(ends[0].detail.outcome, 'false-start-redo');
  assert.equal(ends[1].detail.outcome, 'false-start');
  assert.equal(duel.results.length, 1);
  assert.equal(duel.losses, 1);
});

test('none mode announces the false start and carries on untouched', () => {
  const { duel, names } = harness({
    opponents: [{ id: 'a' }],
    rules: { rounds: 1, falseStart: { mode: 'none' } },
  });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.setHolstered(20, false);
  assert.ok(names().includes('duel-false-start'));
  assert.equal(duel.phase, 'waiting');
  duel.signal(1000);
  duel.hit(1400, { id: 'a' });
  assert.equal(duel.cur.penaltyMs, 0);
  assert.equal(duel.results[0].reactionMs, 400);
});

// ---------- matches ----------

function playRound(duel, t, win) {
  duel.setHolstered(t, true);
  duel.signal(t + 1000);
  duel.shotFired(t + 1400);
  if (win) duel.hit(t + 1400, { id: 'a', zone: 'torso' });
  else duel.tick(t + 1000 + duel.def.rules.roundTimeMs);
  const resolvedAt = win ? t + 1400 : t + 1000 + duel.def.rules.roundTimeMs;
  duel.tick(resolvedAt + duel.def.rules.betweenRoundsMs);
  return resolvedAt + duel.def.rules.betweenRoundsMs + 1;
}

test('best of 3 ends as soon as one side has two rounds', () => {
  const { duel, names } = harness({ opponents: [{ id: 'a' }], rules: { rounds: 3 } });
  duel.start(0);
  let t = 0;
  t = playRound(duel, t, true);
  assert.equal(duel.phase, 'setup', 'round 2 begins');
  assert.equal(duel.round, 2);
  t = playRound(duel, t, true);
  assert.equal(duel.phase, 'results', 'two wins decide a best of 3; no round 3');
  assert.equal(duel.round, 2);
  assert.equal(duel.outcome, 'won');
  assert.equal(names().filter((n) => n === 'duel-results').length, 1);
});

test('best of 3 goes to a third round at 1-1 and the third decides it', () => {
  const { duel, log } = harness({ opponents: [{ id: 'a' }], rules: { rounds: 3 } });
  duel.start(0);
  let t = 0;
  t = playRound(duel, t, true);
  t = playRound(duel, t, false);
  assert.equal(duel.phase, 'setup');
  assert.equal(duel.round, 3);
  t = playRound(duel, t, false);
  assert.equal(duel.phase, 'results');
  assert.equal(duel.outcome, 'lost');
  const results = log.find((e) => e.name === 'duel-results').detail;
  assert.equal(results.wins, 1);
  assert.equal(results.losses, 2);
  assert.equal(results.rounds.length, 3);
  assert.equal(results.medal, null, 'no medal for a lost match');
});

test('best of 5 needs three wins; an even count with no winner is a draw', () => {
  const five = harness({ opponents: [{ id: 'a' }], rules: { rounds: 5 } }).duel;
  five.start(0);
  let t = 0;
  t = playRound(five, t, true);
  t = playRound(five, t, true);
  assert.equal(five.phase, 'setup', 'two wins are not enough in a best of 5');
  t = playRound(five, t, true);
  assert.equal(five.outcome, 'won');

  const two = harness({ opponents: [{ id: 'a' }], rules: { rounds: 2 } }).duel;
  two.start(0);
  t = 0;
  t = playRound(two, t, true);
  t = playRound(two, t, false);
  assert.equal(two.outcome, 'draw');
});

test('match results aggregate reaction, accuracy and medal across rounds', () => {
  const { duel, log } = harness({ opponents: [{ id: 'a' }], rules: { rounds: 3 } });
  duel.start(0);
  let t = 0;
  t = playRound(duel, t, true); // reaction 400
  t = playRound(duel, t, true); // reaction 400
  const r = log.find((e) => e.name === 'duel-results').detail;
  assert.equal(r.outcome, 'won');
  assert.equal(r.bestReactionMs, 400);
  assert.equal(r.avgReactionMs, 400);
  assert.equal(r.hits, 2);
  assert.equal(r.shots, 2);
  assert.equal(r.accuracy, 1);
  assert.equal(r.medal, 'gold');
  assert.equal(r.points, 120);
});

test('abort stops from any phase, announces it, and never reports results', () => {
  const { duel, names } = harness({ opponents: [{ id: 'a' }] });
  duel.start(0);
  duel.setHolstered(10, true);
  duel.signal(500);
  assert.equal(duel.abort(600, 'left the range'), true);
  assert.ok(names().includes('duel-aborted'));
  assert.ok(!names().includes('duel-results'));
  assert.equal(duel.finished(), true);
  assert.equal(duel.abort(700), false, 'already stopped');
  duel.hit(800, { id: 'a' });
  assert.equal(duel.cur.hits, 0, 'nothing counts after an abort');
});

test('definitions fill in defaults and keep weapon, time and place fields', () => {
  const d = normalizeDuel({ title: 'Pistols at Dawn', rules: { rounds: 1, falseStart: { mode: 'penalty' } } });
  assert.equal(d.weapon, null);
  assert.equal(d.time, null);
  assert.equal(d.place, null);
  assert.equal(d.rules.roundTimeMs, 7000);
  assert.equal(d.rules.falseStart.mode, 'penalty');
  assert.equal(d.rules.falseStart.penaltyMs, 500, 'unset nested fields keep their defaults');
  assert.equal(normalizeDuel({ rules: { falseStart: { mode: 'banana' } } }).rules.falseStart.mode, 'forfeit');
});

test('medalFor needs both the reaction and the accuracy', () => {
  const scoring = normalizeDuel({}).scoring;
  assert.equal(medalFor(scoring, 500, 1), 'gold');
  assert.equal(medalFor(scoring, 500, 0.6), 'silver');
  assert.equal(medalFor(scoring, 2000, 1), 'bronze');
  assert.equal(medalFor(scoring, 3000, 1), null);
  assert.equal(medalFor(scoring, null, 1), null);
});

// ---------- start-signal plans ----------

test('every built signal produces an ordered plan with exactly one firing step', () => {
  for (const kind of Object.keys(SIGNAL_KINDS)) {
    const plan = signalPlan({ kind }, () => 0.5);
    assert.ok(plan.length > 0, kind);
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i].at >= plan[i - 1].at, `${kind} is in time order`);
    const closing = plan.filter((s) => s.fire || s.waitForEvent);
    assert.equal(closing.length, 1, `${kind} has one closing step`);
    assert.equal(plan.every((s) => s.kind === kind), true);
  }
});

test('draw-shout: one DRAW! after a delay drawn from the range', () => {
  const lo = signalPlan({ kind: 'draw-shout', delayMs: [1000, 3000] }, () => 0);
  const hi = signalPlan({ kind: 'draw-shout', delayMs: [1000, 3000] }, () => 1);
  assert.deepEqual(lo.map((s) => [s.at, s.text, s.fire]), [[1000, 'DRAW!', true]]);
  assert.equal(hi[0].at, 3000);
});

test('starter-pistol warns, then the bang is the signal', () => {
  const plan = signalPlan({ kind: 'starter-pistol', delayMs: 2000 }, () => 0.5);
  assert.equal(plan[0].text, 'Ready...');
  assert.equal(plan[1].text, 'BANG!');
  assert.equal(plan[1].fire, true);
  assert.equal(plan[1].at, 2000);
});

test('flag-drop shows the flag at once and drops it later', () => {
  const plan = signalPlan({ kind: 'flag-drop', delayMs: 2500 }, () => 0.5);
  assert.equal(plan[0].at, 0);
  assert.equal(plan[1].text, 'DROP!');
  assert.equal(plan[1].fire, true);
});

test('coin-toss does not fire on a clock: it waits for the coin to land', () => {
  const plan = signalPlan({ kind: 'coin-toss' }, () => 0.5);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].toss, true);
  assert.equal(plan[0].waitForEvent, 'landed');
  assert.ok(!plan[0].fire);
});

test('ten-paces counts one to ten and turns on the next beat', () => {
  const plan = signalPlan({ kind: 'ten-paces', stepMs: 500 });
  assert.equal(plan.length, 11);
  assert.deepEqual(plan.slice(0, 10).map((s) => s.pace), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(plan[10].text, 'TURN!');
  assert.equal(plan[10].at, 5500);
  assert.equal(plan[10].fire, true);
});

test('an unknown signal falls back to the shout instead of never starting', () => {
  assert.equal(signalPlan({ kind: 'carrier-pigeon' }, () => 0.5)[0].text, 'DRAW!');
});

test('the duel hands its signal plan out when it starts waiting', () => {
  const { duel, log } = harness({ opponents: [{ id: 'a' }], signal: { kind: 'ten-paces', stepMs: 100 } });
  duel.start(0);
  duel.setHolstered(5, true);
  const waiting = log.find((e) => e.name === 'duel-waiting').detail;
  assert.equal(waiting.plan.length, 11);
});

// ---------- modifiers ----------

test('modifiers apply in order and unwind in reverse, so stacking is safe', () => {
  const world = { light: 'noon', fog: 0 };
  const calls = [];
  const registry = {
    dusk: {
      apply: (w) => { calls.push('apply dusk'); const prev = w.light; w.light = 'dusk'; return prev; },
      remove: (w, m, prev) => { calls.push('remove dusk'); w.light = prev; },
    },
    fog: {
      apply: (w, m) => { calls.push('apply fog'); const prev = w.fog; w.fog += m.density; return prev; },
      remove: (w, m, prev) => { calls.push('remove fog'); w.fog = prev; },
    },
  };
  const stack = createModifierStack(registry, world);
  stack.apply([{ id: 'dusk' }, { id: 'fog', density: 0.1 }, { id: 'fog', density: 0.2 }]);
  assert.equal(world.light, 'dusk');
  assert.ok(Math.abs(world.fog - 0.3) < 1e-9, 'two fogs stack');
  assert.deepEqual(stack.active(), ['dusk', 'fog', 'fog']);
  stack.removeAll();
  assert.equal(world.light, 'noon');
  assert.equal(world.fog, 0);
  assert.deepEqual(calls, ['apply dusk', 'apply fog', 'apply fog', 'remove fog', 'remove fog', 'remove dusk']);
  assert.deepEqual(stack.active(), []);
});

test('an unknown or throwing modifier is reported and does not stop the rest', () => {
  const world = { n: 0 };
  const registry = {
    ok: { apply: (w) => { w.n += 1; }, remove: (w) => { w.n -= 1; } },
    bad: { apply: () => { throw new Error('boom'); }, remove: () => {} },
  };
  const stack = createModifierStack(registry, world);
  stack.apply([{ id: 'ok' }, { id: 'bad' }, { id: 'nope' }, { id: 'ok' }]);
  assert.equal(world.n, 2);
  assert.deepEqual(stack.problems.map((p) => p.id), ['bad', 'nope']);
  stack.removeAll();
  assert.equal(world.n, 0);
});

// ---------- weapon takeover ----------

function fakeLoadoutApi(initial) {
  const world = { carried: initial.slice(), aside: [], duelGun: null, log: [] };
  const api = {
    carried: () => world.carried.slice(),
    setAside: (item) => {
      world.carried.splice(world.carried.indexOf(item), 1);
      world.aside.push(item);
      world.log.push('aside ' + item.name);
      return item.name + '-token';
    },
    give: (weapon) => { world.duelGun = { weapon }; world.log.push('give ' + weapon); return world.duelGun; },
    remove: (h) => { world.duelGun = null; world.log.push('remove ' + h.weapon); },
    putBack: (item, token) => {
      world.aside.splice(world.aside.indexOf(item), 1);
      world.carried.push(item);
      world.log.push('back ' + item.name + ' ' + token);
    },
  };
  return { world, api };
}

test('weapon takeover sets carried guns aside, hands out the duel weapon, and gives it all back', () => {
  const colt = { name: 'colt' };
  const shotgun = { name: 'shotgun' };
  const { world, api } = fakeLoadoutApi([colt, shotgun]);
  const swap = createLoadoutSwap(api);
  assert.equal(swap.takeover('pistol'), true);
  assert.deepEqual(world.carried, []);
  assert.equal(world.duelGun.weapon, 'pistol');
  assert.equal(swap.isActive(), true);
  swap.restore();
  assert.equal(world.duelGun, null, 'the duel weapon is taken away');
  assert.deepEqual(world.carried.map((i) => i.name).sort(), ['colt', 'shotgun']);
  assert.deepEqual(world.aside, []);
  assert.equal(swap.isActive(), false);
});

test('restore after an aborted duel, repeated or without a takeover, is safe', () => {
  const colt = { name: 'colt' };
  const { world, api } = fakeLoadoutApi([colt]);
  const swap = createLoadoutSwap(api);
  assert.equal(swap.restore(), false, 'nothing to restore yet');
  swap.takeover('pistol');
  swap.restore();
  assert.equal(swap.restore(), false, 'second restore does nothing');
  assert.deepEqual(world.carried, [colt]);
});

test('a duel that names no weapon leaves the carried guns alone', () => {
  const colt = { name: 'colt' };
  const { world, api } = fakeLoadoutApi([colt]);
  const swap = createLoadoutSwap(api);
  assert.equal(swap.takeover(null), false);
  assert.deepEqual(world.carried, [colt]);
  assert.deepEqual(world.log, []);
});

test('if the duel weapon cannot be handed out, everything is put back', () => {
  const colt = { name: 'colt' };
  const { world, api } = fakeLoadoutApi([colt]);
  api.give = () => null;
  const swap = createLoadoutSwap(api);
  assert.equal(swap.takeover('pistol'), false);
  assert.deepEqual(world.carried, [colt]);
  assert.equal(swap.isActive(), false);
});

test('results lines give a headline, one line per round and a summary', () => {
  const { duel, log } = harness({ opponents: [{ id: 'a' }], rules: { rounds: 3 } });
  duel.start(0);
  const t = playRound(duel, 0, true);
  playRound(duel, t, true);
  const final = log.find((e) => e.name === 'duel-results').detail;
  const lines = resultsLines(final);
  assert.match(lines[0], /^YOU WIN {2}2-0 {3}GOLD STAR$/);
  assert.equal(lines.length, 4, 'headline, two rounds, summary');
  assert.match(lines[1], /^R1 {2}Cleared {2}400 ms {2}1\/1 {2}100%$/);
  assert.match(lines[3], /Best 400 ms {3}Accuracy 100%/);
  assert.equal(roundLine({ round: 2, outcome: 'false-start' }), 'R2  FALSE START');
  assert.equal(formatMs(null), '--');
});

test('one gun that will not go back does not strand the others', () => {
  const a = { name: 'a' };
  const b = { name: 'b' };
  const { world, api } = fakeLoadoutApi([a, b]);
  const putBack = api.putBack;
  api.putBack = (item, token) => { if (item === b) throw new Error('slot gone'); putBack(item, token); };
  const swap = createLoadoutSwap(api);
  swap.takeover('pistol');
  swap.restore();
  assert.deepEqual(world.carried, [a]);
});
