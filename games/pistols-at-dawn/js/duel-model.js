// ==============================================================
// DUEL MODEL
//
// The logic half of the duel framework, deliberately free of A-Frame,
// THREE and the DOM so it can be tested with `node --test` (see
// tests/duel-model.test.js), the same split common/menu-model.js makes.
// js/duel.js is the other half: it feeds this model what the world is
// doing (a gun left its holster, a cutout was hit) and turns what the
// model announces into text, sound and a results board.
//
// A duel is DATA (see DUEL_DEFAULTS and games' own definitions in
// duel.js). Each round goes through
//
//   setup -> waiting -> live -> resolved        (then the next round's
//                                                setup, or results)
//
//   setup     the duel is being laid out; it waits for the player to have
//             everything holstered
//   waiting   holstered and the signal is pending. Drawing or firing now
//             is a FALSE START, and the rules decide what that costs
//   live      the signal went; the clock runs, hits and shots are counted
//   resolved  the round has a result (cleared, timed out, or forfeited)
//   results   the whole match is over
//
// The model never reads a clock. Every call that cares about time is
// handed `now` (ms), which is what makes it testable and also what lets
// the world feed it scene time rather than wall time.
//
// Everything that happens is ANNOUNCED through onEvent(name, detail):
// duel-setup, duel-waiting, duel-signal, duel-false-start, duel-shot,
// duel-hit, duel-round-end, duel-results, duel-aborted. Style, payouts
// and an announcer listen to those; this file knows none of them.
// ==============================================================

export var DUEL_DEFAULTS = {
  // The fields a definition may leave out. weapon, time and place exist
  // even though only one value of each is in use (deck.todo.md): null
  // weapon means "use whatever you carry".
  title: 'Untitled Duel',
  weapon: null,
  time: null,
  place: null,
  signal: { kind: 'draw-shout' },
  opponents: [],
  modifiers: [],
  rules: {
    rounds: 3, // best of N
    roundTimeMs: 7000, // live time before a round times out
    betweenRoundsMs: 2500, // how long a result stays up before the next round
    // forfeit: lose the round. penalty: keep going, add penaltyMs to the
    // reaction time. redo: replay the round (maxRedos, then forfeit).
    // none: announce it and carry on (silly modes).
    falseStart: { mode: 'forfeit', penaltyMs: 500, maxRedos: 3 },
  },
  scoring: {
    zonePoints: { head: 100, torso: 60, legs: 30 },
    // Best first. A medal needs BOTH the reaction and the accuracy.
    medals: [
      { tier: 'gold', maxReactionMs: 800, minAccuracy: 0.75 },
      { tier: 'silver', maxReactionMs: 1300, minAccuracy: 0.5 },
      { tier: 'bronze', maxReactionMs: 2500, minAccuracy: 0.25 },
    ],
  },
};

var FALSE_START_MODES = ['forfeit', 'penalty', 'redo', 'none'];

// A definition with every missing field filled in. Nested objects merge
// one level down so a duel can say `rules: { rounds: 1 }` and keep the rest.
export function normalizeDuel(def) {
  var d = def || {};
  var rules = Object.assign({}, DUEL_DEFAULTS.rules, d.rules);
  rules.falseStart = Object.assign({}, DUEL_DEFAULTS.rules.falseStart, (d.rules || {}).falseStart);
  if (FALSE_START_MODES.indexOf(rules.falseStart.mode) === -1) rules.falseStart.mode = 'forfeit';
  rules.rounds = Math.max(1, Math.floor(rules.rounds) || 1);
  var scoring = Object.assign({}, DUEL_DEFAULTS.scoring, d.scoring);
  return {
    id: d.id || 'duel',
    title: d.title || DUEL_DEFAULTS.title,
    weapon: d.weapon === undefined ? null : d.weapon,
    time: d.time === undefined ? null : d.time,
    place: d.place === undefined ? null : d.place,
    signal: Object.assign({}, DUEL_DEFAULTS.signal, d.signal),
    opponents: (d.opponents || []).slice(),
    modifiers: (d.modifiers || []).slice(),
    rules: rules,
    scoring: scoring,
  };
}

// The pun on the card: "[weapon] at [time] in/on [place]".
export function duelCardName(def) {
  if (def.title) return def.title;
  return [def.weapon, def.time && 'at ' + def.time, def.place && 'in ' + def.place].filter(Boolean).join(' ');
}

// ---------- scoring helpers (pure) ----------

export function accuracyOf(hits, shots) {
  return shots > 0 ? hits / shots : 0;
}

// The best medal tier whose reaction AND accuracy bars are both met, or null.
export function medalFor(scoring, reactionMs, accuracy) {
  if (reactionMs === null || reactionMs === undefined) return null;
  var medals = (scoring && scoring.medals) || [];
  for (var i = 0; i < medals.length; i++) {
    if (reactionMs <= medals[i].maxReactionMs && accuracy >= medals[i].minAccuracy) return medals[i].tier;
  }
  return null;
}

// ---------- start-signal plans (pure) ----------
//
// A start signal is a plug-in with a pure half (this: when does what
// happen) and a world half (js/duel.js: what it looks and sounds like).
// A plan is a list of timed steps; the last step has `fire: true` and is
// the moment the model's signal() is called. A signal with
// `waitForEvent` does not fire on its own clock: its last step arms and
// the world tells it when the thing it is waiting for has happened
// (a coin landing).

function rollBetween(range, rng) {
  var lo = Array.isArray(range) ? range[0] : range;
  var hi = Array.isArray(range) ? range[1] : range;
  return Math.round(lo + (hi - lo) * rng());
}

export var SIGNAL_KINDS = {
  // "Draw!" after a random delay.
  'draw-shout': function (def, rng) {
    var delay = rollBetween(def.delayMs || [1500, 4000], rng);
    return [{ at: delay, text: 'DRAW!', fire: true }];
  },
  // Someone fires a shot into the air.
  'starter-pistol': function (def, rng) {
    var delay = rollBetween(def.delayMs || [1500, 4000], rng);
    return [{ at: delay - 400, text: 'Ready...' }, { at: delay, text: 'BANG!', fire: true }];
  },
  // The flag comes down.
  'flag-drop': function (def, rng) {
    var delay = rollBetween(def.delayMs || [1500, 4000], rng);
    return [{ at: 0, text: 'Eyes on the flag' }, { at: delay, text: 'DROP!', fire: true }];
  },
  // A coin is tossed; draw when it lands. The step that tosses it is at
  // `at`; firing is left to the coin's own landed event.
  'coin-toss': function (def, rng) {
    var delay = rollBetween(def.delayMs || [1000, 2500], rng);
    return [{ at: delay, text: 'Coin up...', toss: true, waitForEvent: 'landed' }];
  },
  // The announcer counts the paces and you turn on ten. This is the
  // "paces is just a count" option from dueling.todo.md: it asks for no
  // walking and moves nobody.
  'ten-paces': function (def) {
    var paces = def.paces || 10;
    var stepMs = def.stepMs || 700;
    var steps = [];
    for (var i = 1; i <= paces; i++) steps.push({ at: i * stepMs, text: String(i), pace: i });
    steps.push({ at: paces * stepMs + stepMs, text: 'TURN!', fire: true });
    return steps;
  },
};

// The steps for a signal definition, in time order. Unknown kinds fall back
// to the shout rather than leaving a duel that can never start.
export function signalPlan(signalDef, rng) {
  var def = signalDef || {};
  var kind = SIGNAL_KINDS[def.kind] ? def.kind : 'draw-shout';
  var steps = SIGNAL_KINDS[kind](def, rng || Math.random);
  steps = steps.map(function (s) { return Object.assign({ kind: kind }, s, { at: Math.max(0, s.at) }); });
  steps.sort(function (a, b) { return a.at - b.at; });
  return steps;
}

// ---------- the duel ----------

function emptyRound(n) {
  return {
    round: n,
    signalAt: null,
    shots: 0,
    hits: 0,
    zones: {},
    downed: {},
    firstHitAt: null,
    lastHitAt: null,
    falseStarts: 0,
    penaltyMs: 0,
    redos: 0,
  };
}

export function createDuel(definition, options) {
  var def = normalizeDuel(definition);
  var opts = options || {};
  var listeners = [];
  if (opts.onEvent) listeners.push(opts.onEvent);
  var rng = opts.rng || Math.random;
  var targetCount = def.opponents.length;

  var duel = {
    def: def,
    phase: 'idle',
    round: 0,
    wins: 0,
    losses: 0,
    results: [], // one entry per decided round
    outcome: null, // match outcome, once phase is 'results'
    final: null, // the match results, once phase is 'results'
    holstered: false,
    plan: null, // the start signal's steps for the current round
    redosUsed: 0,
    cur: null,
    resolvedAt: null,
    lastNow: 0,
  };

  function emit(name, detail) {
    var payload = Object.assign({ duel: def.id, title: def.title, round: duel.round }, detail || {});
    for (var i = 0; i < listeners.length; i++) listeners[i](name, payload);
  }

  duel.on = function (fn) { listeners.push(fn); };

  function winsNeeded() { return Math.floor(def.rules.rounds / 2) + 1; }

  function beginRound(now, isRedo) {
    if (!isRedo) duel.round += 1;
    duel.cur = emptyRound(duel.round);
    duel.phase = 'setup';
    duel.holstered = false;
    duel.plan = null;
    duel.resolvedAt = null;
    emit('duel-setup', { rounds: def.rules.rounds, redo: Boolean(isRedo), at: now });
  }

  duel.start = function (now) {
    if (duel.phase !== 'idle') return false;
    duel.lastNow = now;
    emit('duel-start', { at: now, definition: def });
    beginRound(now, false);
    return true;
  };

  // The world reporting whether the player's hands are clear of every
  // gun. In setup, clear means the round can arm; in waiting, a hand
  // leaving the holster is the false start.
  duel.setHolstered = function (now, holstered) {
    duel.lastNow = now;
    duel.holstered = Boolean(holstered);
    if (duel.phase === 'setup' && holstered) {
      duel.plan = signalPlan(def.signal, rng);
      duel.phase = 'waiting';
      emit('duel-waiting', { at: now, plan: duel.plan });
      return true;
    }
    if (duel.phase === 'waiting' && !holstered) {
      duel.falseStart(now, 'draw');
      return true;
    }
    return false;
  };

  duel.signal = function (now) {
    if (duel.phase !== 'waiting') return false;
    duel.lastNow = now;
    duel.phase = 'live';
    duel.cur.signalAt = now;
    emit('duel-signal', { at: now, kind: def.signal.kind });
    return true;
  };

  // reason: 'draw' (a gun left its holster) or 'shot'.
  duel.falseStart = function (now, reason) {
    if (duel.phase !== 'waiting') return false;
    duel.lastNow = now;
    var rule = def.rules.falseStart;
    var cur = duel.cur;
    cur.falseStarts += 1;
    var consequence = rule.mode;
    if (rule.mode === 'redo' && duel.redosUsed >= (rule.maxRedos || 0)) consequence = 'forfeit';
    if (rule.mode === 'penalty') cur.penaltyMs += rule.penaltyMs || 0;
    emit('duel-false-start', { at: now, reason: reason || 'draw', mode: consequence, penaltyMs: cur.penaltyMs });
    if (consequence === 'forfeit') resolveRound(now, 'false-start');
    else if (consequence === 'redo') {
      duel.redosUsed += 1;
      duel.cur.redos = duel.redosUsed;
      duel.phase = 'resolved';
      duel.resolvedAt = now;
      duel.redoPending = true;
      emit('duel-round-end', { at: now, outcome: 'false-start-redo', won: false, redo: true });
    }
    return true;
  };

  duel.shotFired = function (now) {
    if (duel.phase === 'waiting') {
      duel.falseStart(now, 'shot');
      return;
    }
    if (duel.phase !== 'live') return;
    duel.lastNow = now;
    duel.cur.shots += 1;
    emit('duel-shot', { at: now, shots: duel.cur.shots });
  };

  // A cutout (or any opponent) went down. `id` makes a second hit on
  // the same one not count twice. A hit that does not drop it still
  // counts as a hit; a 'down' hit is what clears it.
  duel.hit = function (now, hit) {
    if (duel.phase !== 'live') return false;
    var cur = duel.cur;
    var id = hit && hit.id !== undefined ? hit.id : 'target-' + cur.hits;
    var killed = !hit || hit.killed !== false;
    duel.lastNow = now;
    if (cur.downed[id]) return false;
    cur.hits += 1;
    var zone = (hit && hit.zone) || 'torso';
    cur.zones[zone] = (cur.zones[zone] || 0) + 1;
    if (cur.firstHitAt === null) cur.firstHitAt = now;
    cur.lastHitAt = now;
    if (killed) cur.downed[id] = true;
    var reactionMs = cur.firstHitAt - cur.signalAt + cur.penaltyMs;
    emit('duel-hit', { at: now, id: id, zone: zone, hits: cur.hits, reactionMs: reactionMs, killed: killed });
    if (killed && Object.keys(cur.downed).length >= targetCount) resolveRound(now, 'cleared');
    return true;
  };

  function roundResult(outcome, now) {
    var cur = duel.cur;
    var scoring = def.scoring;
    var reactionMs = cur.firstHitAt === null ? null : cur.firstHitAt - cur.signalAt + cur.penaltyMs;
    var misses = Math.max(0, cur.shots - cur.hits);
    var accuracy = accuracyOf(Math.min(cur.hits, cur.shots || cur.hits), cur.shots || cur.hits);
    var forfeited = outcome === 'false-start';
    var points = 0;
    Object.keys(cur.zones).forEach(function (z) { points += (scoring.zonePoints[z] || 0) * cur.zones[z]; });
    return {
      round: cur.round,
      outcome: outcome,
      won: outcome === 'cleared',
      reactionMs: forfeited ? null : reactionMs,
      clearMs: outcome === 'cleared' ? cur.lastHitAt - cur.signalAt : null,
      shots: cur.shots,
      hits: cur.hits,
      misses: misses,
      accuracy: accuracy,
      zones: Object.assign({}, cur.zones),
      falseStarts: cur.falseStarts,
      penaltyMs: cur.penaltyMs,
      points: forfeited ? 0 : points,
      medal: forfeited || outcome !== 'cleared' ? null : medalFor(scoring, reactionMs, accuracy),
      endedAt: now,
    };
  }

  function resolveRound(now, outcome) {
    var result = roundResult(outcome, now);
    duel.results.push(result);
    if (result.won) duel.wins += 1;
    else duel.losses += 1;
    duel.phase = 'resolved';
    duel.resolvedAt = now;
    duel.redoPending = false;
    emit('duel-round-end', { at: now, outcome: outcome, won: result.won, result: result, wins: duel.wins, losses: duel.losses });
  }

  function matchDecided() {
    var need = winsNeeded();
    if (duel.wins >= need) return 'won';
    if (duel.losses >= need) return 'lost';
    if (duel.results.length >= def.rules.rounds) return duel.wins > duel.losses ? 'won' : duel.wins < duel.losses ? 'lost' : 'draw';
    return null;
  }

  function finish(now) {
    var outcome = matchDecided() || 'draw';
    var rounds = duel.results;
    var hits = 0;
    var shots = 0;
    var points = 0;
    var reactions = [];
    rounds.forEach(function (r) {
      hits += r.hits;
      shots += r.shots;
      points += r.points;
      if (r.reactionMs !== null) reactions.push(r.reactionMs);
    });
    var sum = reactions.reduce(function (a, b) { return a + b; }, 0);
    var accuracy = shots > 0 ? Math.min(hits, shots) / shots : 0;
    var best = reactions.length ? Math.min.apply(null, reactions) : null;
    var avg = reactions.length ? Math.round(sum / reactions.length) : null;
    duel.outcome = outcome;
    duel.phase = 'results';
    duel.final = {
      duel: def.id,
      title: def.title,
      outcome: outcome,
      rounds: rounds.slice(),
      wins: duel.wins,
      losses: duel.losses,
      hits: hits,
      shots: shots,
      misses: Math.max(0, shots - hits),
      accuracy: accuracy,
      bestReactionMs: best,
      avgReactionMs: avg,
      falseStarts: rounds.reduce(function (n, r) { return n + r.falseStarts; }, 0),
      points: points,
      medal: outcome === 'won' ? medalFor(def.scoring, avg, accuracy) : null,
    };
    emit('duel-results', Object.assign({ at: now }, duel.final));
  }

  // Time moves the duel along: a live round that runs out of time, and a
  // resolved round that has been on screen long enough to give way to
  // the next one (or to the results).
  duel.tick = function (now) {
    duel.lastNow = now;
    if (duel.phase === 'live' && now - duel.cur.signalAt >= def.rules.roundTimeMs) {
      resolveRound(now, 'timeout');
    }
    if (duel.phase === 'resolved' && now - duel.resolvedAt >= def.rules.betweenRoundsMs) {
      if (duel.redoPending) {
        duel.redoPending = false;
        beginRound(now, true);
      } else if (matchDecided()) finish(now);
      else beginRound(now, false);
    }
  };

  // Stop, wherever we are. Does not announce results (nothing was
  // finished); whoever started the duel is told through duel-aborted and
  // is responsible for giving the player's gear back.
  duel.abort = function (now, reason) {
    if (duel.phase === 'idle' || duel.phase === 'results') return false;
    duel.phase = 'idle';
    duel.aborted = true;
    emit('duel-aborted', { at: now, reason: reason || 'aborted', roundsPlayed: duel.results.length });
    return true;
  };

  duel.finished = function () { return duel.phase === 'results' || Boolean(duel.aborted); };

  return duel;
}

// ---------- modifiers (pure) ----------
//
// A modifier is a small piece of data, { id, ...params }, plus an
// apply/remove pair registered under that id. apply(ctx, params) does the
// change and returns whatever remove needs to undo it; remove(ctx, params,
// saved) puts it back. Stacking is the normal case, so removal runs in
// reverse order: two modifiers that touch the same thing unwind correctly.
// Modifiers that are not registered are skipped and reported rather than
// breaking the duel.

export function createModifierStack(registry, ctx) {
  var applied = [];
  var problems = [];
  return {
    apply: function (list) {
      (list || []).forEach(function (mod) {
        var impl = registry[mod.id];
        if (!impl) { problems.push({ id: mod.id, error: 'unknown modifier' }); return; }
        try {
          applied.push({ mod: mod, impl: impl, saved: impl.apply(ctx, mod) });
        } catch (e) {
          problems.push({ id: mod.id, error: String(e && e.message || e) });
        }
      });
    },
    removeAll: function () {
      while (applied.length) {
        var a = applied.pop();
        try { a.impl.remove(ctx, a.mod, a.saved); } catch (e) { problems.push({ id: a.mod.id, error: String(e && e.message || e) }); }
      }
    },
    active: function () { return applied.map(function (a) { return a.mod.id; }); },
    problems: problems,
  };
}

// ---------- weapon takeover (pure) ----------
//
// A duel that names its weapon hands it out, sets everything the player
// carries aside, and gives it all back afterwards. The world side is
// `api`, so this can be tested with fakes:
//
//   api.carried()        -> the things the player is carrying
//   api.setAside(item)   -> a token remembering where it was
//   api.give(weaponId)   -> a handle on the duel's weapon (or null: could not)
//   api.remove(handle)   -> take the duel's weapon away again
//   api.putBack(item, token)
//
// restore() is safe to call any time, any number of times: after a
// finished duel, after an aborted one, or when takeover never happened.

export function createLoadoutSwap(api) {
  var aside = [];
  var given = null;
  var active = false;
  return {
    takeover: function (weapon) {
      if (active || !weapon) return false;
      active = true;
      try {
        api.carried().forEach(function (item) { aside.push({ item: item, token: api.setAside(item) }); });
        given = api.give(weapon);
      } catch (e) {
        this.restore();
        throw e;
      }
      if (!given) { this.restore(); return false; }
      return true;
    },
    restore: function () {
      if (!active) return false;
      active = false;
      if (given) { try { api.remove(given); } catch (e) { /* keep restoring the rest */ } }
      given = null;
      while (aside.length) {
        var a = aside.pop();
        try { api.putBack(a.item, a.token); } catch (e) { /* one stuck gun must not strand the others */ }
      }
      return true;
    },
    isActive: function () { return active; },
    asideCount: function () { return aside.length; },
  };
}

// ---------- text for the results board (pure) ----------

export function formatMs(ms) {
  return ms === null || ms === undefined ? '--' : Math.round(ms) + ' ms';
}

function percent(x) { return Math.round(x * 100) + '%'; }

var OUTCOME_WORDS = {
  cleared: 'Cleared',
  timeout: 'Too slow',
  'false-start': 'FALSE START',
  'false-start-redo': 'False start, redo',
};

// One line per round: "R1  Cleared  412 ms  2/3  67%".
export function roundLine(r) {
  if (r.outcome === 'false-start') return 'R' + r.round + '  FALSE START';
  return 'R' + r.round + '  ' + (OUTCOME_WORDS[r.outcome] || r.outcome) + '  ' + formatMs(r.reactionMs) +
    '  ' + r.hits + '/' + r.shots + '  ' + percent(r.accuracy);
}

// The whole match as board lines: a headline, a line per round, a summary.
export function resultsLines(final) {
  var head = final.outcome === 'won' ? 'YOU WIN' : final.outcome === 'lost' ? 'YOU LOSE' : final.outcome === 'draw' ? 'DRAW' : 'DUEL OVER';
  var lines = [head + '  ' + final.wins + '-' + final.losses + (final.medal ? '   ' + final.medal.toUpperCase() + ' STAR' : '')];
  final.rounds.forEach(function (r) { lines.push(roundLine(r)); });
  lines.push('Best ' + formatMs(final.bestReactionMs) + '   Accuracy ' + percent(final.accuracy) + '   Hits ' + final.hits + '  Misses ' + final.misses);
  return lines;
}
