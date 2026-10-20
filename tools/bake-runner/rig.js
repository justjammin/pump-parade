import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PI = Math.PI;
const POINT_LEFT = { L: [-0.78 * PI, -0.78 * PI], R: [0.3 * PI, 0.74 * PI] };
// Upper-arm and forearm screen angles copied from POSES in index.html (back view, x right, y down).
export const POSES = {
  up: { L: [PI, -PI / 2], R: [0, -PI / 2] },
  down: { L: [0.72 * PI, 0.12 * PI], R: [0.28 * PI, 0.88 * PI] },
  left: POINT_LEFT,
};
// How far each segment reaches toward the character's front (+Z), so arms clear the torso instead of cutting through it.
const DEPTH = { up: [0.15, -0.1], down: [0.55, 1.1], left: [0.1, 0.35] };

export async function loadRunner(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bones = {};
  let body;
  gltf.scene.traverse(o => {
    if (o.isBone) { bones[o.name] = o; o.userData.rest = o.quaternion.clone(); }
    if (o.isSkinnedMesh) body = o;
  });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  return { model: gltf.scene, bones, body, mixer, clip: gltf.animations[0] };
}

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), pw = new THREE.Quaternion(), w = new THREE.Quaternion();
// The back view puts the character's +X on screen left, and screen y points down.
const dirOf = (angle, dz) => new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), dz).normalize();
// Where each palm faces (world space, +Z is the character's front) and how far the wrist may bend toward it, in
// radians. Palms face down. In the double biceps the forearms are upright, so the wrists curl the fists in over the head.
const PALMS = {
  up: { L: [-1, -1, 0], R: [1, -1, 0], flex: 0.8 },
  down: { L: [0, -1, -1], R: [0, -1, -1], flex: 0 },
  left: { L: [0, -1, 0], R: [0, -1, -0.5], flex: 0 },
};

// Applies a world-space rotation to a bone, keeping its parent where it is.
function turn(bone, rotation) {
  bone.getWorldQuaternion(w); bone.parent.getWorldQuaternion(pw);
  bone.quaternion.copy(pw.invert().multiply(rotation.multiply(w)));
  bone.updateMatrixWorld(true);
}

function aim(bone, child, target) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldPosition(a); child.getWorldPosition(b);
  turn(bone, q.setFromUnitVectors(b.sub(a).normalize(), target));
}

// Rolls the forearm about its own axis until the palm faces the target as nearly as a straight wrist allows, then
// bends the wrist the rest of the way, up to flex.
function placeFist(fore, hand, axis, target, flex) {
  const want = d.fromArray(target).normalize();
  hand.getWorldQuaternion(w);
  const palm = a.fromArray(hand.userData.palm).applyQuaternion(w).addScaledVector(axis, -a.dot(axis));
  const across = b.copy(want).addScaledVector(axis, -want.dot(axis));
  turn(fore, q.setFromAxisAngle(axis, Math.atan2(c.crossVectors(palm, across).dot(axis), palm.dot(across))));
  if (!flex) return;
  hand.getWorldQuaternion(w);
  a.fromArray(hand.userData.palm).applyQuaternion(w);
  turn(hand, q.setFromAxisAngle(c.crossVectors(a, want).normalize(), Math.min(a.angleTo(want), flex)));
}

// Replaces the clip's arms with the pose: each segment points along its screen angle from the rest pose, so every
// frame of a pose has the same arms while the legs keep running.
export function poseArms(r, pose) {
  const p = POSES[pose], dz = DEPTH[pose];
  for (const [sd, side] of [['L', 'Left'], ['R', 'Right']]) {
    const [arm, fore, hand] = ['Arm', 'ForeArm', 'Hand'].map(n => r.bones[side + n]);
    for (const bone of [arm, fore, hand]) bone.quaternion.copy(bone.userData.rest);
    const foreDir = dirOf(p[sd][1], dz[1]);
    aim(arm, fore, dirOf(p[sd][0], dz[0]));
    aim(fore, hand, foreDir);
    placeFist(fore, hand, foreDir, PALMS[pose][sd], PALMS[pose].flex);
  }
}
