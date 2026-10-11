import * as THREE from 'three';

// Procedural animation: each controller state maps to a pose function.
// Gait cycles are phase-locked to distance travelled (no foot sliding) and
// state changes cross-fade from a snapshot of the previous output pose.

const JOINTS = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'skirt', 'pelvis'];
const TAU = Math.PI * 2;
const sat = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = sat(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

// two-bone reach: after the FK pose is applied, turn the elbow so shoulder → wrist spans the distance to the
// target, then swing the shoulder so the wrist lands on it; the result is blended over the FK pose by w
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qS = new THREE.Quaternion(), _qE = new THREE.Quaternion();
function reachArm(S, E, W, T, w, palm = 0.05) {
  _qS.copy(S.quaternion); _qE.copy(E.quaternion);
  S.getWorldPosition(_s); E.getWorldPosition(_e); W.getWorldPosition(_w);
  const l1 = _s.distanceTo(_e), l2 = _e.distanceTo(_w);
  // the wrist stops a palm short of the hold
  _t.subVectors(T, _s); const dt = _t.length();
  _t.multiplyScalar(Math.max(0, dt - palm) / Math.max(dt, 1e-6)).add(_s);
  const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, _s.distanceTo(_t)));
  const inner = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  E.rotation.x = -(Math.PI - inner); // the elbow bends about its x (0 = a straight arm)
  S.updateWorldMatrix(false, true);
  W.getWorldPosition(_w);
  _q.setFromUnitVectors(_a.subVectors(_w, _s).normalize(), _b.subVectors(_t, _s).normalize());
  S.getWorldQuaternion(_qw); S.parent.getWorldQuaternion(_qp);
  S.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  if (w < 1) { S.quaternion.slerpQuaternions(_qS, S.quaternion.clone(), w); E.quaternion.slerpQuaternions(_qE, E.quaternion.clone(), w); }
  S.updateWorldMatrix(false, true);
}

function blankPose() {
  const j = {};
  for (const k of JOINTS) j[k] = [0, 0, 0];
  return { joints: j, pelvisY: 0, pelvisZ: 0 };
}
function resetPose(P) {
  for (const k of JOINTS) { const a = P.joints[k]; a[0] = 0; a[1] = 0; a[2] = 0; }
  P.pelvisY = 0; P.pelvisZ = 0;
}
function copyPose(dst, src) {
  for (const k of JOINTS) { const a = src.joints[k], b = dst.joints[k]; b[0] = a[0]; b[1] = a[1]; b[2] = a[2]; }
  dst.pelvisY = src.pelvisY; dst.pelvisZ = src.pelvisZ;
}
function lerpPose(dst, a, b, t) {
  for (const k of JOINTS) { const x = a.joints[k], y = b.joints[k], d = dst.joints[k]; d[0] = lerp(x[0], y[0], t); d[1] = lerp(x[1], y[1], t); d[2] = lerp(x[2], y[2], t); }
  dst.pelvisY = lerp(a.pelvisY, b.pelvisY, t); dst.pelvisZ = lerp(a.pelvisZ, b.pelvisZ, t);
}

export class Animator {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.scale = opts.scale || 1; // adult stride scaling
    this.out = blankPose();
    this.target = blankPose();
    this.snap = blankPose();
    this.tmpA = blankPose(); this.tmpB = blankPose();
    this.state = 'idle';
    this.fade = 1; this.fadeDur = 0.15;
    this.phase = 0; this.climbPhase = 0;
    this.time = 0;
    this.landT = 1; this.landAmt = 0;
    this.lean = 0; this.skirtSwing = 0; this.skirtVel = 0;
    this.prevVx = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.lookTarget = null;
    this.idleLook = 0; this.idleTimer = 3;
    this.onFootstep = null;
    this.lastStepPhase = 0;
  }

  setState(s, fadeDur = 0.15) {
    if (s === this.state) return;
    copyPose(this.snap, this.out);
    this.state = s; this.fade = 0; this.fadeDur = fadeDur;
    if (s === 'land') this.landT = 0;
  }

  land(intensity) { this.landAmt = Math.min(1, intensity); this.landT = 0; }

  // ctx: { speed, vx, vy, grounded, climbT, hangSwing, pushDir, crawlSpeed, deathT, deathKind, climbSpeed }
  update(dt, ctx) {
    this.time += dt; this._dt = dt;
    const P = this.target;
    // reset target
    for (const k of JOINTS) { const a = P.joints[k]; a[0] = a[1] = a[2] = 0; }
    P.pelvisY = 0; P.pelvisZ = 0;
    const st = this.state;
    const stride = this.scale;
    if (st === 'ground' || st === 'push' || st === 'pull' || st === 'crawl') {
      const sp = Math.abs(ctx.speed);
      let cycleLen = (st === 'crawl') ? 0.7 * stride : lerp(1.05, 2.25, smooth((sp - 1.6) / 1.8)) * stride;
      if (st === 'push' || st === 'pull') cycleLen = 0.8 * stride;
      const dir = (st === 'pull') ? -1 : 1;
      const prev = this.phase;
      this.phase = (this.phase + dir * sp * dt / cycleLen + 1) % 1;
      // footsteps at phase 0 and 0.5 crossings
      if (sp > 0.2) {
        const crossed = (a, b, c) => (a < c && b >= c) || (a > b && (c > a || c <= b));
        if (crossed(prev, this.phase, 0.25) || crossed(prev, this.phase, 0.75)) this.onFootstep && this.onFootstep(sp, st);
      }
    }
    if (st === 'climb') {
      this.climbPhase = (this.climbPhase + ctx.climbSpeed * dt / (0.8 * stride) + 1) % 1;
    }
    const idleW = st === 'ground' ? 1 - smooth(Math.abs(ctx.speed) / 0.6) : 0;
    switch (st) {
      case 'ground': {
        const sp = Math.abs(ctx.speed);
        const runW = smooth((sp - 1.8) / 1.6);
        this.gait(this.tmpA, this.phase, 'walk');
        this.gait(this.tmpB, this.phase, 'run');
        lerpPose(P, this.tmpA, this.tmpB, runW);
        const moveW = smooth(sp / 0.6);
        if (moveW < 1) { this.idle(this.tmpA); lerpPose(P, this.tmpA, P, moveW); }
        // lean into acceleration
        const acc = (ctx.vx - this.prevVx) / Math.max(dt, 1e-3) * (ctx.facing || 1);
        this.lean = lerp(this.lean, THREE.MathUtils.clamp(acc * 0.012, -0.25, 0.2), 1 - Math.exp(-6 * dt));
        P.joints.spine[0] += this.lean;
        break;
      }
      case 'push': this.push(P, this.phase, ctx); if (ctx.tilt) this.tiltArms(P, ctx); break;
      case 'pull': this.pull(P, this.phase, ctx); if (ctx.tilt) this.tiltArms(P, ctx); break;
      case 'crank': this.crank(P, ctx); break;
      case 'capstan': this.capstan(P, ctx); break;
      case 'reach': this.reach(P, ctx); break;
      case 'sit': this.sit(P, ctx); break;
      case 'shieldEyes': this.shieldEyes(P, ctx); break;
      case 'asleep': this.asleep(P, ctx); break;
      case 'crawl': this.crawl(P, this.phase, ctx); break;
      case 'air': this.air(P, ctx); break;
      case 'hang': this.hang(P, ctx); break;
      case 'climbUp': this.climbUp(P, ctx.climbT); break;
      case 'climb': this.climb(P, this.climbPhase, ctx); break;
      case 'lever': this.leverPose(P, ctx); break;
      case 'dead': this.dead(P, ctx); break;
      case 'walkIn': this.gait(P, this.phase, 'walk'); break;
      default: this.idle(P);
    }
    // landing absorb overlay
    if (this.landT < 1 && (st === 'ground' || st === 'land')) {
      this.landT += dt / (0.22 + this.landAmt * 0.25);
      const k = Math.sin(Math.min(1, this.landT) * Math.PI) * this.landAmt;
      P.pelvisY -= 0.14 * k * stride;
      P.joints.hipL[0] -= 0.8 * k; P.joints.hipR[0] -= 0.7 * k;
      P.joints.kneeL[0] += 1.4 * k; P.joints.kneeR[0] += 1.3 * k;
      P.joints.ankleL[0] -= 0.6 * k; P.joints.ankleR[0] -= 0.6 * k;
      P.joints.spine[0] += 0.45 * k;
      P.joints.shoulderL[2] += 0.4 * k; P.joints.shoulderR[2] -= 0.4 * k;
    }
    // head look-at (yaw only, subtle)
    let lookYaw = 0;
    if (idleW > 0.5) {
      this.idleTimer -= dt;
      if (this.idleTimer < 0) { this.idleLook = this.idleLook === 0 ? (Math.random() < 0.6 ? 0.7 : -0.4) : 0; this.idleTimer = 2 + Math.random() * 3; }
      lookYaw = this.idleLook;
    } else this.idleLook = 0;
    if (ctx.lookYaw !== undefined && ctx.lookYaw !== null) lookYaw = ctx.lookYaw;
    this.lookYaw = lerp(this.lookYaw, lookYaw, 1 - Math.exp(-4 * dt));
    P.joints.neck[1] += this.lookYaw * 0.4; P.joints.head[1] += this.lookYaw * 0.6;

    // cross-fade from snapshot
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const f = smooth(this.fade);
    if (f < 1) lerpPose(this.out, this.snap, P, f); else copyPose(this.out, P);

    // secondary: skirt swing lags behind body acceleration, plus leg spread
    const accX = (ctx.vx - this.prevVx) / Math.max(dt, 1e-3);
    this.prevVx = ctx.vx;
    const k = 60, c = 9;
    const force = -accX * 0.02 * (ctx.facing || 1) - this.skirtSwing * k - this.skirtVel * c + (ctx.grounded ? 0 : ctx.vy * 0.4);
    this.skirtVel += force * dt; this.skirtSwing += this.skirtVel * dt;
    this.skirtSwing = THREE.MathUtils.clamp(this.skirtSwing, -0.5, 0.5);
    const o = this.out.joints;
    const legAvg = (o.hipL[0] + o.hipR[0]) * 0.5;
    o.skirt[0] = legAvg * 0.55 + this.skirtSwing;
    const spread = Math.abs(o.hipL[0] - o.hipR[0]);
    // lying on his back the robe lies flat on the stones (its depth is the vertical then)
    const lie = st === 'asleep' ? (this.lying || 0) : 0;
    this.rig.j.skirt.scale.set(1 + spread * 0.05 + 0.12 * lie, 1, (1 + spread * 0.35 * (1 - lie)) * (1 - 0.55 * lie));
    if (lie) o.skirt[0] = lerp(o.skirt[0], 0.1, lie);
    this.rig.apply(this.out);
    this.reach2(ctx.hands, dt);
  }

  // hands on a prop (ctx.hands {a, b}: world points, the player gives them for a mirror's rim, a crank, the
  // capstan's bar): two-bone IK over the pose, eased in and out; each hand takes the nearer point
  reach2(H, dt) {
    this.ikW = (this.ikW || 0) + ((H ? 1 : 0) - (this.ikW || 0)) * (1 - Math.exp(-12 * dt));
    if (H) { (this.ikA || (this.ikA = new THREE.Vector3())).copy(H.a); (this.ikB || (this.ikB = new THREE.Vector3())).copy(H.b); }
    if (this.ikW < 0.01 || !this.ikA) return;
    const R = this.rig, J = R.j;
    R.root.updateMatrixWorld(true);
    J.shoulderL.getWorldPosition(_s); J.shoulderR.getWorldPosition(_e);
    const swap = _s.distanceTo(this.ikA) + _e.distanceTo(this.ikB) > _s.distanceTo(this.ikB) + _e.distanceTo(this.ikA);
    reachArm(J.shoulderL, J.elbowL, J.wristL, swap ? this.ikB : this.ikA, this.ikW);
    reachArm(J.shoulderR, J.elbowR, J.wristR, swap ? this.ikA : this.ikB, this.ikW);
  }

  // ---- poses -------------------------------------------------------------
  idle(P) {
    resetPose(P);
    const t = this.time;
    const b = Math.sin(t * 1.9);
    const J = P.joints;
    J.spine[0] = 0.03 + b * 0.012; J.chest[0] = b * 0.018;
    J.neck[0] = -0.02; J.head[0] = 0.04 + Math.sin(t * 0.7) * 0.02;
    J.shoulderL = [0.05, 0, 0.1 + b * 0.01]; J.shoulderR = [0.08, 0, -0.1 - b * 0.01];
    J.elbowL[0] = -0.15; J.elbowR[0] = -0.2;
    const w = Math.sin(t * 0.45) * 0.5 + 0.5;
    J.hipL = [0.02, 0, 0.03 + w * 0.02]; J.hipR = [-0.04, 0, -0.03 - w * 0.02];
    J.kneeL[0] = 0.06; J.kneeR[0] = 0.1 + w * 0.05;
    J.ankleL[0] = -0.05; J.ankleR[0] = -0.06;
    J.pelvis = [0, Math.sin(t * 0.45) * 0.03, (w - 0.5) * 0.03];
    P.pelvisY = -0.005 - w * 0.008;
  }

  gait(P, ph, kind) {
    resetPose(P);
    const s = ph * TAU;
    const J = P.joints;
    const run = kind === 'run';
    const hipA = run ? 0.6 : 0.42, hipB = run ? -0.14 : -0.02;
    const kneeA = run ? 1.55 : 0.75, kneeB = run ? 0.32 : 0.08;
    const armA = run ? 0.75 : 0.32, elb = run ? -1.35 : -0.25;
    J.hipL[0] = -hipA * Math.sin(s) + hipB; J.hipR[0] = -hipA * Math.sin(s + Math.PI) + hipB;
    const kn = (x) => Math.pow(Math.max(0, Math.cos(x)), 2);
    const ko = run ? 0.45 : 0.35;
    // swing-phase flex plus a little stance absorption for the run
    const st = (x) => run ? 0.22 * Math.max(0, Math.sin(x + 2.6)) : 0;
    J.kneeL[0] = kneeB + kneeA * kn(s + ko) + st(s); J.kneeR[0] = kneeB + kneeA * kn(s + Math.PI + ko) + st(s + Math.PI);
    J.ankleL[0] = -0.25 * Math.sin(s + 0.6) * (run ? 1 : 0.6); J.ankleR[0] = -0.25 * Math.sin(s + Math.PI + 0.6) * (run ? 1 : 0.6);
    J.shoulderL = [armA * Math.sin(s), 0, 0.1]; J.shoulderR = [armA * Math.sin(s + Math.PI), 0, -0.1];
    J.elbowL[0] = elb + (run ? 0.25 : 0.12) * Math.sin(s); J.elbowR[0] = elb + (run ? 0.25 : 0.12) * Math.sin(s + Math.PI);
    J.spine[0] = run ? 0.26 : 0.05; J.chest[0] = run ? 0.05 : 0.0;
    J.spine[1] = -0.12 * Math.sin(s) * (run ? 1 : 0.6); J.chest[1] = -0.1 * Math.sin(s) * (run ? 1 : 0.6);
    J.pelvis = [0, 0.14 * Math.sin(s) * (run ? 1 : 0.7), 0.03 * Math.cos(s)];
    J.neck[0] = run ? -0.18 : -0.03; J.head[0] = run ? -0.05 : 0.02;
    const bob = run ? 0.045 : 0.022;
    P.pelvisY = -bob * (1 - Math.abs(Math.cos(s))) + (run ? -0.03 : 0);
  }

  push(P, ph, ctx) {
    this.gait(P, ph, 'walk');
    const J = P.joints;
    J.spine[0] = 0.5; J.chest[0] = 0.12; J.neck[0] = -0.35; J.head[0] = -0.15;
    J.shoulderL = [-1.25, 0, 0.12]; J.shoulderR = [-1.3, 0, -0.12];
    J.elbowL[0] = -0.55; J.elbowR[0] = -0.5;
    J.hipL[0] -= 0.25; J.hipR[0] -= 0.25; J.kneeL[0] += 0.25; J.kneeR[0] += 0.25;
    P.pelvisY -= 0.05; P.pelvisZ = -0.04;
    if (Math.abs(ctx.speed) < 0.05) { J.hipL[0] = -0.5; J.hipR[0] = 0.1; J.kneeL[0] = 0.55; J.kneeR[0] = 0.2; }
  }

  pull(P, ph, ctx) {
    this.gait(P, ph, 'walk');
    const J = P.joints;
    J.spine[0] = -0.2; J.chest[0] = -0.08; J.neck[0] = 0.15;
    J.shoulderL = [-1.45, 0, 0.1]; J.shoulderR = [-1.5, 0, -0.1];
    J.elbowL[0] = -0.1; J.elbowR[0] = -0.1;
    J.kneeL[0] += 0.2; J.kneeR[0] += 0.2;
    P.pelvisY -= 0.06; P.pelvisZ = -0.05;
    if (Math.abs(ctx.speed) < 0.05) { J.hipL[0] = 0.2; J.hipR[0] = -0.35; J.kneeL[0] = 0.45; J.kneeR[0] = 0.25; }
  }

  crawl(P, ph, ctx) {
    const s = ph * TAU;
    const J = P.joints;
    const mv = Math.min(1, Math.abs(ctx.speed) / 0.4);
    J.spine[0] = 1.25; J.chest[0] = 0.12; J.neck[0] = -0.85; J.head[0] = -0.35;
    J.hipL[0] = -0.05 - 0.35 * Math.sin(s) * mv; J.hipR[0] = -0.05 - 0.35 * Math.sin(s + Math.PI) * mv;
    J.kneeL[0] = 1.55 + 0.1 * Math.cos(s) * mv; J.kneeR[0] = 1.55 + 0.1 * Math.cos(s + Math.PI) * mv;
    J.ankleL[0] = 0.5; J.ankleR[0] = 0.5;
    J.shoulderL = [-1.3 + 0.35 * Math.sin(s + Math.PI) * mv, 0, 0.12]; J.shoulderR = [-1.3 + 0.35 * Math.sin(s) * mv, 0, -0.12];
    J.elbowL[0] = -0.15; J.elbowR[0] = -0.15;
    P.pelvisY = -(this.rig.spec.hipH - this.rig.spec.thigh - 0.07) ;
    P.pelvisZ = -0.05;
  }

  air(P, ctx) {
    const J = P.joints;
    const up = smooth((ctx.vy + 1) / 5);   // 1 when rising fast
    const fall = smooth((-ctx.vy - 1) / 6); // 1 when falling fast
    // rising: tucked stride; falling: legs reach down, arms out
    J.hipL[0] = lerp(-0.25, -1.05, up); J.kneeL[0] = lerp(0.45, 1.5, up);
    J.hipR[0] = lerp(0.1, 0.35, up); J.kneeR[0] = lerp(0.35, 0.7, up);
    J.shoulderL = [lerp(-0.6, 0.6, up), 0, lerp(0.6, 0.2, up)];
    J.shoulderR = [lerp(-0.4, -1.2, up), 0, lerp(-0.6, -0.2, up)];
    J.elbowL[0] = -0.5; J.elbowR[0] = -0.6;
    J.spine[0] = lerp(0.05, 0.22, up); J.neck[0] = -0.1;
    J.hipL[0] += fall * 0.15; J.hipR[0] -= fall * 0.3; J.kneeR[0] += fall * 0.1;
    J.shoulderL[2] += fall * 0.7; J.shoulderR[2] -= fall * 0.7; J.shoulderL[0] -= fall * 0.8; J.shoulderR[0] -= fall * 0.4;
    P.pelvisY = 0;
  }

  hang(P, ctx) {
    const J = P.joints;
    const sw = ctx.hangSwing || 0;
    J.shoulderL = [-2.9, 0, 0.12]; J.shoulderR = [-2.9, 0, -0.12];
    J.elbowL[0] = -0.12; J.elbowR[0] = -0.12;
    J.spine[0] = -0.05 + sw * 0.1; J.chest[0] = -0.1; J.neck[0] = 0.25; J.head[0] = 0.1;
    J.hipL[0] = -0.2 + sw * 0.25 + Math.sin(this.time * 2.1) * 0.05; J.hipR[0] = -0.05 + sw * 0.2 + Math.sin(this.time * 2.1 + 1) * 0.05;
    J.kneeL[0] = 0.4; J.kneeR[0] = 0.25;
    J.ankleL[0] = 0.4; J.ankleR[0] = 0.4;
    J.pelvis = [sw * 0.15, 0, 0];
  }

  climbUp(P, t) {
    const J = P.joints;
    // 0..0.5 pull body up, knee to ledge; 0.5..1 stand up on the ledge
    const a = smooth(t / 0.5), b = smooth((t - 0.45) / 0.55);
    J.shoulderL = [lerp(-2.9, -0.9, a), 0, 0.2]; J.shoulderR = [lerp(-2.9, -0.8, a), 0, -0.2];
    J.elbowL[0] = lerp(-0.1, -2.0, a) * (1 - b) - 0.2 * b; J.elbowR[0] = lerp(-0.1, -1.9, a) * (1 - b) - 0.2 * b;
    J.shoulderL[0] = lerp(J.shoulderL[0], 0.1, b); J.shoulderR[0] = lerp(J.shoulderR[0], 0.1, b);
    J.spine[0] = lerp(0.0, 0.75, a) * (1 - b) + 0.1 * b;
    J.neck[0] = -0.3 * a * (1 - b);
    J.hipL[0] = lerp(-0.2, -1.6, a) * (1 - b) + (-0.1) * b; J.kneeL[0] = lerp(0.4, 2.1, a) * (1 - b) + 0.1 * b;
    J.hipR[0] = lerp(-0.05, -0.4, a) * (1 - b); J.kneeR[0] = lerp(0.25, 0.9, a) * (1 - b) + 0.05 * b;
    P.pelvisY = -0.02 * b;
  }

  climb(P, ph, ctx) {
    const s = ph * TAU;
    const J = P.joints;
    const mv = Math.min(1, Math.abs(ctx.climbSpeed) / 0.3 + 0.15);
    J.shoulderL = [-2.55 + 0.4 * Math.sin(s) * mv, 0, 0.25]; J.shoulderR = [-2.55 + 0.4 * Math.sin(s + Math.PI) * mv, 0, -0.25];
    J.elbowL[0] = -0.6 - 0.4 * Math.cos(s) * mv; J.elbowR[0] = -0.6 - 0.4 * Math.cos(s + Math.PI) * mv;
    J.hipL[0] = -0.85 + 0.4 * Math.sin(s + Math.PI) * mv; J.hipR[0] = -0.85 + 0.4 * Math.sin(s) * mv;
    J.kneeL[0] = 1.3 - 0.35 * Math.sin(s + Math.PI) * mv; J.kneeR[0] = 1.3 - 0.35 * Math.sin(s) * mv;
    J.hipL[2] = 0.2; J.hipR[2] = -0.2;
    J.spine[0] = 0.05; J.neck[0] = 0.3; J.head[0] = 0.15;
    P.pelvisZ = -0.04;
  }

  leverPose(P, ctx) {
    const J = P.joints;
    const t = ctx.leverT || 0;
    J.spine[0] = lerp(0.3, -0.25, t); J.neck[0] = -0.1;
    J.shoulderL = [lerp(-2.6, -1.2, t), 0, 0.1]; J.shoulderR = [lerp(-2.6, -1.25, t), 0, -0.1];
    J.elbowL[0] = -0.3; J.elbowR[0] = -0.3;
    J.hipL[0] = lerp(-0.2, 0.25, t); J.hipR[0] = lerp(0.1, -0.5, t); J.kneeL[0] = lerp(0.2, 0.5, t); J.kneeR[0] = lerp(0.1, 0.6, t);
    P.pelvisY = -0.06 * t;
  }

  // ---- Sunwork poses (FULL_GAME §6.3) ------------------------------------
  // hands up on a mirror's rim while gripping it: the arms reach the rim's height, and each notch is a small shove
  tiltArms(P, ctx) {
    const J = P.joints, T = ctx.tilt;
    const rim = THREE.MathUtils.clamp(T.rim ?? 0.9, 0.55, 1.7);
    const lift = THREE.MathUtils.clamp((rim - 0.75) * 1.9, 0, 1.6);
    const shove = Math.max(0, 1 - (T.age ?? 9) / 0.16) * (T.dir || 0);
    const sh = -1.25 - lift - shove * 0.25;
    J.shoulderL = [sh, 0, 0.16]; J.shoulderR = [sh - 0.05, 0, -0.16];
    J.elbowL[0] = -0.35 + lift * 0.15 - shove * 0.2; J.elbowR[0] = -0.3 + lift * 0.15 - shove * 0.2;
    J.spine[0] = Math.min(J.spine[0], 0.35 - lift * 0.12); J.chest[0] = -0.05 * lift;
    J.neck[0] = -0.25 - lift * 0.12; J.head[0] = -0.1 - lift * 0.1;
  }

  // two hands on a crank's wheel, following its knob; the torso twists into each turn
  crank(P, ctx) {
    const J = P.joints;
    const a = ctx.crankA || 0;
    const s = Math.sin(a), c = Math.cos(a);
    J.spine[0] = 0.32; J.spine[1] = 0.14 * s; J.chest[0] = 0.06; J.chest[1] = 0.1 * s;
    J.neck[0] = -0.3; J.head[0] = -0.12;
    J.shoulderL = [-1.35 + 0.32 * s, 0, 0.2 + 0.08 * c]; J.shoulderR = [-1.35 - 0.32 * s, 0, -0.2 + 0.08 * c];
    J.elbowL[0] = -0.55 - 0.3 * c; J.elbowR[0] = -0.55 + 0.3 * c;
    J.hipL = [-0.45, 0, 0.08]; J.hipR = [0.22, 0, -0.06]; J.kneeL[0] = 0.55; J.kneeR[0] = 0.32;
    J.ankleL[0] = -0.12; J.ankleR[0] = 0.05;
    J.pelvis = [0, 0.1 * s, 0];
    P.pelvisY = -0.06;
  }

  // leaning into a capstan bar, stepping as it turns
  capstan(P, ctx) {
    const v = THREE.MathUtils.clamp((ctx.capstanV || 0) / 6, -1, 1);
    this.phase = (this.phase + Math.abs(v) * 1.8 * (this._dt || 0) + 1) % 1;
    const s = this.phase * TAU, J = P.joints;
    J.spine[0] = 0.62; J.chest[0] = 0.12; J.neck[0] = -0.5; J.head[0] = -0.18;
    J.shoulderL = [-1.15, 0, 0.12]; J.shoulderR = [-1.2, 0, -0.12]; J.elbowL[0] = -0.4; J.elbowR[0] = -0.38;
    const m = Math.abs(v);
    J.hipL[0] = -0.75 + 0.3 * Math.sin(s) * m; J.hipR[0] = 0.05 + 0.3 * Math.sin(s + Math.PI) * m;
    J.kneeL[0] = 0.75 + 0.2 * Math.max(0, Math.cos(s)) * m; J.kneeR[0] = 0.35 + 0.25 * Math.max(0, Math.cos(s + Math.PI)) * m;
    J.ankleL[0] = 0.15; J.ankleR[0] = 0.3;
    P.pelvisY = -0.09; P.pelvisZ = -0.06;
  }

  // reaching up and forward (taking the tray from its pedestal, setting it in the heliostat's ring)
  reach(P, ctx) {
    this.idle(P);
    const J = P.joints;
    const t = ctx.poseT ?? 1;
    const up = smooth(t / 0.45), hold = 1 - smooth((t - 1.1) / 0.4);
    const k = up * (0.35 + 0.65 * hold);
    J.shoulderR = [lerp(0.08, -1.75, k), 0, lerp(-0.1, -0.12, k)]; J.elbowR[0] = lerp(-0.2, -0.25, k);
    J.shoulderL = [lerp(0.05, -1.35, k * 0.8), 0, lerp(0.1, 0.18, k)]; J.elbowL[0] = lerp(-0.15, -0.45, k);
    J.spine[0] = lerp(J.spine[0], 0.18, k); J.chest[0] = -0.08 * k; J.neck[0] = lerp(-0.02, -0.35, k); J.head[0] = lerp(0.04, -0.2, k);
    J.ankleL[0] = -0.12 * k; J.ankleR[0] = -0.2 * k; P.pelvisY += 0.015 * k;
  }

  // sitting on a parapet, hands on the stone, legs hanging
  sit(P, ctx) {
    const J = P.joints, t = ctx.poseT ?? 2;
    const k = smooth(t / 1.2);
    const b = Math.sin(this.time * 1.3) * 0.015;
    J.hipL[0] = lerp(0, -1.5, k); J.hipR[0] = lerp(0, -1.42, k);
    J.kneeL[0] = lerp(0.05, 1.35 + Math.sin(this.time * 0.9) * 0.08 * k, k); J.kneeR[0] = lerp(0.05, 1.5, k);
    J.ankleL[0] = 0.25 * k; J.ankleR[0] = 0.2 * k;
    J.spine[0] = lerp(0.03, 0.12, k) + b; J.chest[0] = 0.04 * k; J.neck[0] = lerp(-0.02, -0.08, k); J.head[0] = lerp(0.04, -0.12, k);
    J.shoulderL = [lerp(0.05, 0.35, k), 0, lerp(0.1, 0.32, k)]; J.shoulderR = [lerp(0.08, 0.3, k), 0, lerp(-0.1, -0.32, k)];
    J.elbowL[0] = -0.12; J.elbowR[0] = -0.15;
    P.pelvisY = -(this.rig.spec.thigh * 0.95) * k; P.pelvisZ = -0.05 * k;
  }

  // a lamp-keeper blinded by the sun: recoil, the free arm over the hood, the lantern arm thrown out
  shieldEyes(P, ctx) {
    const J = P.joints, t = ctx.poseT ?? 1;
    const k = smooth(t / 0.18), w = Math.sin(this.time * 17) * 0.03;
    J.spine[0] = lerp(0, -0.28, k) + w; J.chest[0] = -0.12 * k; J.neck[0] = 0.25 * k; J.head[0] = -0.35 * k;
    J.shoulderL = [lerp(0, -2.5, k), 0, lerp(0.1, 0.65, k)]; J.elbowL[0] = lerp(-0.2, -2.1, k);
    J.shoulderR = [lerp(0, -0.6, k), 0, lerp(-0.1, -0.9, k)]; J.elbowR[0] = -0.4 * k;
    J.hipL[0] = -0.35 * k; J.hipR[0] = 0.25 * k; J.kneeL[0] = 0.55 * k; J.kneeR[0] = 0.35 * k;
    P.pelvisY = -0.08 * k; P.pelvisZ = 0.06 * k;
  }

  // a dart: the knees buckle (a), then he falls back flat on the ground (b): on his back, head turned aside, one
  // knee raised, the arms out on the stones. Lying, the pelvis is a torso's half depth above the floor
  asleep(P, ctx) {
    const J = P.joints, t = ctx.poseT ?? 3, S = this.rig.spec;
    const a = smooth(t / 0.4), b = smooth((t - 0.35) / 0.7);
    J.hipL[0] = -1.4 * a + 0.9 * b; J.hipR[0] = -1.2 * a + 1.3 * b; J.kneeL[0] = 2.2 * a - 1.1 * b; J.kneeR[0] = 2.1 * a - 2.1 * b;
    J.ankleL[0] = 0.2 * b; J.ankleR[0] = 0;
    J.spine[0] = 0.5 * a - 0.5 * b; J.chest[0] = 0; J.neck[0] = 0.4 * a - 0.25 * b; J.head = [0.05 * b, 0.5 * b, 0.25 * b];
    J.shoulderL = [0.4 * a - 0.1 * b, 0, 0.5 * a + 0.75 * b]; J.shoulderR = [0.3 * a + 0.1 * b, 0, -0.4 * a - 0.15 * b];
    J.elbowL[0] = -0.4 + 0.1 * b; J.elbowR[0] = -0.3;
    J.pelvis = [-1.5 * b, 0, 0.08 * b];
    P.pelvisY = lerp(-0.42 * a, S.chestR * S.torsoDepth + 0.03 - S.hipH, b);
    this.lying = b;
  }

  dead(P, ctx) {
    const J = P.joints;
    const t = ctx.deathT || 0;
    if (ctx.deathKind === 'sunset') {
      // the last light goes: a slow kneel, head bowed, into the dark
      const a = smooth(t / 1.1), b = smooth((t - 0.8) / 0.9);
      J.hipL[0] = -1.15 * a; J.hipR[0] = 0.15 * a + 0.2 * b; J.kneeL[0] = 1.9 * a; J.kneeR[0] = 1.6 * a + 0.5 * b;
      J.ankleL[0] = -0.5 * a; J.ankleR[0] = 0.6 * a;
      J.spine[0] = 0.25 * a + 0.35 * b; J.chest[0] = 0.12 * b; J.neck[0] = 0.35 * a + 0.2 * b; J.head[0] = 0.25 * b;
      J.shoulderL = [-0.15 * a, 0, 0.12 + 0.1 * b]; J.shoulderR = [-0.25 * a - 0.2 * b, 0, -0.12]; J.elbowL[0] = -0.3; J.elbowR[0] = -0.5 * b;
      P.pelvisY = -0.36 * a - 0.08 * b;
      return;
    }
    if (ctx.deathKind === 'fall') {
      J.spine[0] = 1.45; J.neck[0] = 0.2; J.hipL[0] = -0.4; J.kneeL[0] = 0.8; J.hipR[0] = 0.2; J.kneeR[0] = 0.3;
      J.shoulderL = [-2.4, 0, 0.9]; J.shoulderR = [-0.3, 0, -1.2]; J.elbowL[0] = -0.4;
      J.pelvis = [1.35, 0, 0.15];
      P.pelvisY = -(this.rig.spec.hipH - 0.12);
      return;
    }
    const a = smooth(t / 0.35), b = smooth((t - 0.3) / 0.5);
    J.hipL[0] = -1.3 * a; J.hipR[0] = -1.1 * a; J.kneeL[0] = 2.3 * a; J.kneeR[0] = 2.2 * a;
    J.spine[0] = 0.4 * a + 0.9 * b; J.neck[0] = 0.3 * a;
    J.shoulderL = [0.3 * a - 1.8 * b, 0, 0.4 * a]; J.shoulderR = [0.2 * a - 0.4 * b, 0, -0.5 * a - 0.6 * b];
    J.elbowL[0] = -0.4; J.elbowR[0] = -0.6;
    J.pelvis = [0.9 * b, 0, 0.5 * b];
    P.pelvisY = -0.28 * a - 0.18 * b;
  }
}
