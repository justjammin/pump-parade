import { NodeIO } from '@gltf-transform/core';

// Meshy's A-pose rig has no finger bones and rebuilds hands open even from a fists concept, so the fingers are
// curled in the mesh itself: a bend deformer over hand-weighted vertices past the knuckle line, in bind space.
const KNUCKLE = 0.5, CURL = 200 * Math.PI / 180;

const sub = (p, q) => p.map((v, i) => v - q[i]), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = p => { const l = Math.hypot(...p); return p.map(v => v / l); };

// Joint origin in mesh space: the translation of an affine inverse-bind matrix's inverse (column-major).
function jointOrigin(m) {
  const r = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], t = [m[12], m[13], m[14]];
  const c = (i, j) => r[(j + 1) % 3][(i + 1) % 3] * r[(j + 2) % 3][(i + 2) % 3] - r[(j + 1) % 3][(i + 2) % 3] * r[(j + 2) % 3][(i + 1) % 3];
  const det = r[0][0] * c(0, 0) + r[0][1] * c(1, 0) + r[0][2] * c(2, 0);
  return [0, 1, 2].map(i => -(c(i, 0) * t[0] + c(i, 1) * t[1] + c(i, 2) * t[2]) / det);
}

// Smallest-variance axis of a point cloud: power iteration on the covariance with the top two axes deflated.
function palmNormal(pts) {
  const mean = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  let m = [0, 1, 2].map(i => [0, 1, 2].map(j => pts.reduce((s, p) => s + (p[i] - mean[i]) * (p[j] - mean[j]), 0) / pts.length));
  let v;
  for (let k = 0; k < 3; k++) {
    v = norm([1, 0.3 + k, 0.2 - k]);
    for (let i = 0; i < 200; i++) v = norm(m.map(row => dot(row, v)));
    const lam = dot(v, m.map(row => dot(row, v)));
    m = m.map((row, i) => row.map((x, j) => x - lam * v[i] * v[j]));
  }
  return v;
}

export async function curlFists(glb) {
  const io = new NodeIO(), doc = await io.readBinary(glb);
  const skin = doc.getRoot().listSkins()[0], joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TANGENT');
  const J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0');
  const origin = name => jointOrigin(ibm.getElement(joints.findIndex(j => j.getName() === name), []));
  for (const side of ['Left', 'Right']) {
    const ji = joints.findIndex(j => j.getName() === side + 'Hand'), wrist = origin(side + 'Hand');
    const weight = i => { const j = J.getElement(i, []), w = Wt.getElement(i, []); return j.reduce((s, x, k) => s + (x === ji ? w[k] : 0), 0); };
    const ids = [];
    for (let i = 0; i < P.getCount(); i++) if (weight(i) > 0.5) ids.push(i);
    let Nn = palmNormal(ids.map(i => P.getElement(i, [])));
    if (Nn[0] * wrist[0] < 0) Nn = Nn.map(v => -v);
    // The palm side in the joint's own frame, which rig.js reads as bone.userData.palm to turn the curled fingers toward the camera.
    const m = ibm.getElement(ji, []);
    joints[ji].setExtras({ ...joints[ji].getExtras(), palm: norm([0, 1, 2].map(k => -(m[k] * Nn[0] + m[k + 4] * Nn[1] + m[k + 8] * Nn[2]))) });
    // Spread fingers make the hand about as wide as it is long, so the finger axis comes from the forearm, not PCA.
    const fore = sub(wrist, origin(side + 'ForeArm')), U = norm(fore.map((x, k) => x - dot(fore, Nn) * Nn[k])), V = norm(cross(Nn, U));
    const local = i => { const d = sub(P.getElement(i, []), wrist); return [dot(d, U), dot(d, V), dot(d, Nn)]; };
    const pts = ids.map(local), L = Math.max(...pts.map(p => p[0])), uk = L * KNUCKLE, R = (L - uk) / CURL;
    const past = pts.filter(p => p[0] > uk), n0 = past.reduce((s, p) => s + p[2], 0) / past.length;
    // Palms face the thighs in the A-pose, which is -N once N points away from the body.
    const s = -1;
    const rotate = (vec, phi) => {
      const c = Math.cos(phi), sn = Math.sin(phi), u = dot(vec, U), v = dot(vec, V), n = dot(vec, Nn);
      return [0, 1, 2].map(k => (c * u - s * sn * n) * U[k] + v * V[k] + (s * sn * u + c * n) * Nn[k]);
    };
    ids.forEach((i, idx) => {
      const [u, v, n] = pts[idx];
      if (u <= uk) return;
      const phi = (u - uk) / (L - uk) * CURL, r = R - s * (n - n0);
      const u2 = uk + r * Math.sin(phi), n2 = n0 + s * (R - r * Math.cos(phi));
      P.setElement(i, [0, 1, 2].map(k => wrist[k] + u2 * U[k] + v * V[k] + n2 * Nn[k]));
      N.setElement(i, norm(rotate(N.getElement(i, []), phi)));
      if (T) { const t = T.getElement(i, []); T.setElement(i, [...rotate(t.slice(0, 3), phi), t[3]]); }
    });
  }
  return Buffer.from(await io.writeBinary(doc));
}
