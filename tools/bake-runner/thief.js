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
  r.body.frustumCulled = false;

  const top = new THREE.Vector3(), at = new THREE.Vector3(), bend = new THREE.Quaternion(), droop = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1), across = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3();
  return phase => {
    const sway = TAIL.swing * Math.sin(phase * TAU);
    for (const t of tail) {
      droop.setFromAxisAngle(across, -TAIL.droop * THREE.MathUtils.smoothstep(-t.p.z, 0, TAIL.root));
      bend.setFromAxisAngle(forward, sway * -t.p.z / length).multiply(droop);
      v.copy(t.p).applyQuaternion(bend).add(TAIL.pivot);
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
