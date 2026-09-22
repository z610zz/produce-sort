/**
 * Plays every level in levels.json headlessly, using the same rules game.js
 * enforces, and reports which ones it can finish.
 *
 * Mystery crates are deliberately treated as the *player* sees them: an
 * unrevealed crate never joins a pickup run. That makes this a check on the
 * rule implementation, not just on the level data.
 *
 * Greedy with randomised restarts. A level it cannot finish is not proof the
 * level is broken — the shipped levels are reverse-shuffled from a solved
 * state, so they are winnable by construction. It is a smoke test for rules
 * that make a level *structurally* dead, e.g. covers that can never lift.
 */
import fs from "node:fs";

const CAP = 4;
const { levels } = JSON.parse(fs.readFileSync(new URL("../levels.json", import.meta.url)));

function init(level) {
  return level.trucks.map((t) => ({
    slots: [...t.slots],
    hidden: new Set(t.hidden || []),
    stuck: !!t.stuck,
    cover: t.cover || 0,
    shipped: false,
  }));
}

const filled = (t) => t.slots.filter((v) => v).length;

function topIndex(t) {
  for (let i = CAP - 1; i >= 0; i--) if (t.slots[i]) return i;
  return -1;
}

function revealTops(trucks) {
  for (const t of trucks) {
    const top = topIndex(t);
    if (top >= 0 && t.hidden.has(top)) t.hidden.delete(top);
  }
}

function topRun(t) {
  const top = topIndex(t);
  if (top < 0 || t.hidden.has(top)) return { type: 0, count: 0, from: -1 };
  const type = t.slots[top];
  let count = 0;
  for (let i = top; i >= 0; i--) {
    if (t.slots[i] !== type || t.hidden.has(i)) break;
    count++;
  }
  return { type, count, from: top - count + 1 };
}

const canSelect = (t) => !t.shipped && !t.cover && !t.stuck && topRun(t).count > 0;
const isSolved = (t) => filled(t) === CAP && new Set(t.slots).size === 1;

/** Shipping a set lifts every cover keyed to that type, which can cascade. */
function collectShips(trucks, startIdx) {
  const queue = [startIdx];
  let n = 0;
  while (queue.length) {
    const i = queue.shift();
    const t = trucks[i];
    if (!t || t.shipped || t.cover || !isSolved(t)) continue;
    const type = t.slots[0];
    t.shipped = true;
    t.slots = [0, 0, 0, 0];
    n++;
    trucks.forEach((o, j) => {
      if (o.cover === type) {
        o.cover = 0;
        queue.push(j);
      }
    });
  }
  return n;
}

function attempt(level, rng, maxSteps = 3000) {
  const trucks = init(level);
  revealTops(trucks);
  const seen = new Set();
  for (let step = 0; step < maxSteps; step++) {
    if (trucks.every((t) => filled(t) === 0)) return true;
    const key = trucks
      .map((t) => `${t.slots}|${[...t.hidden].sort()}|${t.cover}|${t.stuck ? 1 : 0}`)
      .join(";");
    if (seen.has(key)) return false;
    seen.add(key);

    const moves = [];
    trucks.forEach((src, i) => {
      if (!canSelect(src)) return;
      const run = topRun(src);
      trucks.forEach((dst, j) => {
        if (i === j || dst.shipped || dst.cover) return;
        const free = CAP - filled(dst);
        if (free <= 0) return;
        if (filled(dst) && topRun(dst).type !== run.type) return;
        const n = Math.min(run.count, free);
        // rank: completing a set, then packing onto a match, then burning a buffer
        let score = filled(dst) === 0 ? 0 : filled(dst) + n === CAP ? 3 : 2;
        moves.push({ score: score + rng(), i, j, n, run });
      });
    });
    if (!moves.length) return false;
    moves.sort((a, b) => b.score - a.score);
    const { i, j, n, run } = moves[0];
    for (let k = 0; k < n; k++) {
      const idx = run.from + run.count - 1 - k;
      const type = trucks[i].slots[idx];
      trucks[i].slots[idx] = 0;
      trucks[j].slots[trucks[j].slots.indexOf(0)] = type;
    }
    revealTops(trucks);
    collectShips(trucks, j);
  }
  return false;
}

/** Structural check: can covers ever all lift, ignoring stack order? */
function coversCanLift(level) {
  const trucks = init(level);
  const open = trucks.map((t) => !t.cover);
  const shipped = new Set();
  for (;;) {
    const pool = new Map();
    trucks.forEach((t, i) => {
      if (!open[i]) return;
      t.slots.forEach((v) => v && pool.set(v, (pool.get(v) || 0) + 1));
    });
    const ready = [...pool].filter(([type, c]) => c >= CAP && !shipped.has(type));
    if (!ready.length) break;
    ready.forEach(([type]) => shipped.add(type));
    let changed = false;
    trucks.forEach((t, i) => {
      if (!open[i] && shipped.has(t.cover)) {
        open[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return open.every(Boolean);
}

let mulberry = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const failed = [];
const deadCovers = [];
const badCounts = [];

for (const level of levels) {
  const counts = new Map();
  level.trucks.forEach((t) =>
    t.slots.forEach((v) => v && counts.set(v, (counts.get(v) || 0) + 1))
  );
  if ([...counts.values()].some((c) => c % CAP)) badCounts.push(level.id);
  if (!coversCanLift(level)) deadCovers.push(level.id);

  const rng = mulberry(level.id * 7919);
  let ok = false;
  for (let r = 0; r < 120 && !ok; r++) ok = attempt(level, rng);
  if (!ok) failed.push(level.id);
}

console.log(`levels: ${levels.length}`);
console.log(`item counts not a multiple of ${CAP}: ${badCounts.length}`, badCounts.slice(0, 10));
console.log(`covers that can never lift: ${deadCovers.length}`, deadCovers.slice(0, 10));
console.log(`greedy solver finished: ${levels.length - failed.length}/${levels.length}`);
console.log(`greedy solver gave up on ${failed.length}:`, failed.slice(0, 30));
