/**
 * Usage: npm i playwright && node verify.mjs <端口>
 *
 * Drives the real UI to prove the three data-driven mechanics behave:
 *   L7  a mystery bag opens only once it reaches the top of its cart
 *   L20 a covered cart unlocks when its key produce is pushed away
 *   L71 a one-way cart accepts produce but never gives it back
 * Also walks every level to catch load-time errors.
 */
import { chromium } from "playwright";

const PORT = process.argv[2] || "8765";
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1012 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const boot = async (level) => {
  await page.goto(`${BASE}?level=${level}`, { waitUntil: "load" });
  await page.waitForFunction("window.game && window.game.state.trucks.length > 0");
  // a tap during the unload animation only skips it, so wait the board out
  await page.waitForFunction("!window.game.state.busy", { timeout: 20000 });
  await page.waitForTimeout(150);
};

const board = () => page.evaluate("window.game.board()");
const tap = async (i) => {
  const p = await page.evaluate(`window.game.truckAt(${i})`);
  await page.mouse.click(p.x, p.y);
  // a move animates and holds the board; taps arriving during it are ignored,
  // so wait for idle rather than guessing a delay
  await page.waitForFunction("!window.game.state.busy", { timeout: 20000 });
  await page.waitForTimeout(60);
};

const results = [];
const check = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);

// --- L7: mystery reveal ---------------------------------------------------
await boot(7);
let b = await board();
const buried = b.findIndex((t) => t.hidden.length > 0);
check("L7 loads with closed mystery bags", buried >= 0, `truck ${buried} hidden=${b[buried]?.hidden}`);

const before = b[buried].hidden.length;
// pull the single visible top item off that cart onto anything that accepts it
const topType = b[buried].slots.filter((v) => v).slice(-1)[0];
const dest = b.findIndex(
  (t, i) => i !== buried && !t.cover && !t.stuck && t.slots.filter((v) => v).length === 0
);
if (dest >= 0) {
  await tap(buried);
  await tap(dest);
  b = await board();
  check(
    "L7 bag under the removed item opens",
    b[buried].hidden.length === before - 1,
    `hidden ${before} -> ${b[buried].hidden.length}`
  );
  check("L7 moved exactly the visible run", b[dest].slots.includes(topType));
} else {
  check("L7 reveal", false, "no empty cart to move onto");
}

// --- L20: cover unlocks on its key colour ---------------------------------
await boot(20);
b = await board();
const covered = b.map((t, i) => ({ ...t, i })).filter((t) => t.cover);
check("L20 loads with covered carts", covered.length === 3, `${covered.length} covered`);
const keyType = 2; // cart 4 is keyed to the banana in the shipped data
check("L20 a cover is keyed to the banana", covered.some((t) => t.cover === keyType));

// carts 0 and 2 each top out with a banana pair, but both are full, so the
// pairs have to meet on the empty cart to make a shippable set of four
const empty = b.findIndex((t) => !t.cover && !t.stuck && t.slots.every((v) => !v));
await tap(0);
await tap(empty);
await tap(2);
await tap(empty);
b = await board();
check(
  "L20 shipping the banana set lifts every banana-keyed cover",
  b.every((t) => t.cover !== keyType),
  `covers now ${b.map((t) => t.cover).join(",")}`
);

// --- L71: one-way truck takes items but never releases them ---------------
await boot(71);
b = await board();
const oneWay = b.findIndex((t) => t.stuck);
check("L71 has a one-way cart", oneWay >= 0, `cart ${oneWay} slots=${b[oneWay]?.slots}`);
const beforeSlots = JSON.stringify(b[oneWay].slots);
await tap(oneWay); // selecting it must be refused
check(
  "L71 one-way cart cannot be selected",
  (await page.evaluate("window.game.state.selected")) === -1
);
check("L71 one-way cart contents untouched", JSON.stringify((await board())[oneWay].slots) === beforeSlots);

// --- every level loads ----------------------------------------------------
await boot(1);
const total = await page.evaluate("window.game.levelCount()");
let loadFails = [];
for (let id = 1; id <= total; id++) {
  const ok = await page.evaluate(
    `(() => { window.game.gotoLevelId(${id}); if (window.game.state.intro) window.game.state.intro.skip = true; const t = window.game.state.trucks; return t.length > 0 && t.every(x => x.slots.length === 4); })()`
  );
  if (!ok) loadFails.push(id);
}
check(`all ${total} levels load and build a board`, loadFails.length === 0, loadFails.slice(0, 8).join(","));
check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
