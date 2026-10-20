import * as THREE from 'three';
import { aim, placeHand } from './rig.js';

const TAU = Math.PI * 2, PINK = '#ff3d7f', CREAM = '#fff6e0';
// The tub's base sits this far above the head_end bone: past the ear tips, with a gap so the ears read below it.
const LIFT = 0.13;
// Brightens and cools Meshy's warm grey fur to the 2D thief's #8c90a3 under the bake lights. It is linear and above 1
// because the texture is darker than that grey.
const FUR = new THREE.Color().setRGB(1.4, 1.6, 2);
// Meshy gave the raccoon a thin, plain tail sticking straight back from the hips and skinned it to the thighs. These
// bounds pick it out in bind space; it is re-skinned to the hips, widened to 1 + `bush` times its girth and ringed
// every `ring` metres past its first `root` metres, bent down over that root, and swung side to side each stride. The run leans the hips
// well forward, so the droop is steep in bind space to leave the tail hanging down and back. From behind, the ringed
// tail is what says raccoon.
const TAIL = {
  maxZ: 0.12, halfX: 0.05, minY: 0.48, maxY: 0.6, pivot: new THREE.Vector3(0, 0.54, 0.12),
  root: 0.08, bush: 1, ring: 0.14, dark: 0.08, droop: 1.6, swing: 0.5,
};

// Squat proportions, in bind-space metres (y up, +z forward). Everything below the hips bone at `hips` keeps `legs` of its
// height and the torso up to the neck at `neck` keeps `torso`, while the head and arms keep their size, so the raccoon
// stands 0.9 m instead of 1.2 m. Over the `waist` heights (start, peak and end) the body widens by up to 1 + `wide` and the belly pushes
// forward from `mid`, the body's centre in depth, by up to 1 + `belly`; over the `seat` heights the rump pushes back by
// up to 1 + `rump`. Thighs and shins grow to `girth` times their old thickness.
const SQUAT = { legs: 0.65, torso: 0.75, hips: 0.62, neck: 0.97, mid: 0.2, waist: [0.4, 0.68, 0.9], seat: [0.35, 0.58, 0.8], wide: 0.9, belly: 1.1, rump: 0.6, girth: 1.6 };

// The tub's label is drawn round the side; u = 0.5 is the side facing -Z, toward the chase cam.
function label() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PINK; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = CREAM; g.font = '128px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('WHEY', c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Adds the tub and returns a function that poses the thief for a stride phase in [0, 1): arms up holding the tub
// over its head, tail swinging. Tub sizes are in figure units of `unit` metres, a little under the vector thief's
// 60 by 44 tub because the model is slimmer than the vector raccoon.
export function dressThief(r, scene, unit) {
  const R = 26 * unit, H = 40 * unit, LID = 7 * unit;
  const tub = new THREE.Group(), pink = new THREE.MeshLambertMaterial({ color: PINK });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 48), [new THREE.MeshLambertMaterial({ map: label() }), pink, pink]);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.88, R * 0.88, LID, 48), new THREE.MeshLambertMaterial({ color: CREAM }));
  body.position.y = H / 2; lid.position.y = H + LID / 2;
  tub.add(body, lid);
  scene.add(tub);

  r.body.material = new THREE.MeshLambertMaterial({ map: r.body.material.map, color: FUR, vertexColors: true });
  const geo = r.body.geometry, pos = geo.attributes.position, nrm = geo.attributes.normal;
  const hips = r.body.skeleton.bones.indexOf(r.bones.Hips), tail = [], colors = new Float32Array(pos.count * 3).fill(1);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z > TAIL.maxZ || Math.abs(x) > TAIL.halfX || y < TAIL.minY || y > TAIL.maxY) continue;
    const p = new THREE.Vector3(x, y, z).sub(TAIL.pivot), along = -p.z, past = along - TAIL.root;
    const f = 1 + TAIL.bush * THREE.MathUtils.smoothstep(along, 0, TAIL.root);
    p.x *= f; p.y *= f;
    tail.push({ i, p, n: new THREE.Vector3().fromBufferAttribute(nrm, i) });
    if (past > 0 && past / TAIL.ring % 1 >= 0.5) colors.fill(TAIL.dark, i * 3, i * 3 + 3);
    geo.attributes.skinIndex.setXYZW(i, hips, 0, 0, 0);
    geo.attributes.skinWeight.setXYZW(i, 1, 0, 0, 0);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const length = Math.max(...tail.map(v => -v.p.z));
  const pivot = reshape(r, new Set(tail.map(t => t.i)));
  r.body.frustumCulled = false;

  const top = new THREE.Vector3(), at = new THREE.Vector3(), bend = new THREE.Quaternion(), droop = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1), across = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3();
  return phase => {
    const sway = TAIL.swing * Math.sin(phase * TAU);
    for (const t of tail) {
      droop.setFromAxisAngle(across, -TAIL.droop * THREE.MathUtils.smoothstep(-t.p.z, 0, TAIL.root));
      bend.setFromAxisAngle(forward, sway * -t.p.z / length).multiply(droop);
      v.copy(t.p).applyQuaternion(bend).add(pivot);
      pos.setXYZ(t.i, v.x, v.y, v.z);
      v.copy(t.n).applyQuaternion(bend);
      nrm.setXYZ(t.i, v.x, v.y, v.z);
    }
    pos.needsUpdate = nrm.needsUpdate = true;

    // Each hand grips a lower side of the tub.
    r.bones.head_end.getWorldPosition(top).y += LIFT;
    tub.position.copy(top);
    tub.updateMatrixWorld(true);
    for (const [side, s] of [['Left', 1], ['Right', -1]]) {
      at.set(top.x + s * (R + 0.025), top.y + H * 0.3, top.z);
      reach(r, side, at, new THREE.Vector3(s, -0.2, -0.3), [-s, 0, 0]);
    }
  };
}

// Squashes the rig to SQUAT. Each bone gets a map of bind space: the torso is squashed and widened, each leg is scaled
// by `legs` about its hip joint and thickened about its own axis, and the head and arms move down with the neck.
// Vertices (except `skip`) move by the skin-weighted blend of their bones' maps and bones move by their own, then the
// clip's position keys and the inverse bind matrices follow. Returns where the tail pivot lands.
function reshape(r, skip) {
  const S = SQUAT, { smoothstep, clamp } = THREE.MathUtils, bones = r.body.skeleton.bones;
  r.model.updateMatrixWorld(true);
  const rest = new Map(bones.map(b => [b, b.getWorldPosition(new THREE.Vector3())]));
  const tall = y => y <= S.hips ? S.legs * y : y <= S.neck ? S.legs * S.hips + S.torso * (y - S.hips) : tall(S.neck) + y - S.neck;
  const slope = y => y <= S.hips ? S.legs : y <= S.neck ? S.torso : 1;
  const bump = ([y0, y1, y2], y) => smoothstep(y, y0, y1) * (1 - smoothstep(y, y1, y2));
  // A map writes where the bind-space point v goes to p, and how much it stretches the surface along each axis to s.
  const core = (v, p, s) => {
    const k = bump(S.waist, v.y), w = 1 + S.wide * k, d = 1 + (v.z > S.mid ? S.belly * k : S.rump * bump(S.seat, v.y));
    p.set(v.x * w, tall(v.y), S.mid + (v.z - S.mid) * d);
    s.set(w, slope(v.y), d);
  };
  const upper = (v, p, s) => { p.set(v.x, v.y + tall(S.neck) - S.neck, v.z); s.set(1, 1, 1); };
  const leg = (side, thick) => {
    const [J, K, A] = ['UpLeg', 'Leg', 'Foot'].map(n => rest.get(r.bones[side + n])), hip = new THREE.Vector3(), axis = new THREE.Vector3();
    core(J, hip, axis);
    const g = thick ? S.girth : S.legs;
    return (v, p, s) => {
      const [hi, lo] = v.y >= K.y ? [J, K] : [K, A];
      axis.lerpVectors(lo, hi, clamp((v.y - lo.y) / (hi.y - lo.y), 0, 1));
      p.copy(v).sub(J).multiplyScalar(S.legs).add(hip);
      p.x += (g - S.legs) * (v.x - axis.x); p.z += (g - S.legs) * (v.z - axis.z);
      s.set(g, S.legs, g);
    };
  };
  const mapOf = name => {
    const m = name.match(/^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/);
    return m ? leg(m[1], m[2] === 'UpLeg' || m[2] === 'Leg') : /^(Hips|Spine)/.test(name) ? core : upper;
  };
  const maps = bones.map(b => mapOf(b.name));

  const geo = r.body.geometry, pos = geo.attributes.position, nrm = geo.attributes.normal, index = geo.attributes.skinIndex, weight = geo.attributes.skinWeight;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3(), sumP = new THREE.Vector3(), sumN = new THREE.Vector3();
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < pos.count; i++) {
    if (skip.has(i)) continue;
    v.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    sumP.set(0, 0, 0); sumN.set(0, 0, 0);
    for (const k of get) {
      const w = weight[k](i);
      if (!w) continue;
      maps[index[k](i)](v, p, s);
      sumP.addScaledVector(p, w);
      sumN.addScaledVector(p.copy(n).divide(s), w);
    }
    pos.setXYZ(i, sumP.x, sumP.y, sumP.z);
    sumN.normalize();
    nrm.setXYZ(i, sumN.x, sumN.y, sumN.z);
  }
  pos.needsUpdate = nrm.needsUpdate = true;

  const toParent = new THREE.Matrix4(), moved = new Map();
  r.bones.Hips.traverse(b => {
    const old = b.position.clone();
    mapOf(b.name)(rest.get(b), p, s);
    b.position.copy(p).applyMatrix4(toParent.copy(b.parent.matrixWorld).invert());
    b.updateWorldMatrix(false, false);
    moved.set(b.name, [old, b.position.clone()]);
  });
  // Every bone has position keys. The hips' keys carry the stride's bob and sway, which shrink with the legs.
  for (const t of r.clip.tracks) {
    const [name, prop] = t.name.split('.');
    if (prop !== 'position') continue;
    const [old, now] = moved.get(name), k = name === 'Hips' ? S.legs : 1;
    for (let i = 0; i < t.values.length; i++) t.values[i] = now.getComponent(i % 3) + k * (t.values[i] - old.getComponent(i % 3));
  }
  r.model.updateMatrixWorld(true);
  r.body.skeleton.calculateInverses();
  core(TAIL.pivot, p, s);
  return p.clone();
}

// The stride phase where the lower foot is lowest, so frame 0 has a foot planted and the game's bob, which rests at
// phase 0 and halfway, lands with each step.
export function footfall(r) {
  const p = new THREE.Vector3(), N = 120;
  let best = 0, low = Infinity;
  for (let i = 0; i < N; i++) {
    r.mixer.setTime(i / N * r.clip.duration);
    r.model.updateMatrixWorld(true);
    const y = Math.min(r.bones.LeftFoot.getWorldPosition(p).y, r.bones.RightFoot.getWorldPosition(p).y);
    if (y < low) { low = y; best = i / N; }
  }
  return best;
}

// Two-bone IK: bends the elbow toward the pole so the wrist lands on the target, then turns the palm to face it.
function reach(r, side, target, pole, palm) {
  const [arm, fore, hand] = ['Arm', 'ForeArm', 'Hand'].map(n => r.bones[side + n]);
  for (const bone of [arm, fore, hand]) bone.quaternion.copy(bone.userData.rest);
  arm.updateMatrixWorld(true);
  const S = arm.getWorldPosition(new THREE.Vector3()), E = fore.getWorldPosition(new THREE.Vector3()), W = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E), b = E.distanceTo(W), dir = target.clone().sub(S), d = Math.min(dir.length(), (a + b) * 0.999);
  dir.normalize();
  const along = (a * a - b * b + d * d) / (2 * d), out = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, along).addScaledVector(out, Math.sqrt(Math.max(0, a * a - along * along)));
  const foreDir = S.clone().addScaledVector(dir, d).sub(elbow).normalize();
  aim(arm, fore, elbow.sub(S).normalize());
  aim(fore, hand, foreDir);
  placeHand(fore, hand, foreDir, palm, 0);
}
