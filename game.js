/**
 * A sort-and-clear puzzle in Three.js, themed as a grocery run.
 *
 * Rules: pick up the contiguous run of matching produce on top of a cart,
 * capacity 4, place on an empty cart or one whose top matches, auto-ship when
 * four of a kind meet. Level layouts come from levels.json.
 */
import * as THREE from "three";
import { PRODUCE, makeProduce, disposeProduce } from "./produce.js";

const CAPACITY = 4;

/**
 * Ten produce types, matching the 1..10 item ids in the shipped level data.
 * The 3D models live in produce.js; the colour here is what UI chrome (cover
 * straps, badges) tints itself with so it always agrees with the model.
 */
const ITEM = PRODUCE;

/**
 * Teaching copy for the levels that first introduce a mechanic. Everything
 * else plays without a banner.
 */
const HINTS = {
  1: "<b>点一下</b>购物车拿起果蔬，再<b>点</b>另一辆车把它们放过去。",
  2: "只能放到<b>顶上是同一种果蔬</b>的车上！",
  3: "空购物车是你的周转位 — 继续整理就能过关。",
  5: "种类变多了。集齐 <b>4 个相同果蔬</b>，这车就会被推走。",
  7: "<b>?</b> 纸袋看不见内容，露到最上面才会打开。",
  20: "<b>盖住</b>的购物车锁着。推走一车对应的果蔬就能掀开它。",
  60: "<b>单向</b>购物车只进不出。把它装满才能推走。",
};

/** Populated from levels.json (Level_1..200 dumped from the 1.0.1 bundle). */
let LEVELS = [];

/** Widest board the shipped levels use, so boosted trucks can't overflow it. */
const MAX_TRUCKS = 15;

/** Slot 0 sits at the near end of the basket; the accessible top slot is furthest up-screen. */
const SLOT_Z0 = 0.62;
const SLOT_STEP = 0.55;
/** Top face of the cart basket, i.e. what the produce rests on. */
const CARGO_Y = 0.42;
const PICK_LIFT = 0.42;

const state = {
  levelIndex: 0,
  trucks: [],
  selected: -1,
  history: [],
  shuffleLeft: 3,
  addLeft: 2,
  busy: false,
  won: false,
  /** Slot keys ("cart:slot") still in the lorry during the unload animation. */
  pending: null,
  /** Set while the opening sequence runs, so a tap can fast-forward it. */
  intro: null,
};

const ui = {
  levelTag: document.getElementById("levelTag"),
  hint: document.getElementById("hint"),
  toast: document.getElementById("toast"),
  levelInput: document.getElementById("levelInput"),
  levelTotal: document.getElementById("levelTotal"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayDesc: document.getElementById("overlayDesc"),
  undoCount: document.getElementById("undoCount"),
  shuffleCount: document.getElementById("shuffleCount"),
  addCount: document.getElementById("addCount"),
};

const app = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x394653);
scene.fog = new THREE.Fog(0x394653, 44, 86);

const camera = new THREE.OrthographicCamera(-4, 4, 8, -8, 0.1, 140);
camera.position.set(0, 14.5, 8.2);
camera.lookAt(0, 0, -0.6);

/**
 * Ground-plane mapping for this fixed orthographic rig: a point at camera-space
 * height `v` lands on world z = GROUND_Z0 + GROUND_K * v. Used to pin the truck
 * row to the bottom edge and the focus vehicle near the top on any aspect.
 */
const GROUND_Z0 = -0.6;
const GROUND_K = -1.16974;
const HORIZ_SPAN = 10.4;
const BOTTOM_Z = 5.9;
const zAtV = (v) => GROUND_Z0 + GROUND_K * v;
const vAtZ = (z) => (z - GROUND_Z0) / GROUND_K;

const hemi = new THREE.HemisphereLight(0xeaf8ff, 0x18412c, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 1.65);
sun.position.set(4, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 46;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xbfe4ff, 0.4);
rim.position.set(-6, 8, -8);
scene.add(rim);

const root = new THREE.Group();
scene.add(root);
const truckRoot = new THREE.Group();
root.add(truckRoot);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const truckMeshes = [];
const textureCache = new Map();

/**
 * Rounded slab with the fillet in plan view, which is what the top-down
 * camera actually sees. Extruded along Y so width/depth stay in XZ.
 */
function roundedSlab(width, depth, height, radius = 0.08, bevel = 0.03) {
  const r = Math.max(0.001, Math.min(radius, Math.min(width, depth) / 2 - 0.002));
  const w = width / 2 - r;
  const d = depth / 2 - r;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -d - r);
  shape.lineTo(w, -d - r);
  shape.quadraticCurveTo(w + r, -d - r, w + r, -d);
  shape.lineTo(w + r, d);
  shape.quadraticCurveTo(w + r, d + r, w, d + r);
  shape.lineTo(-w, d + r);
  shape.quadraticCurveTo(-w - r, d + r, -w - r, d);
  shape.lineTo(-w - r, -d);
  shape.quadraticCurveTo(-w - r, -d - r, -w, -d - r);

  const b = Math.max(0.001, Math.min(bevel, height / 2 - 0.002, r * 0.8));
  const core = Math.max(height - b * 2, 0.001);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geo.translate(0, 0, -core / 2);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}


function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}



function makeWheel(radius = 0.19, width = 0.16) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 18),
    new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.85 })
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd9e4ee, roughness: 0.4, metalness: 0.35 });
  for (const side of [-1, 1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 0.03, 14), rimMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * (width / 2 + 0.008);
    g.add(hub);
  }
  return g;
}

function buildEnvironment() {
  // Neutral warm-grey aisle. The produce is the only saturated thing on the
  // board, so anything livelier down here competes with it.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(13.2, 78),
    new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.85, metalness: 0.02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 78),
    new THREE.MeshStandardMaterial({ color: 0x6d6860, roughness: 0.92 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.012;
  root.add(surround);

  const grout = new THREE.MeshBasicMaterial({ color: 0x777168 });
  const alongZ = roundedSlab(0.055, 78, 0.02, 0.02, 0.006);
  for (let x = -6.6; x <= 6.6; x += 1.65) {
    const line = new THREE.Mesh(alongZ, grout);
    line.position.set(x, 0.014, 0);
    root.add(line);
  }
  const alongX = roundedSlab(13.2, 0.055, 0.02, 0.02, 0.006);
  for (let z = -36; z <= 36; z += 1.65) {
    const line = new THREE.Mesh(alongX, grout);
    line.position.set(0, 0.014, z);
    root.add(line);
  }

  buildAisleBins();
  root.add(buildLorry());
}

/**
 * Produce bins lining both sides of the aisle. They sit just outside the play
 * column, so they only ever show at the screen edge — kept deliberately cheap.
 */
function buildAisleBins() {
  const crate = new THREE.MeshStandardMaterial({ color: 0xbfa377, roughness: 0.74 });
  const crateLip = new THREE.MeshStandardMaterial({ color: 0x9c8058, roughness: 0.78 });
  const bodyGeo = roundedSlab(1.55, 2.0, 0.66, 0.1, 0.04);
  const lipGeo = roundedSlab(1.68, 2.13, 0.13, 0.08, 0.04);

  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const z = -30 + i * 5.1;
      const bin = new THREE.Group();

      const body = new THREE.Mesh(bodyGeo, crate);
      body.castShadow = true;
      body.receiveShadow = true;
      bin.add(body);

      const lip = new THREE.Mesh(lipGeo, crateLip);
      lip.position.y = 0.64;
      bin.add(lip);

      const type = ((i * 3 + (side > 0 ? 2 : 0)) % 10) + 1;
      for (const [dx, dz] of [
        [-0.3, -0.42],
        [0.31, 0.16],
      ]) {
        const p = makeProduce(type);
        p.position.set(dx, 0.62, dz);
        p.scale.setScalar(1.2);
        bin.add(p);
      }

      bin.position.set(side * 5.5, 0, z);
      root.add(bin);
    }
  }
}

/**
 * The grocery lorry at the top of the board, replacing the old ambulance.
 *
 * Its cargo bed is deliberately open-topped. With the near-vertical board
 * camera a roofed box would read as a closed lid and the whole "tailgate
 * drops, produce flies out" beat would be invisible; open-topped, you can see
 * the load sitting in the bed and the gate visibly swinging flat.
 *
 * Built nose-up-screen (cab at -Z, tailgate at +Z) because it reverses into
 * frame and later drives forwards off the top.
 */
function buildLorry() {
  const van = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xf3eee2, roughness: 0.42 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3fa85a, roughness: 0.4 });
  const greenDark = new THREE.MeshStandardMaterial({ color: 0x2f8746, roughness: 0.44 });
  const deck = new THREE.MeshStandardMaterial({ color: 0xb5ad9c, roughness: 0.72 });
  const gateFace = new THREE.MeshStandardMaterial({ color: 0xe9e3d4, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x8ed3ec, roughness: 0.18, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb3bec9, roughness: 0.36, metalness: 0.42 });

  const BW = 2.36;
  const BD = 3.1;
  const WALL = 0.62;
  const DECK_Y = 0.46;

  const bed = new THREE.Mesh(roundedSlab(BW, BD, DECK_Y, 0.12, 0.05), deck);
  bed.position.set(0, 0, -0.1);
  bed.castShadow = true;
  bed.receiveShadow = true;
  van.add(bed);
  van.userData.deckY = DECK_Y;

  for (const x of [-1, 1]) {
    const side = new THREE.Mesh(roundedSlab(0.15, BD, WALL, 0.06, 0.03), green);
    side.position.set(x * (BW / 2 - 0.05), DECK_Y, -0.1);
    side.castShadow = true;
    van.add(side);
  }
  const headboard = new THREE.Mesh(roundedSlab(BW, 0.16, WALL + 0.12, 0.07, 0.03), green);
  headboard.position.set(0, DECK_Y, -BD / 2 - 0.04);
  headboard.castShadow = true;
  van.add(headboard);

  // tailgate: hinged along the rear lip of the deck. Authored lying flat and
  // pointing +Z, so rotation.x = -PI/2 stands it shut.
  const gate = new THREE.Group();
  const panel = new THREE.Mesh(roundedSlab(BW, 1.28, 0.15, 0.07, 0.03), gateFace);
  panel.position.set(0, 0, 0.64);
  panel.castShadow = true;
  gate.add(panel);
  const gateEdge = new THREE.Mesh(roundedSlab(BW + 0.08, 0.16, 0.1, 0.05, 0.03), greenDark);
  gateEdge.position.set(0, 0.06, 1.24);
  gate.add(gateEdge);
  for (const x of [-0.62, 0.62]) {
    const slat = new THREE.Mesh(roundedSlab(0.12, 1.0, 0.07, 0.04, 0.02), green);
    slat.position.set(x, 0.1, 0.62);
    gate.add(slat);
  }
  const hinge = new THREE.Mesh(roundedSlab(BW + 0.06, 0.14, 0.1, 0.05, 0.02), greenDark);
  hinge.position.set(0, DECK_Y, BD / 2 - 0.1);
  van.add(hinge);
  gate.position.set(0, DECK_Y - 0.03, BD / 2 - 0.1);
  gate.rotation.x = -Math.PI / 2;
  van.add(gate);
  van.userData.gate = gate;
  van.userData.gateOpen = 0;

  // cab, up-screen of the bed
  const cab = new THREE.Mesh(roundedSlab(BW - 0.12, 1.34, 1.02, 0.16, 0.06), shell);
  cab.position.set(0, 0.24, -BD / 2 - 0.86);
  cab.castShadow = true;
  van.add(cab);
  const cabRoof = new THREE.Mesh(roundedSlab(BW - 0.34, 0.86, 0.16, 0.12, 0.05), green);
  cabRoof.position.set(0, 1.3, -BD / 2 - 0.74);
  cabRoof.castShadow = true;
  van.add(cabRoof);
  const windscreen = new THREE.Mesh(roundedSlab(BW - 0.5, 0.3, 0.1, 0.07, 0.03), glass);
  windscreen.position.set(0, 1.28, -BD / 2 - 1.34);
  van.add(windscreen);

  for (const x of [-0.72, 0.72]) {
    const lamp = new THREE.Mesh(
      roundedSlab(0.26, 0.14, 0.12, 0.05, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0xfff3cf,
        emissive: 0xffe6a2,
        emissiveIntensity: 0.4,
        roughness: 0.3,
      })
    );
    lamp.position.set(x, 0.42, -BD / 2 - 1.52);
    van.add(lamp);
  }
  const bumper = new THREE.Mesh(roundedSlab(BW - 0.1, 0.18, 0.18, 0.08, 0.04), steel);
  bumper.position.set(0, 0.22, -BD / 2 - 1.58);
  van.add(bumper);
  for (const x of [-(BW / 2 + 0.12), BW / 2 + 0.12]) {
    const mirror = new THREE.Mesh(roundedSlab(0.18, 0.13, 0.1, 0.04, 0.02), shell);
    mirror.position.set(x, 1.0, -BD / 2 - 1.2);
    van.add(mirror);
  }

  const wheels = [];
  for (const x of [-(BW / 2 - 0.02), BW / 2 - 0.02]) {
    for (const z of [-BD / 2 - 1.05, -0.62, 0.72]) {
      const wheel = makeWheel(0.26, 0.18);
      wheel.position.set(x, 0.26, z);
      van.add(wheel);
      wheels.push(wheel);
    }
  }
  van.userData.wheels = wheels;

  // the load the level is about to be dealt out of
  const load = new THREE.Group();
  load.name = "lorryLoad";
  load.position.y = DECK_Y;
  van.add(load);
  van.userData.load = load;

  van.scale.setScalar(0.86);
  van.position.set(0, 0, -7.8);
  state.focusVan = van;
  state.focusVanHomeZ = van.position.z;
  state.focusVanExitZ = -22;
  return van;
}

/** 0 = shut and upright, 1 = dropped flat into a ramp. */
function setTailgate(van, open) {
  if (!van || !van.userData.gate) return;
  van.userData.gateOpen = open;
  van.userData.gate.rotation.x = -Math.PI / 2 * (1 - open);
}


function cloneTrucks(defs) {
  return defs.map((t) => ({
    slots: [...t.slots],
    hidden: new Set(t.hidden || []),
    stuck: !!t.stuck,
    cover: t.cover || 0,
    shipped: false,
  }));
}

function topIndex(truck) {
  for (let i = CAPACITY - 1; i >= 0; i--) if (truck.slots[i] !== 0) return i;
  return -1;
}

/**
 * A mystery crate turns face-up the moment nothing sits on top of it, which is
 * also what makes it usable: an unrevealed crate never joins a pickup run.
 */
function revealTops() {
  let changed = false;
  state.trucks.forEach((truck) => {
    const top = topIndex(truck);
    if (top >= 0 && truck.hidden.has(top)) {
      truck.hidden.delete(top);
      changed = true;
    }
  });
  return changed;
}

function topRun(truck) {
  const top = topIndex(truck);
  if (top < 0 || truck.hidden.has(top)) return { type: 0, count: 0, from: -1 };
  const type = truck.slots[top];
  let count = 0;
  for (let i = top; i >= 0; i--) {
    if (truck.slots[i] !== type || truck.hidden.has(i)) break;
    count++;
  }
  return { type, count, from: top - count + 1 };
}

function filledCount(truck) {
  return truck.slots.filter((x) => x !== 0).length;
}

function freeSlots(truck) {
  return CAPACITY - filledCount(truck);
}

function isSolved(truck) {
  if (filledCount(truck) !== CAPACITY) return false;
  const t = truck.slots[0];
  return t !== 0 && truck.slots.every((x) => x === t);
}

function canSelect(truck) {
  if (truck.shipped || truck.cover || truck.stuck) return false;
  return topRun(truck).count > 0;
}

function canPlace(run, dest) {
  if (!run.type || dest.shipped || dest.cover) return false;
  const free = freeSlots(dest);
  if (free <= 0) return false;
  if (filledCount(dest) === 0) return true;
  const top = topRun(dest);
  return top.type === run.type;
}

function snapshot() {
  return {
    trucks: state.trucks.map((t) => ({
      slots: [...t.slots],
      hidden: new Set(t.hidden),
      stuck: t.stuck,
      cover: t.cover,
      shipped: t.shipped,
    })),
    shuffleLeft: state.shuffleLeft,
    addLeft: state.addLeft,
  };
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 40) state.history.shift();
  refreshBoosterUI();
}

function transfer(srcIdx, dstIdx) {
  const src = state.trucks[srcIdx];
  const dst = state.trucks[dstIdx];
  if (!canSelect(src)) return null;
  const run = topRun(src);
  if (!canPlace(run, dst)) return null;
  const n = Math.min(run.count, freeSlots(dst));
  pushHistory();
  const moves = [];
  for (let i = 0; i < n; i++) {
    const idx = run.from + run.count - 1 - i;
    const type = src.slots[idx];
    src.slots[idx] = 0;
    const empty = dst.slots.findIndex((x) => x === 0);
    dst.slots[empty] = type;
    moves.push({ type, fromSlot: idx, toSlot: empty });
  }
  revealTops();
  return { moves, shipped: collectShips(dstIdx) };
}

/**
 * Shipping a set lifts every cover of that type, and a truck revealed that way
 * may already be complete — so keep cascading until nothing new ships.
 */
function collectShips(startIdx) {
  const queue = [startIdx];
  const shipped = [];
  while (queue.length) {
    const i = queue.shift();
    const truck = state.trucks[i];
    if (!truck || truck.shipped || truck.cover || shipped.includes(i) || !isSolved(truck)) continue;
    shipped.push(i);
    const type = truck.slots[0];
    state.trucks.forEach((t, j) => {
      if (t.cover === type) {
        t.cover = 0;
        queue.push(j);
      }
    });
  }
  return shipped;
}

function checkWin() {
  const alive = state.trucks.filter((t) => !t.shipped);
  const clear = alive.every((t) => filledCount(t) === 0 && !t.cover);
  if (clear) {
    state.won = true;
    playLevelClear();
  } else if (isDeadlock()) {
    setTimeout(() => showOverlay(false), 300);
  }
}

function isDeadlock() {
  for (let i = 0; i < state.trucks.length; i++) {
    const src = state.trucks[i];
    if (!canSelect(src)) continue;
    const run = topRun(src);
    for (let j = 0; j < state.trucks.length; j++) {
      if (i === j) continue;
      if (canPlace(run, state.trucks[j])) return false;
    }
  }
  return state.trucks.some((t) => !t.shipped && filledCount(t) > 0);
}

/**
 * Frame-stepped tween that resolves early when the player taps to skip the
 * opening. Every animation in the intro goes through this so a single tap
 * fast-forwards all of them consistently.
 */
function tween(duration, onStep, delay = 0) {
  return new Promise((resolve) => {
    const t0 = performance.now() + delay;
    function step(now) {
      if (state.intro && state.intro.skip) {
        onStep(1);
        resolve();
        return;
      }
      if (now < t0) {
        requestAnimationFrame(step);
        return;
      }
      const u = Math.min(1, (now - t0) / duration);
      onStep(u * u * (3 - 2 * u));
      if (u < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

/** Rolls the lorry to a target Z, spinning the wheels the right way round. */
function driveVanTo(van, targetZ, duration, delay = 0) {
  const startZ = van.position.z;
  const dist = targetZ - startZ;
  const wheels = van.userData.wheels || [];
  return tween(
    duration,
    (e) => {
      van.position.z = startZ + dist * e;
      wheels.forEach((w) => (w.rotation.x = Math.sign(dist) * e * 14));
    },
    delay
  );
}

function tweenTailgate(van, to, duration, delay = 0) {
  const from = van.userData.gateOpen || 0;
  return tween(duration, (e) => setTailgate(van, from + (to - from) * e), delay);
}

/**
 * Level opening: the lorry reverses into frame, drops its tailgate, and throws
 * the level's produce out into the carts.
 *
 * The board is built with every occupied slot listed in `state.pending`, which
 * makes `rebuildCargo` skip it; each piece is removed from that set as it
 * lands, so the carts fill in step with the animation.
 */
let introRun = 0;

async function playLevelIntro() {
  const van = state.focusVan;
  if (!van) return;
  const run = ++introRun;

  state.intro = { skip: false };
  state.busy = true;
  refreshBoosterUI();

  state.pending = new Set();
  state.trucks.forEach((truck, i) =>
    truck.slots.forEach((type, slot) => {
      if (type && !truck.cover) state.pending.add(`${i}:${slot}`);
    })
  );
  rebuildAllTrucks();

  setTailgate(van, 0);
  van.position.z = state.focusVanEntryZ;
  fillLorryBed();

  await driveVanTo(van, state.focusVanHomeZ, 620);
  if (run !== introRun) return; // a level change superseded this opening
  await tweenTailgate(van, 1, 300);
  if (run !== introRun) return;
  await unloadToCarts(run);
  if (run !== introRun) return;

  clearLorryBed();
  van.position.z = state.focusVanHomeZ;
  state.pending = null;
  state.intro = null;
  rebuildAllTrucks();
  state.busy = false;
  refreshBoosterUI();
}

/** A visible load in the bed, so there is something for the lorry to throw. */
function fillLorryBed() {
  const van = state.focusVan;
  const load = van && van.userData.load;
  if (!load) return;
  clearLorryBed();
  const types = [];
  state.trucks.forEach((t) => t.slots.forEach((v) => v && types.push(v)));
  for (let i = 0; i < Math.min(9, types.length); i++) {
    const p = makeProduce(types[(i * 5) % types.length]);
    p.position.set(((i % 3) - 1) * 0.62, 0, Math.floor(i / 3) * 0.66 - 0.72);
    p.scale.setScalar(1.05);
    load.add(p);
  }
}

function clearLorryBed() {
  const load = state.focusVan && state.focusVan.userData.load;
  if (!load) return;
  while (load.children.length) disposeProduce(load.children.pop());
}

/**
 * Arcs one produce model between two world points and then calls `onLand`.
 *
 * Shared by the opening unload and by cart-to-cart moves so both read as the
 * same motion. The slot being flown into is listed in `state.pending`, which
 * makes `rebuildCargo` leave it empty until the piece actually arrives.
 */
function flyItem({ type, hidden, scale, from, to, apex, duration, delay = 0, onLand }) {
  const flier = hidden ? makeMysteryBag() : makeProduce(type);
  flier.scale.setScalar(scale);
  flier.position.copy(from);
  root.add(flier);
  const spin = (Math.random() - 0.5) * 4;

  return tween(
    duration,
    (e) => {
      flier.position.lerpVectors(from, to, e);
      flier.position.y += Math.sin(e * Math.PI) * apex;
      flier.rotation.y = spin * (1 - e);
      if (e >= 1) {
        root.remove(flier);
        disposeProduce(flier);
        onLand();
      }
    },
    delay
  );
}

/** World position of a cart's slot, as a produce model would sit in it. */
function slotWorldPosition(cartIndex, slot, lift = 0) {
  const mesh = truckMeshes[cartIndex];
  if (!mesh) return new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  return new THREE.Vector3(0, CARGO_Y + lift, SLOT_Z0 - slot * SLOT_STEP).applyMatrix4(
    mesh.matrixWorld
  );
}

/**
 * Throws one produce model per pending slot along an arc from the open
 * tailgate into its cart. Carts are staggered slightly and slots within a cart
 * more so, which keeps even a 13-cart board under about 1.2s.
 */
function unloadToCarts(run) {
  const van = state.focusVan;
  const flights = [];

  state.trucks.forEach((truck, i) => {
    const mesh = truckMeshes[i];
    if (!mesh || truck.cover) return;
    truck.slots.forEach((type, slot) => {
      const key = `${i}:${slot}`;
      if (!type || !state.pending.has(key)) return;

      flights.push(
        flyItem({
          type,
          hidden: truck.hidden.has(slot),
          scale: mesh.scale.x,
          from: new THREE.Vector3(
            (Math.random() - 0.5) * 1.4,
            van.userData.deckY + 0.2,
            van.position.z + 1.6
          ),
          to: slotWorldPosition(i, slot),
          apex: 1.5 + Math.random() * 0.5,
          duration: 420,
          delay: i * 40 + slot * 90,
          onLand: () => {
            // a level change mid-flight rebuilds `pending` for the new board,
            // so a stale flight must not mark anything delivered there
            if (run === introRun && state.pending) {
              state.pending.delete(key);
              rebuildCargo(i);
            }
          },
        })
      );
    });
  });

  return Promise.all(flights);
}

/**
 * Flies the moved produce from the source cart to the destination instead of
 * having it appear there. `transfer` has already mutated the board, so the
 * destination slots are held back through `state.pending` until they land.
 *
 * Kept deliberately short: this is the core interaction, and every extra
 * millisecond here is felt on every single move.
 */
function animateTransfer(srcIdx, dstIdx, moves) {
  const dstMesh = truckMeshes[dstIdx];
  if (!dstMesh || !moves.length) return Promise.resolve();

  state.pending = new Set(moves.map((m) => `${dstIdx}:${m.toSlot}`));
  rebuildAllTrucks();

  const gap = slotWorldPosition(srcIdx, 0).distanceTo(slotWorldPosition(dstIdx, 0));

  const flights = moves.map((m, k) =>
    flyItem({
      type: m.type,
      hidden: false,
      scale: dstMesh.scale.x,
      // leaves from where the lifted selection was sitting
      from: slotWorldPosition(srcIdx, m.fromSlot, PICK_LIFT),
      to: slotWorldPosition(dstIdx, m.toSlot),
      apex: Math.min(1.5, 0.4 + gap * 0.16),
      duration: 230,
      delay: k * 45,
      onLand: () => {
        if (state.pending) {
          state.pending.delete(`${dstIdx}:${m.toSlot}`);
          rebuildCargo(dstIdx);
        }
      },
    })
  );

  return Promise.all(flights).then(() => {
    state.pending = null;
    rebuildAllTrucks();
  });
}
/**
 * Level clear: the emptied carts roll away first, then the lorry shuts its
 * tailgate and pulls forward off the top of the screen, and only then does the
 * popup show.
 */
async function playLevelClear() {
  state.busy = true;
  refreshBoosterUI();

  // Front row pulls out before the back row, so nothing rolls through anything.
  const parked = truckMeshes.filter((m) => m && m.visible).sort((a, b) => b.position.z - a.position.z);
  await Promise.all(
    parked.map((m, i) =>
      driveOut(m, { distance: 14, duration: 620, delay: i * 110, fadeFrom: 0.5, spin: 14 })
    )
  );
  parked.forEach((m) => (m.visible = false));

  const van = state.focusVan;
  if (van) {
    await tweenTailgate(van, 0, 340, 120);
    await driveVanTo(van, state.focusVanExitZ, 1000, 120);
  }
  state.busy = false;
  showOverlay(true);
}

function showOverlay(won) {
  ui.overlay.classList.add("show");
  if (won) {
    ui.overlayTitle.textContent = "Level Clear!";
    ui.overlayDesc.textContent = `Level ${LEVELS[state.levelIndex].id} 完成`;
    document.getElementById("btnNext").textContent =
      state.levelIndex < LEVELS.length - 1 ? "下一关" : "再玩一遍";
  } else {
    ui.overlayTitle.textContent = "No Moves";
    ui.overlayDesc.textContent = "死局了，试试 Undo / Shuffle / 加空车";
    document.getElementById("btnNext").textContent = "重试本关";
  }
  state._overlayWon = won;
}

function hideOverlay() {
  ui.overlay.classList.remove("show");
}

function refreshBoosterUI() {
  ui.undoCount.textContent = state.history.length ? String(state.history.length) : "0";
  ui.shuffleCount.textContent = String(state.shuffleLeft);
  ui.addCount.textContent = String(state.addLeft);
  document.getElementById("btnUndo").disabled = state.history.length === 0 || state.busy;
  document.getElementById("btnShuffle").disabled = state.shuffleLeft <= 0 || state.busy;
  document.getElementById("btnAdd").disabled =
    state.addLeft <= 0 || state.busy || state.trucks.length >= MAX_TRUCKS;
}

/**
 * Front row holds the level's own trucks; boosted trucks go to a back row that
 * is offset half a column, so a rear truck can drive straight out between two
 * front ones instead of through them.
 */
const FRONT_Z = 2.9;
const COL = 1.6;
const ROW_GAP = 4.25;

/**
 * Levels run from 2 up to 13 trucks. Anything past one row is laid out as a
 * bottom-anchored grid of 5 columns and scaled down so the whole board still
 * fits the fixed 10.4-unit horizontal view. Row 0 is the front row, nearest
 * the player, and later rows stack away up the road.
 */
function truckLayout(total) {
  if (total <= 5) return { cols: total, rows: 1, scale: 1 };
  const cols = total <= 8 ? 4 : 5;
  const rows = Math.ceil(total / cols);
  // shrink enough that `rows` of trucks clear the booster bar and the ambulance
  const scale = rows <= 2 ? 0.9 : rows === 3 ? 0.76 : 0.66;
  return { cols, rows, scale };
}

function truckWorldPosition(index, total) {
  const { cols, rows, scale } = truckLayout(total);
  if (rows === 1) {
    const zigzag = [0, 0.75, 0, 0.75, 0];
    return { x: (index - (total - 1) / 2) * COL, z: FRONT_Z - zigzag[index % 5], scale };
  }
  // fill the front row first so the level's own trucks stay closest to the player
  const row = Math.floor(index / cols);
  const inRow = index % cols;
  const rowCount = Math.min(cols, total - row * cols);
  const step = COL * scale;
  return {
    x: (inRow - (rowCount - 1) / 2) * step,
    z: FRONT_Z - row * ROW_GAP * scale,
    scale,
  };
}

function clearTruckMeshes() {
  while (truckRoot.children.length) {
    const ch = truckRoot.children.pop();
    ch.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
  truckMeshes.length = 0;
}

/**
 * A shopping cart, replacing the old flatbed truck. Same footprint and hit
 * area, so the layout and pointer code are untouched.
 *
 * Camera A looks almost straight down, which hides the two things that
 * normally identify a cart — the push handle and the wheels. So the identity
 * is carried by cues that survive a plan view instead: a basket that visibly
 * splays wider toward the back, wire ribs running across it, and castors that
 * poke out past the corners.
 */
function createTruckMesh(truck, index, total) {
  const g = new THREE.Group();
  g.userData.truckIndex = index;
  g.userData.bodyMats = [];

  const shellRed = new THREE.MeshStandardMaterial({ color: 0xd8443a, roughness: 0.36, metalness: 0.08 });
  const shellDeep = new THREE.MeshStandardMaterial({ color: 0xb8352c, roughness: 0.4, metalness: 0.08 });
  const basket = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6, metalness: 0.1 });
  const wire = new THREE.MeshStandardMaterial({ color: 0xc6ced6, roughness: 0.3, metalness: 0.55 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a444f, roughness: 0.44, metalness: 0.1 });
  g.userData.bodyMats.push(shellRed, shellDeep, basket);

  const BACK_W = 1.24;
  const FRONT_W = 1.0;
  const D = 2.62;
  const WALL = 0.4;

  // basket floor, sitting at CARGO_Y so produce rests directly on it
  const floor = new THREE.Mesh(roundedSlab(BACK_W - 0.1, D, CARGO_Y, 0.1, 0.04), basket);
  floor.position.set(0, 0, -0.2);
  floor.castShadow = true;
  floor.receiveShadow = true;
  g.add(floor);

  // splayed side walls: the taper from back to front is the strongest cart cue
  // that survives a top-down view
  for (const sgn of [-1, 1]) {
    const side = new THREE.Mesh(roundedSlab(0.12, D, WALL, 0.05, 0.03), shellRed);
    side.position.set((sgn * (BACK_W + FRONT_W)) / 4, CARGO_Y, -0.2);
    side.rotation.y = sgn * 0.045;
    side.rotation.z = -sgn * 0.08;
    side.castShadow = true;
    g.add(side);
  }
  const back = new THREE.Mesh(roundedSlab(BACK_W + 0.1, 0.13, WALL + 0.12, 0.05, 0.03), shellRed);
  back.position.set(0, CARGO_Y, -D / 2 - 0.18);
  back.castShadow = true;
  g.add(back);
  const front = new THREE.Mesh(roundedSlab(FRONT_W, 0.13, WALL - 0.08, 0.05, 0.03), shellDeep);
  front.position.set(0, CARGO_Y, D / 2 - 0.2);
  front.castShadow = true;
  g.add(front);

  // wire ribs across the basket — reads as mesh from directly above
  const ribGeo = new THREE.CylinderGeometry(0.018, 0.018, BACK_W - 0.06, 6);
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(ribGeo, wire);
    rib.rotation.z = Math.PI / 2;
    rib.position.set(0, CARGO_Y + WALL * 0.66, -D / 2 + 0.44 + i * 0.85);
    g.add(rib);
  }

  // push handle at the near end
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, FRONT_W + 0.16, 10), grip);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, CARGO_Y + WALL + 0.26, D / 2 + 0.12);
  handle.castShadow = true;
  g.add(handle);
  for (const sgn of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.56, 6), wire);
    post.position.set((sgn * (FRONT_W + 0.14)) / 2, CARGO_Y + WALL - 0.02, D / 2 - 0.02);
    post.rotation.x = -0.34;
    g.add(post);
  }

  // castors deliberately outboard of the basket so they show in plan view
  const wheels = [];
  for (const sgn of [-1, 1]) {
    for (const z of [-D / 2 + 0.16, D / 2 - 0.34]) {
      const wheel = makeWheel(0.185, 0.13);
      wheel.position.set(sgn * (BACK_W / 2 + 0.07), 0.185, z);
      g.add(wheel);
      wheels.push(wheel);
    }
  }
  g.userData.wheels = wheels;

  const cargo = new THREE.Group();
  cargo.name = "cargo";
  g.add(cargo);

  if (truck.stuck) {
    const badge = makeLockBadge();
    badge.position.set(0, 1.1, 0.9);
    g.add(badge);
  }
  if (truck.cover) {
    const cover = new THREE.Mesh(
      roundedSlab(BACK_W + 0.06, D - 0.04, 0.5, 0.1, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x5d6b7d, roughness: 0.82 })
    );
    cover.position.set(0, CARGO_Y + 0.3, -0.2);
    cover.name = "cover";
    cover.castShadow = true;
    g.add(cover);

    // the strap has to say which produce opens it, or the board is unreadable
    const keyDef = ITEM[truck.cover] || ITEM[1];
    const strap = new THREE.Mesh(
      roundedSlab(BACK_W + 0.14, 0.4, 0.09, 0.05, 0.03),
      new THREE.MeshStandardMaterial({ color: keyDef.color, roughness: 0.5 })
    );
    strap.position.set(0, CARGO_Y + 0.78, -0.2);
    g.add(strap);

    // a miniature of the key produce, rather than an abstract glyph
    const keyModel = makeProduce(truck.cover);
    keyModel.scale.setScalar(0.9);
    keyModel.position.set(0, CARGO_Y + 0.84, -0.2);
    g.add(keyModel);
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.055, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.06, -0.2);
  ring.scale.z = 1.6;
  ring.name = "selectRing";
  g.add(ring);

  const validBadge = makeBadge("✓", 0x35c95d);
  validBadge.name = "validBadge";
  validBadge.position.set(0, 1.0, -1.1);
  validBadge.scale.set(0.5, 0.5, 1);
  validBadge.visible = false;
  g.add(validBadge);

  const pos = truckWorldPosition(index, total);
  g.position.set(pos.x, 0, pos.z);
  g.scale.setScalar(pos.scale);
  g.rotation.y = (index - (total - 1) / 2) * -0.016;
  if (truck.shipped) g.visible = false;
  truckRoot.add(g);
  truckMeshes[index] = g;
  rebuildCargo(index);
  return g;
}

function makeBadge(text, color) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 62px Nunito, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(0.55, 0.55, 1);
  return spr;
}

/** Face-down crate stamp for mystery items. */
function mysteryTexture() {
  if (textureCache.has("mystery")) return textureCache.get("mystery");
  const c = document.createElement("canvas");
  c.width = c.height = 192;
  const g = c.getContext("2d");
  g.font = "900 150px Nunito, Arial Rounded MT Bold, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(40,30,10,.3)";
  g.fillText("?", 96, 104);
  g.fillStyle = "#fff6df";
  g.fillText("?", 96, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set("mystery", tex);
  return tex;
}

/** Padlock disc for one-way trucks; emoji glyphs don't render reliably to canvas. */
function makeLockBadge() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e0483f";
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.92)";
  g.lineWidth = 7;
  g.stroke();

  g.strokeStyle = "#fff";
  g.lineWidth = 11;
  g.lineCap = "round";
  g.beginPath();
  g.arc(64, 54, 17, Math.PI, 0);
  g.stroke();
  g.fillStyle = "#fff";
  roundRect(g, 40, 54, 48, 38, 9);
  g.fill();
  g.fillStyle = "#e0483f";
  g.beginPath();
  g.arc(64, 71, 5.5, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(0.5, 0.5, 1);
  return spr;
}

function rebuildCargo(index) {
  const mesh = truckMeshes[index];
  if (!mesh) return;
  const cargo = mesh.getObjectByName("cargo");
  while (cargo.children.length) disposeProduce(cargo.children.pop());
  const truck = state.trucks[index];
  if (!truck || truck.shipped) return;

  const selectedRun = state.selected === index ? topRun(truck) : null;
  const validBadge = mesh.getObjectByName("validBadge");
  if (validBadge) {
    validBadge.visible =
      state.selected >= 0 &&
      state.selected !== index &&
      canPlace(topRun(state.trucks[state.selected]), truck);
  }

  truck.slots.forEach((type, slot) => {
    if (!type) return;
    // still in the lorry during the opening unload
    if (state.pending && state.pending.has(`${index}:${slot}`)) return;

    const isHidden = truck.hidden.has(slot);
    const isPicked = selectedRun && slot >= selectedRun.from;
    const item = isHidden ? makeMysteryBag() : makeProduce(type);

    item.position.set(0, CARGO_Y + (isPicked ? PICK_LIFT : 0), SLOT_Z0 - slot * SLOT_STEP);
    item.userData.item = true;
    item.userData.picked = !!isPicked;
    item.userData.baseY = item.position.y;
    cargo.add(item);
  });

  const ring = mesh.getObjectByName("selectRing");
  if (ring) ring.material.opacity = state.selected === index ? 1 : 0;
}

/** Closed paper bag for a mystery item: shape says "grocery", "?" says "unknown". */
function makeMysteryBag() {
  const wrap = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0x9c6f3f, roughness: 0.8 });
  const bag = new THREE.Mesh(roundedSlab(0.66, 0.48, 0.44, 0.07, 0.03), paper);
  bag.castShadow = true;
  wrap.add(bag);
  const fold = new THREE.Mesh(
    roundedSlab(0.7, 0.16, 0.08, 0.04, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x815a30, roughness: 0.82 })
  );
  fold.position.set(0, 0.44, -0.14);
  wrap.add(fold);
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: mysteryTexture(), transparent: true, depthWrite: false })
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(0, 0.452, 0.04);
  wrap.add(mark);
  return wrap;
}

function rebuildAllTrucks() {
  clearTruckMeshes();
  const total = state.trucks.length;
  state.trucks.forEach((t, i) => createTruckMesh(t, i, total));
}

/** Every vehicle leaves the same way: straight down the road, off the bottom. */
function driveOut(mesh, { distance, duration = 700, delay = 0, fadeFrom = 1, spin = 16 } = {}) {
  return new Promise((resolve) => {
    const fadeMats = [];
    if (fadeFrom < 1) {
      mesh.traverse((o) => {
        if (o.material && !Array.isArray(o.material) && o.name !== "selectRing") {
          o.material.transparent = true;
          fadeMats.push(o.material);
        }
      });
    }
    const startZ = mesh.position.z;
    const wheels = mesh.userData.wheels || [];
    const t0 = performance.now() + delay;
    function step(now) {
      if (now < t0) {
        requestAnimationFrame(step);
        return;
      }
      const u = Math.min(1, (now - t0) / duration);
      const e = u * u * (3 - 2 * u);
      mesh.position.z = startZ + distance * e;
      wheels.forEach((w) => (w.rotation.x = -e * spin));
      if (fadeMats.length && u > fadeFrom) {
        const o = 1 - (u - fadeFrom) / (1 - fadeFrom);
        fadeMats.forEach((m) => (m.opacity = Math.max(0, o)));
      }
      if (u < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

function animateShips(indices) {
  state.busy = true;
  refreshBoosterUI();
  const runs = indices.map((index, k) => {
    const mesh = truckMeshes[index];
    if (!mesh) return Promise.resolve();
    // A back-row truck fades before it reaches the front row it drives past.
    const inBackRow = mesh.position.z < FRONT_Z - 1;
    return driveOut(mesh, {
      distance: 14,
      duration: 760,
      delay: k * 150,
      fadeFrom: inBackRow ? 0.3 : 0.55,
      spin: 14,
    });
  });
  Promise.all(runs).then(() => {
    indices.forEach((index) => {
      state.trucks[index].shipped = true;
      state.trucks[index].slots = [0, 0, 0, 0];
      if (truckMeshes[index]) truckMeshes[index].visible = false;
    });
    state.busy = false;
    rebuildAllTrucks();
    checkWin();
    refreshBoosterUI();
  });
}

function setSelection(idx) {
  state.selected = idx;
  state.trucks.forEach((_, i) => rebuildCargo(i));
}

function onPointer(clientX, clientY) {
  // a tap during the opening fast-forwards it rather than being swallowed
  if (state.intro) {
    state.intro.skip = true;
    return;
  }
  if (state.busy || state.won || ui.overlay.classList.contains("show")) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(truckMeshes.filter(Boolean), true);
  if (!hits.length) {
    setSelection(-1);
    return;
  }
  let obj = hits[0].object;
  while (obj && obj.userData.truckIndex === undefined) obj = obj.parent;
  if (!obj) return;
  const idx = obj.userData.truckIndex;
  const truck = state.trucks[idx];
  if (!truck || truck.shipped) return;

  if (state.selected < 0) {
    if (canSelect(truck)) setSelection(idx);
    else flashTruck(idx, refusalReason(truck));
  } else if (state.selected === idx) {
    setSelection(-1);
  } else {
    const srcIdx = state.selected;
    const result = transfer(srcIdx, idx);
    // cleared directly rather than through setSelection, so the board is drawn
    // once by animateTransfer instead of flashing the arrivals for a frame
    state.selected = -1;
    if (!result) {
      rebuildAllTrucks();
      flashTruck(idx, refusalReason(truck));
      return;
    }
    // hold input for the length of the flight, otherwise a second tap could
    // mutate the board while produce is still mid-air
    state.busy = true;
    refreshBoosterUI();
    animateTransfer(srcIdx, idx, result.moves).then(() => {
      state.busy = false;
      refreshBoosterUI();
      if (result.shipped.length) animateShips(result.shipped);
      else checkWin();
    });
  }
}

function refusalReason(truck) {
  if (truck.cover) return "这辆车盖住了 — 先推走一车同样的果蔬来掀开它";
  if (truck.stuck) return "单向购物车：果蔬只能放进去，拿不出来";
  if (filledCount(truck) === 0) return "这辆车是空的，先选一辆装了果蔬的";
  if (freeSlots(truck) === 0) return "这辆车装满了";
  return "只能放到空车，或者顶上是同样果蔬的车";
}

function flashTruck(idx, message) {
  const mesh = truckMeshes[idx];
  if (mesh) {
    const mats = mesh.userData.bodyMats || [];
    mats.forEach((m) => m.emissive.setHex(0x7a1414));
    setTimeout(() => mats.forEach((m) => m.emissive.setHex(0x000000)), 180);
  }
  if (message) showToast(message);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
}

function loadLevel(index) {
  hideOverlay();
  // fast-forward any opening still running for the level we are leaving
  if (state.intro) state.intro.skip = true;
  state.pending = null;
  state.levelIndex = index;
  state.selected = -1;
  state.history = [];
  state.shuffleLeft = 3;
  state.addLeft = 2;
  state.busy = false;
  state.won = false;
  const level = LEVELS[index];
  state.trucks = cloneTrucks(level.trucks);
  revealTops();
  ui.levelTag.textContent = `Level ${level.id}`;
  ui.levelInput.value = String(level.id);

  const hint = HINTS[level.id];
  clearTimeout(state.hintTimer);
  if (hint) {
    ui.hint.innerHTML = hint;
    ui.hint.style.opacity = "1";
    state.hintTimer = setTimeout(() => {
      ui.hint.style.opacity = "0";
    }, 4200);
  } else {
    ui.hint.style.opacity = "0";
  }

  if (state.focusVan) {
    state.focusVan.position.set(0, 0, state.focusVanEntryZ);
    (state.focusVan.userData.wheels || []).forEach((w) => (w.rotation.x = 0));
    setTailgate(state.focusVan, 0);
  }
  updateLevelBadge(level.id);
  rebuildAllTrucks();
  refreshBoosterUI();
  playLevelIntro();
}

/** "Level N" plate riding on the ambulance rear doors. */
function updateLevelBadge(id) {
  if (state.levelBadge) {
    state.levelBadge.parent?.remove(state.levelBadge);
    state.levelBadge.material.map.dispose();
    state.levelBadge.material.dispose();
  }
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 200;
  const g = c.getContext("2d");
  g.shadowColor = "rgba(0,0,0,.3)";
  g.shadowBlur = 10;
  g.fillStyle = "#fff8e9";
  roundRect(g, 46, 14, 164, 160, 22);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "#e5483b";
  roundRect(g, 56, 96, 144, 66, 16);
  g.fill();
  g.fillStyle = "#e5483b";
  g.font = "900 40px Nunito, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("Level", 128, 62);
  g.fillStyle = "#fff";
  g.font = "900 54px Nunito, sans-serif";
  g.fillText(String(id), 128, 130);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(1.08, 0.83, 1);
  // over the cab, so it never sits on top of the load in the open bed
  spr.position.set(0, 1.78, -2.3);
  (state.focusVan || root).add(spr);
  state.levelBadge = spr;
}

function undo() {
  if (!state.history.length || state.busy) return;
  const snap = state.history.pop();
  state.trucks = snap.trucks;
  state.shuffleLeft = snap.shuffleLeft;
  state.addLeft = snap.addLeft;
  state.selected = -1;
  state.won = false;
  hideOverlay();
  rebuildAllTrucks();
  refreshBoosterUI();
}

function shuffle() {
  if (state.shuffleLeft <= 0 || state.busy) return;
  pushHistory();
  state.shuffleLeft--;
  const pools = [];
  const targets = [];
  state.trucks.forEach((t, i) => {
    if (t.shipped || t.stuck || t.cover || t.hidden.size) return;
    targets.push(i);
    t.slots.forEach((v) => {
      if (v) pools.push(v);
    });
    t.slots = [0, 0, 0, 0];
  });
  for (let i = pools.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pools[i], pools[j]] = [pools[j], pools[i]];
  }
  let p = 0;
  while (p < pools.length) {
    let placed = false;
    for (const i of targets) {
      if (p >= pools.length) break;
      const empty = state.trucks[i].slots.findIndex((x) => x === 0);
      if (empty >= 0) {
        state.trucks[i].slots[empty] = pools[p++];
        placed = true;
      }
    }
    if (!placed) break;
  }
  state.selected = -1;
  revealTops();
  rebuildAllTrucks();
  refreshBoosterUI();
  checkWin();
}

function addTruck() {
  if (state.addLeft <= 0 || state.trucks.length >= MAX_TRUCKS || state.busy) return;
  pushHistory();
  state.addLeft--;
  state.trucks.push({
    slots: [0, 0, 0, 0],
    hidden: new Set(),
    stuck: false,
    cover: 0,
    shipped: false,
  });
  state.selected = -1;
  rebuildAllTrucks();
  refreshBoosterUI();
}

function onResize() {
  const width = app.clientWidth;
  const height = app.clientHeight;
  const aspect = width / height;
  const verticalSpan = Math.min(30, Math.max(12, HORIZ_SPAN / aspect));
  // Reserve ~150px under the truck row so the booster bar never covers a cab.
  const padWorld = (150 / height) * verticalSpan * -GROUND_K;
  camera.left = -HORIZ_SPAN / 2;
  camera.right = HORIZ_SPAN / 2;
  camera.bottom = vAtZ(BOTTOM_Z + padWorld);
  camera.top = camera.bottom + verticalSpan;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);

  // Park the lorry just under the top edge whatever the screen shape is. It
  // reverses in from beyond that edge and, on clear, drives forwards back out
  // through it, so entry and exit both sit off the top.
  if (state.focusVan) {
    state.focusVanHomeZ = zAtV(camera.bottom + verticalSpan * 0.78);
    state.focusVanEntryZ = zAtV(camera.top) - 7;
    state.focusVanExitZ = zAtV(camera.top) - 9;
    if (!state.won && !state.intro) state.focusVan.position.z = state.focusVanHomeZ;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const t = performance.now() * 0.001;
  if (state.selected >= 0 && truckMeshes[state.selected]) {
    const cargo = truckMeshes[state.selected].getObjectByName("cargo");
    if (cargo) {
      cargo.children.forEach((item) => {
        if (item.userData.picked) {
          item.position.y = item.userData.baseY + Math.sin(t * 6) * 0.04;
        }
      });
    }
  }
  renderer.render(scene, camera);
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  onPointer(e.clientX, e.clientY);
});
window.addEventListener("resize", onResize);

document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnShuffle").addEventListener("click", shuffle);
document.getElementById("btnAdd").addEventListener("click", addTruck);
document.getElementById("btnReset").addEventListener("click", () => loadLevel(state.levelIndex));
document.getElementById("btnNext").addEventListener("click", () => {
  if (state._overlayWon) {
    const next = state.levelIndex < LEVELS.length - 1 ? state.levelIndex + 1 : 0;
    loadLevel(next);
  } else {
    loadLevel(state.levelIndex);
  }
});

function gotoLevelId(id) {
  const n = Math.min(LEVELS.length, Math.max(1, Number(id) || 1));
  loadLevel(n - 1);
}

document.getElementById("btnPrev").addEventListener("click", () => {
  gotoLevelId(LEVELS[state.levelIndex].id - 1);
});
document.getElementById("btnFwd").addEventListener("click", () => {
  gotoLevelId(LEVELS[state.levelIndex].id + 1);
});
ui.levelInput.addEventListener("change", () => gotoLevelId(ui.levelInput.value));

buildEnvironment();
onResize();
animate();

/**
 * Screen-space handle on the board, so the shot harness can click real trucks
 * instead of hardcoded pixel guesses.
 */
window.game = {
  state,
  gotoLevelId,
  levelCount: () => LEVELS.length,
  truckAt(index) {
    const mesh = truckMeshes[index];
    if (!mesh) return null;
    // a cart rebuilt this tick has not been rendered yet, so its world matrix
    // is still identity and every cart would report the same screen point
    mesh.updateWorldMatrix(true, false);
    const v = new THREE.Vector3(0, 0.6, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  },
  board: () =>
    state.trucks.map((t) => ({
      slots: [...t.slots],
      hidden: [...t.hidden],
      cover: t.cover,
      stuck: t.stuck,
      shipped: t.shipped,
    })),
};

const res = await fetch("levels.json");
LEVELS = (await res.json()).levels;
ui.levelInput.max = String(LEVELS.length);
ui.levelTotal.textContent = `/ ${LEVELS.length}`;
const requested = parseInt(new URLSearchParams(location.search).get("level"), 10);
gotoLevelId(requested || 1);
