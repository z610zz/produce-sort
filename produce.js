/**
 * The ten elimination elements, as low-poly fruit and veg.
 *
 * Two constraints drive every model here:
 *
 * 1. The board camera looks almost straight down, so a shape is only usable if
 *    its *plan view* is distinct. Several earlier models (a capsule cucumber, a
 *    cone-with-a-wide-leaf-cap strawberry) were unreadable from above and were
 *    replaced even though they looked fine in a three-quarter view.
 * 2. Colour alone stops separating types past about six, so each type pairs a
 *    distinct hue with a distinct outline.
 *
 * Every model is authored at whatever size is natural and then fitted to a
 * shared slot cell by `makeProduce`, so a column of mixed types lines up evenly.
 */
import * as THREE from "three";

/** Slot cell each model is fitted into, in cart-local units. */
export const CELL_W = 0.88;
export const CELL_D = 0.6;

export const PRODUCE = {
  1: { name: "苹果", color: 0xe23b32, kind: "apple" },
  2: { name: "香蕉", color: 0xf5c93a, kind: "banana" },
  3: { name: "胡萝卜", color: 0xf07d28, kind: "carrot" },
  4: { name: "西兰花", color: 0x46a83f, kind: "broccoli" },
  5: { name: "葡萄", color: 0x8e4fc4, kind: "grapes" },
  6: { name: "蓝莓", color: 0x3f72d8, kind: "blueberry" },
  7: { name: "茄子", color: 0x6b3fa0, kind: "eggplant" },
  8: { name: "草莓", color: 0xf0426f, kind: "strawberry" },
  9: { name: "蘑菇", color: 0xb9825a, kind: "mushroom" },
  10: { name: "青柠", color: 0xb4dd2b, kind: "lime" },
};

const LEAF = 0x3f8f34;
const STEM = 0x6b4a2a;

const glossy = (color, rough = 0.26) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04 });

/** Builds the model at its natural size; `makeProduce` handles the fitting. */
function buildKind(kind, body, leaf, stem) {
  const g = new THREE.Group();

  switch (kind) {
    case "apple": {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), body);
      a.scale.set(1, 0.92, 1);
      a.position.y = 0.19;
      g.add(a);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.11, 6), stem);
      s.position.set(0, 0.35, 0);
      s.rotation.z = 0.2;
      g.add(s);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), leaf);
      l.scale.set(1, 0.28, 0.55);
      l.position.set(0.09, 0.36, 0.02);
      l.rotation.z = 0.3;
      g.add(l);
      break;
    }
    case "banana": {
      // a thick partial torus: the crescent is what identifies it from above
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.1, 8, 12, Math.PI * 0.95), body);
      b.rotation.x = Math.PI / 2;
      b.rotation.z = -Math.PI * 0.475;
      b.position.set(0, 0.1, 0);
      g.add(b);
      for (const sgn of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), stem);
        const a = sgn * Math.PI * 0.475;
        tip.position.set(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2);
        g.add(tip);
      }
      break;
    }
    case "carrot": {
      // short and fat, not a spike: a thin carrot reads as a sliver next to the
      // round types once everything is fitted to the same cell
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 12), body);
      c.rotation.x = -Math.PI / 2;
      c.position.set(0, 0.18, -0.05);
      g.add(c);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), body);
      shoulder.scale.set(1, 0.9, 0.7);
      shoulder.position.set(0, 0.18, 0.17);
      g.add(shoulder);
      for (let i = 0; i < 3; i++) {
        const frond = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), leaf);
        frond.scale.set(0.7, 0.5, 1.0);
        frond.position.set((i - 1) * 0.09, 0.26, 0.3);
        g.add(frond);
      }
      break;
    }
    case "broccoli": {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.14, 8), glossy(0xbfd98a, 0.4));
      stalk.position.y = 0.07;
      g.add(stalk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8), body);
      crown.scale.y = 0.72;
      crown.position.y = 0.2;
      g.add(crown);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const bud = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 6), body);
        bud.position.set(Math.cos(a) * 0.115, 0.22, Math.sin(a) * 0.115);
        g.add(bud);
      }
      break;
    }
    case "grapes": {
      const rows = [[-0.09, 0.14], [0.09, 0.14], [0, 0.03], [-0.09, -0.08], [0.09, -0.08], [0, -0.19]];
      rows.forEach(([x, z], i) => {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(i === 5 ? 0.062 : 0.075, 8, 6), body);
        berry.position.set(x, 0.08, z);
        g.add(berry);
      });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), leaf);
      l.scale.set(1, 0.3, 0.7);
      l.position.set(0, 0.16, 0.2);
      g.add(l);
      break;
    }
    case "blueberry": {
      // two large and one small, so the group never collapses into one sphere
      for (const [x, z, r] of [[-0.105, 0.08, 0.15], [0.115, 0.07, 0.13], [0.0, -0.14, 0.115]]) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), body);
        berry.position.set(x, r, z);
        g.add(berry);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.2, 0.02, 6), glossy(0x2a4f97, 0.5));
        crown.position.set(x, r * 1.9, z);
        g.add(crown);
      }
      break;
    }
    case "eggplant": {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8), body);
      e.scale.set(1, 0.88, 1.55);
      e.position.set(0, 0.145, 0.03);
      g.add(e);
      const neck = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.22, 10), body);
      neck.rotation.x = -Math.PI / 2;
      neck.position.set(0, 0.145, -0.2);
      g.add(neck);
      const calyx = new THREE.Mesh(new THREE.SphereGeometry(0.105, 6, 4), leaf);
      calyx.scale.set(1, 0.4, 1);
      calyx.position.set(0, 0.2, -0.24);
      g.add(calyx);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.12, 6), leaf);
      st.position.set(0, 0.26, -0.3);
      st.rotation.x = -0.45;
      g.add(st);
      break;
    }
    case "strawberry": {
      const berry = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.46, 12), body);
      berry.rotation.x = Math.PI / 2;
      berry.scale.set(1, 1, 0.82);
      berry.position.set(0, 0.16, 0.04);
      g.add(berry);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 6), body);
      crown.scale.set(1, 0.7, 0.7);
      crown.position.set(0, 0.16, -0.19);
      g.add(crown);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 7, 4), leaf);
      cap.scale.set(1.15, 0.28, 1.0);
      cap.position.set(0, 0.3, -0.17);
      g.add(cap);
      const seedMat = glossy(0xffe7a0, 0.45);
      for (const [x, z] of [[-0.075, 0], [0.075, -0.01], [0, 0.1], [-0.04, 0.19], [0.045, 0.2], [0, -0.06]]) {
        const seed = new THREE.Mesh(new THREE.SphereGeometry(0.021, 5, 4), seedMat);
        seed.position.set(x, 0.3, z);
        g.add(seed);
      }
      break;
    }
    case "mushroom": {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.18, 10), glossy(0xf6ecdc, 0.4));
      stalk.position.y = 0.1;
      g.add(stalk);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.175, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        body
      );
      cap.scale.y = 0.85;
      cap.position.y = 0.19;
      g.add(cap);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.045, 12), body);
      rim.position.y = 0.2;
      g.add(rim);
      for (const [x, z, r] of [[-0.07, 0.05, 0.035], [0.08, -0.03, 0.028], [0.02, 0.09, 0.024]]) {
        const spot = new THREE.Mesh(new THREE.CircleGeometry(r, 7), glossy(0xf6ecdc, 0.4));
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(x, 0.35, z);
        g.add(spot);
      }
      break;
    }
    case "lime":
    default: {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 8), body);
      l.scale.set(1.18, 0.9, 1);
      l.position.y = 0.17;
      g.add(l);
      for (const sgn of [-1, 1]) {
        const nub = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), body);
        nub.position.set(sgn * 0.2, 0.17, 0);
        g.add(nub);
      }
      const l2 = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), leaf);
      l2.scale.set(1, 0.28, 0.6);
      l2.position.set(0.04, 0.3, 0.05);
      g.add(l2);
      break;
    }
  }
  return g;
}

/**
 * Returns a produce model centred on x/z and resting on y = 0, fitted to the
 * slot cell. Fitting to the cell rather than to a square matters: round types
 * fill the cell, while long types (carrot, banana) run along the cart instead
 * of being shrunk until they look weightless next to an apple.
 */
export function makeProduce(typeId) {
  const def = PRODUCE[typeId] || PRODUCE[1];
  const inner = buildKind(def.kind, glossy(def.color), glossy(LEAF, 0.35), glossy(STEM, 0.45));
  inner.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  const box = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3();
  box.getSize(size);
  const k = Math.min(CELL_W / size.x, CELL_D / size.z);
  inner.scale.setScalar(k);
  inner.position.set(
    -((box.min.x + box.max.x) / 2) * k,
    -box.min.y * k,
    -((box.min.z + box.max.z) / 2) * k
  );

  const wrap = new THREE.Group();
  wrap.add(inner);
  return wrap;
}

/** Frees the geometries and materials a `makeProduce` group owns. */
export function disposeProduce(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
