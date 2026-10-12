var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/core/ballSim.js
var G = 9.81;
var BALL_R = 0.05;
var CUP_R = 0.22;
var CUP_RADIUS = CUP_R;
var CUP_CAPTURE_SPEED = 2.4;
var CAPTURE = CUP_CAPTURE_SPEED;
var SIM_DT = 1 / 120;
var DRAG = 3e-3;
var LIFT = 16e-4;
var CURVE = 0.055;
var WIND_PUSH = 0.11;
var SURFACES = {
  tee: { e: 0.4, ft: 0.6, mu0: 2.6, mu1: 0.5, bite: 0.5 },
  fairway: { e: 0.42, ft: 0.6, mu0: 2.6, mu1: 0.5, bite: 0.6 },
  fringe: { e: 0.36, ft: 0.55, mu0: 1.4, mu1: 0.6, bite: 1.4 },
  green: { e: 0.34, ft: 0.5, mu0: 0.8, mu1: 0.5, bite: 2 },
  rough: { e: 0.2, ft: 0.4, mu0: 7, mu1: 1, bite: 0.2 },
  bunker: { e: 0.05, ft: 0.25, mu0: 14, mu1: 1.5, bite: 0.1 },
  water: { e: 0.05, ft: 0.25, mu0: 14, mu1: 1.5, bite: 0.1 }
};
function createBall(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    back: 0,
    // backspin 0..~1.6
    side: 0,
    // sidespin, + curves right of the travel direction
    mode: "rest",
    // 'rest' | 'air' | 'roll' | 'holed' | 'water' | 'oob'
    surface: "tee",
    time: 0,
    bounces: 0,
    landed: false,
    // first ground contact of this shot has happened
    landX: 0,
    landZ: 0,
    dryX: x,
    dryZ: z,
    // last in-bounds, non-water point passed over
    cupLock: false,
    // already lipped out on this pass over the cup
    lastTree: -1,
    shot: 0
    // shot counter (salts deterministic deflections)
  };
}
__name(createBall, "createBall");
function placeBall(ball, world, x, z) {
  ball.x = x;
  ball.z = z;
  ball.y = world.heightAt(x, z) + BALL_R;
  ball.vx = ball.vy = ball.vz = 0;
  ball.back = ball.side = 0;
  ball.mode = "rest";
  ball.surface = world.surfaceAt(x, z);
  ball.dryX = x;
  ball.dryZ = z;
  ball.cupLock = false;
  ball.lastTree = -1;
}
__name(placeBall, "placeBall");
function beginShot(ball) {
  ball.time = 0;
  ball.bounces = 0;
  ball.landed = false;
  ball.cupLock = false;
  ball.lastTree = -1;
  ball.shot += 1;
}
__name(beginShot, "beginShot");
function launchBall(ball, { speed, dirX, dirZ, loftDeg, back = 0, side = 0 }) {
  beginShot(ball);
  const loft = loftDeg * Math.PI / 180;
  const h = Math.cos(loft) * speed;
  ball.vx = dirX * h;
  ball.vz = dirZ * h;
  ball.vy = Math.sin(loft) * speed;
  ball.back = back;
  ball.side = side;
  ball.y += 0.02;
  ball.mode = "air";
}
__name(launchBall, "launchBall");
function puttBall(ball, { speed, dirX, dirZ }) {
  beginShot(ball);
  ball.vx = dirX * speed;
  ball.vz = dirZ * speed;
  ball.vy = 0;
  ball.back = ball.side = 0;
  ball.landed = true;
  ball.landX = ball.x;
  ball.landZ = ball.z;
  ball.mode = "roll";
}
__name(puttBall, "puttBall");
var _grad = [0, 0];
function hash01(a, b) {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
__name(hash01, "hash01");
function markDry(ball, world, surface) {
  if (surface !== "water" && Math.abs(ball.x) < world.half && Math.abs(ball.z) < world.half) {
    ball.dryX = ball.x;
    ball.dryZ = ball.z;
  }
}
__name(markDry, "markDry");
function outOfBounds(ball, world) {
  return Math.abs(ball.x) > world.half || Math.abs(ball.z) > world.half;
}
__name(outOfBounds, "outOfBounds");
function stepBall(ball, world, env, dt, events) {
  if (ball.mode === "air") stepAir(ball, world, env, dt, events);
  else if (ball.mode === "roll") stepRoll(ball, world, dt, events);
  else return;
  ball.time += dt;
}
__name(stepBall, "stepBall");
function stepAir(ball, world, env, dt, events) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const vh = Math.hypot(ball.vx, ball.vz);
  let ax = -DRAG * speed * ball.vx;
  let ay = -G - DRAG * speed * ball.vy;
  let az = -DRAG * speed * ball.vz;
  if (vh > 0.5) {
    const lift = LIFT * ball.back * speed;
    ax += lift * (-ball.vx * ball.vy / vh);
    ay += lift * vh;
    az += lift * (-ball.vz * ball.vy / vh);
    const curve = CURVE * ball.side * speed;
    ax += curve * (-ball.vz / vh);
    az += curve * (ball.vx / vh);
  }
  if (env) {
    ax += (env.windX || 0) * WIND_PUSH;
    az += (env.windZ || 0) * WIND_PUSH;
  }
  ball.vx += ax * dt;
  ball.vy += ay * dt;
  ball.vz += az * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  ball.back *= 1 - 0.06 * dt;
  ball.side *= 1 - 0.1 * dt;
  if (world.trees.length && hitTrees(ball, world, events)) return;
  const h = world.heightAt(ball.x, ball.z);
  if (ball.y - BALL_R > h) {
    if ((ball.time / dt | 0) % 12 === 0) {
      markDry(ball, world, world.waterLevelAt(ball.x, ball.z) > h ? "water" : "land");
    }
    return;
  }
  if (outOfBounds(ball, world)) {
    ball.mode = "oob";
    events.push({ type: "oob", x: ball.x, y: h, z: ball.z });
    return;
  }
  const waterLevel = world.waterLevelAt(ball.x, ball.z);
  if (waterLevel > h + 0.02) {
    ball.mode = "water";
    ball.y = waterLevel;
    events.push({ type: "splash", x: ball.x, y: waterLevel, z: ball.z, speed });
    return;
  }
  const surface = world.surfaceAt(ball.x, ball.z);
  const S = SURFACES[surface] || SURFACES.rough;
  ball.surface = surface;
  ball.y = h + BALL_R;
  markDry(ball, world, surface);
  if (!ball.landed) {
    ball.landed = true;
    ball.landX = ball.x;
    ball.landZ = ball.z;
    events.push({ type: "land", x: ball.x, y: h, z: ball.z, surface, speed });
  }
  if (world.cup && surface === "green") {
    const d = Math.hypot(ball.x - world.cup.x, ball.z - world.cup.z);
    if (d < (world.cup.r || CUP_R) * 0.9 && speed < 30) {
      holeOut(ball, world, events, true);
      return;
    }
  }
  world.gradAt(ball.x, ball.z, _grad);
  let nx = -_grad[0], ny = 1, nz = -_grad[1];
  const nl = Math.hypot(nx, ny, nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
  let tx = ball.vx - vn * nx, ty = ball.vy - vn * ny, tz = ball.vz - vn * nz;
  const tSpeed = Math.hypot(tx, ty, tz);
  const impact = -vn;
  if (impact < 1.3 || ball.bounces >= 6) {
    ball.vx = tx * 0.92;
    ball.vz = tz * 0.92;
    ball.vy = 0;
    ball.mode = "roll";
    events.push({ type: "roll", x: ball.x, y: h, z: ball.z, surface });
    return;
  }
  const e = S.e * Math.max(0.3, Math.min(1, 1 - impact / 45));
  let keep = tSpeed * S.ft - ball.back * S.bite * 3.2;
  const canSpinBack = surface === "green" || surface === "fringe";
  keep = Math.max(canSpinBack ? -2.5 : 0.15 * tSpeed, keep);
  const k = tSpeed > 1e-6 ? keep / tSpeed : 0;
  ball.vx = tx * k + nx * impact * e;
  ball.vy = ty * k + ny * impact * e;
  ball.vz = tz * k + nz * impact * e;
  ball.back *= 0.45;
  ball.side = 0;
  ball.bounces += 1;
  ball.y = h + BALL_R + 2e-3;
  events.push({ type: "bounce", x: ball.x, y: h, z: ball.z, surface, speed: impact });
}
__name(stepAir, "stepAir");
function hitTrees(ball, world, events) {
  const trees = world.trees;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const dx = ball.x - t.x, dz = ball.z - t.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > t.cr * t.cr) continue;
    if (ball.y < t.trunkTop && d2 < (t.trunkR + BALL_R) ** 2) {
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d, nz = dz / d;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0) {
        ball.vx = (ball.vx - 2 * vn * nx) * 0.4;
        ball.vz = (ball.vz - 2 * vn * nz) * 0.4;
        ball.vy *= 0.5;
        ball.x = t.x + nx * (t.trunkR + BALL_R + 0.01);
        ball.z = t.z + nz * (t.trunkR + BALL_R + 0.01);
        ball.side = 0;
        events.push({ type: "tree", part: "trunk", x: ball.x, y: ball.y, z: ball.z });
      }
      continue;
    }
    const dy = ball.y - t.cy;
    if (i !== ball.lastTree && d2 + dy * dy < t.cr * t.cr) {
      ball.lastTree = i;
      const a = (hash01(i, ball.shot) - 0.5) * 1.6;
      const c = Math.cos(a), s = Math.sin(a);
      const vx = ball.vx * c - ball.vz * s, vz = ball.vx * s + ball.vz * c;
      ball.vx = vx * 0.3;
      ball.vz = vz * 0.3;
      ball.vy = Math.min(ball.vy * 0.3, 0) - 1.5;
      ball.back = 0;
      ball.side = 0;
      events.push({ type: "tree", part: "canopy", x: ball.x, y: ball.y, z: ball.z });
    }
  }
  return false;
}
__name(hitTrees, "hitTrees");
function stepRoll(ball, world, dt, events) {
  const surface = world.surfaceAt(ball.x, ball.z);
  const S = SURFACES[surface] || SURFACES.rough;
  ball.surface = surface;
  world.gradAt(ball.x, ball.z, _grad);
  const gx = _grad[0], gz = _grad[1];
  const flat = 1 / (1 + gx * gx + gz * gz);
  let ax = -(5 / 7) * G * gx * flat;
  let az = -(5 / 7) * G * gz * flat;
  const slopeAcc = Math.hypot(ax, az);
  let speed = Math.hypot(ball.vx, ball.vz);
  const cup = world.cup;
  if (cup) {
    const cx = cup.x - ball.x, cz = cup.z - ball.z;
    const d = Math.hypot(cx, cz);
    const CUP_R2 = cup.r || CUP_RADIUS;
    const CUP_CAPTURE_SPEED2 = CAPTURE * Math.sqrt(CUP_R2 / CUP_RADIUS);
    if (d < CUP_R2) {
      if (!ball.cupLock) {
        if (speed < 0.05) {
          holeOut(ball, world, events, false);
          return;
        }
        const cross = (ball.vx * cz - ball.vz * cx) / speed;
        const off = Math.min(1, Math.abs(cross) / CUP_R2);
        const limit = CUP_CAPTURE_SPEED2 * Math.sqrt(1 - off * off);
        if (speed <= limit) {
          holeOut(ball, world, events, false);
          return;
        }
        ball.cupLock = true;
        const turn = Math.sign(cross || 1) * (0.25 + 0.9 * off);
        const c = Math.cos(turn), s = Math.sin(turn);
        const vx = ball.vx * c - ball.vz * s, vz = ball.vx * s + ball.vz * c;
        ball.vx = vx * 0.6;
        ball.vz = vz * 0.6;
        speed *= 0.6;
        events.push({ type: "lipout", x: ball.x, y: ball.y, z: ball.z, speed });
      }
    } else {
      if (d > CUP_R2 * 1.4) ball.cupLock = false;
      if (!ball.cupLock && d < CUP_R2 * 1.7 && speed < 0.9) {
        const pull = 2.4 * (1 - d / (CUP_R2 * 1.7));
        ax += cx / d * pull;
        az += cz / d * pull;
      }
    }
  }
  const mu = S.mu0 + S.mu1 * speed;
  if (speed < 0.07 && slopeAcc < S.mu0) {
    ball.vx = ball.vz = ball.vy = 0;
    ball.mode = "rest";
    events.push({ type: "rest", x: ball.x, y: ball.y, z: ball.z, surface });
    return;
  }
  ball.vx += ax * dt;
  ball.vz += az * dt;
  speed = Math.hypot(ball.vx, ball.vz);
  if (speed > 1e-6) {
    const k = Math.max(0, speed - mu * dt) / speed;
    ball.vx *= k;
    ball.vz *= k;
  }
  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;
  const h = world.heightAt(ball.x, ball.z);
  ball.y = h + BALL_R;
  if (outOfBounds(ball, world)) {
    ball.mode = "oob";
    events.push({ type: "oob", x: ball.x, y: h, z: ball.z });
    return;
  }
  const waterLevel = world.waterLevelAt(ball.x, ball.z);
  if (waterLevel > h + 0.02) {
    ball.mode = "water";
    events.push({ type: "splash", x: ball.x, y: waterLevel, z: ball.z, speed });
    return;
  }
  markDry(ball, world, surface);
  for (let i = 0; i < world.trees.length; i++) {
    const t = world.trees[i];
    const dx = ball.x - t.x, dz = ball.z - t.z;
    const rr = t.trunkR + BALL_R;
    if (dx * dx + dz * dz < rr * rr) {
      const d = Math.hypot(dx, dz) || 1e-6;
      const nx = dx / d, nz = dz / d;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0) {
        ball.vx = (ball.vx - 2 * vn * nx) * 0.35;
        ball.vz = (ball.vz - 2 * vn * nz) * 0.35;
      }
      ball.x = t.x + nx * (rr + 0.01);
      ball.z = t.z + nz * (rr + 0.01);
    }
  }
}
__name(stepRoll, "stepRoll");
function holeOut(ball, world, events, dunk) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  ball.mode = "holed";
  ball.vx = ball.vy = ball.vz = 0;
  events.push({ type: "holed", x: world.cup.x, y: ball.y, z: world.cup.z, dunk, speed });
}
__name(holeOut, "holeOut");
function simulate(ball, world, env, opts = {}) {
  const dt = opts.dt || SIM_DT;
  const maxTime = opts.maxTime || 30;
  const sample = opts.sample || 0;
  const stopOnLand = !!opts.stopOnLand;
  const events = [];
  const points = [];
  let nextSample = 0;
  let t = 0;
  if (sample) points.push(ball.x, ball.y, ball.z);
  while ((ball.mode === "air" || ball.mode === "roll") && t < maxTime) {
    stepBall(ball, world, env, dt, events);
    t += dt;
    if (sample && t >= nextSample) {
      points.push(ball.x, ball.y, ball.z);
      nextSample += sample;
    }
    if (stopOnLand && ball.landed) break;
  }
  if (sample) points.push(ball.x, ball.y, ball.z);
  return { events, points, time: t };
}
__name(simulate, "simulate");
function flatWorld(surface = "fairway") {
  return {
    heightAt: /* @__PURE__ */ __name(() => 0, "heightAt"),
    gradAt: /* @__PURE__ */ __name((x, z, out) => {
      out[0] = 0;
      out[1] = 0;
    }, "gradAt"),
    surfaceAt: /* @__PURE__ */ __name(() => surface, "surfaceAt"),
    waterLevelAt: /* @__PURE__ */ __name(() => -Infinity, "waterLevelAt"),
    cup: null,
    trees: [],
    half: 1e9
  };
}
__name(flatWorld, "flatWorld");

// ../src/core/clubs.js
var POWER_CURVE = 0.6;
var BAG = [
  { id: "driver", name: "Driver", short: "DR", loft: 12, spin: 0.25, carry: 170 },
  { id: "wood3", name: "3 Wood", short: "3W", loft: 14, spin: 0.3, carry: 155 },
  { id: "iron5", name: "5 Iron", short: "5i", loft: 19, spin: 0.45, carry: 138 },
  { id: "iron7", name: "7 Iron", short: "7i", loft: 24, spin: 0.6, carry: 120 },
  { id: "iron9", name: "9 Iron", short: "9i", loft: 30, spin: 0.75, carry: 102 },
  { id: "pw", name: "Pitching Wedge", short: "PW", loft: 37, spin: 0.9, carry: 85 },
  { id: "sw", name: "Sand Wedge", short: "SW", loft: 46, spin: 1, carry: 62 },
  { id: "chip", name: "Chipper", short: "CH", loft: 26, spin: 0.2, carry: 24 },
  { id: "putter", name: "Putter", short: "PT", loft: 0, spin: 0, carry: 0 }
];
var LAWN = flatWorld("fairway");
var POWER_STEPS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
function flight(club, speed) {
  const ball = createBall(0, BALL_R, 0);
  launchBall(ball, { speed, dirX: 1, dirZ: 0, loftDeg: club.loft, back: club.spin });
  simulate(ball, LAWN, null, { maxTime: 40 });
  return { carry: ball.landX, total: ball.x };
}
__name(flight, "flight");
function solveSpeed(club) {
  let lo = 5, hi = 120;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (flight(club, mid).carry < club.carry) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
__name(solveSpeed, "solveSpeed");
function speedAt(club, power) {
  return club.maxSpeed * Math.pow(Math.max(0, Math.min(100, power)) / 100, POWER_CURVE);
}
__name(speedAt, "speedAt");
var CLUBS = BAG.map((def) => {
  const club = { ...def };
  if (club.id === "putter") {
    club.maxSpeed = 0;
    club.table = [];
    club.total = 0;
    return club;
  }
  club.maxSpeed = solveSpeed(club);
  club.table = POWER_STEPS.map((p) => ({ power: p, ...flight(club, speedAt(club, p)) }));
  club.total = club.table[club.table.length - 1].total;
  return club;
});
var PUTTER = CLUBS[CLUBS.length - 1];
function distanceAt(club, power, speedFactor = 1) {
  const t = club.table;
  if (!t.length) return 0;
  const p = Math.max(0, Math.min(100, power * Math.pow(speedFactor, 1 / POWER_CURVE)));
  if (p <= t[0].power) return t[0].total * (p / t[0].power);
  for (let i = 1; i < t.length; i++) {
    if (p <= t[i].power) {
      const f = (p - t[i - 1].power) / (t[i].power - t[i - 1].power);
      return t[i - 1].total + (t[i].total - t[i - 1].total) * f;
    }
  }
  return t[t.length - 1].total;
}
__name(distanceAt, "distanceAt");
function powerFor(club, distance, speedFactor = 1) {
  let lo = 0, hi = 100;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (distanceAt(club, mid, speedFactor) < distance) lo = mid;
    else hi = mid;
  }
  return Math.max(4, Math.min(100, (lo + hi) / 2));
}
__name(powerFor, "powerFor");
var LIES = {
  tee: { id: "tee", name: "Tee", speedFactor: 1, spinFactor: 1, loftBonus: 0, scatterDeg: 0 },
  fairway: { id: "fairway", name: "Fairway", speedFactor: 1, spinFactor: 1, loftBonus: 0, scatterDeg: 0 },
  fringe: { id: "fringe", name: "Fringe", speedFactor: 1, spinFactor: 1, loftBonus: 0, scatterDeg: 0 },
  green: { id: "green", name: "Green", speedFactor: 1, spinFactor: 1, loftBonus: 0, scatterDeg: 0 },
  rough: { id: "rough", name: "Rough", speedFactor: 0.86, spinFactor: 0.5, loftBonus: 0, scatterDeg: 2 },
  bunker: { id: "bunker", name: "Bunker", speedFactor: 0.72, spinFactor: 0.6, loftBonus: 4, scatterDeg: 1.5 }
};
function lieFor(surface) {
  return LIES[surface] || LIES.fairway;
}
__name(lieFor, "lieFor");
function clubAllowed(club, lie, onTee) {
  if (club.id === "driver") return onTee;
  if (lie.id === "bunker") return ["iron9", "pw", "sw"].includes(club.id);
  if (lie.id === "rough") return club.id !== "wood3";
  if (club.id === "putter") return lie.id === "green" || lie.id === "fringe" || lie.id === "fairway";
  return true;
}
__name(clubAllowed, "clubAllowed");
function autoSelectClub(distance, lie, onTee) {
  if (lie.id === "green") return PUTTER;
  if (lie.id === "fringe" && distance < 12) return PUTTER;
  let longest = null;
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    const club = CLUBS[i];
    if (!clubAllowed(club, lie, onTee)) continue;
    longest = club;
    if (distanceAt(club, 100, lie.speedFactor) >= distance) return club;
  }
  return longest || CLUBS[3];
}
__name(autoSelectClub, "autoSelectClub");

// ../src/core/shotPlanner.js
var PERFECT_STRIKE = {
  grade: "pure",
  early: false,
  contact: "clean",
  yawDeg: 0,
  loftDelta: 0,
  speedFactor: 1,
  spinFactor: 1,
  sidespinAdd: 0,
  timing: 0
};
function buildLaunch({ club, power, dirX, dirZ, lie, strike = PERFECT_STRIKE, scatter = 0, slope = 0 }) {
  const yaw = (-(strike.yawDeg || 0) + scatter * lie.scatterDeg) * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    speed: speedAt(club, power) * lie.speedFactor * strike.speedFactor,
    dirX: dirX * c - dirZ * s,
    dirZ: dirX * s + dirZ * c,
    // Always launch clear of the slope in front of the ball
    loftDeg: Math.max(4, club.loft + lie.loftBonus + strike.loftDelta, Math.atan(slope) * 180 / Math.PI + 9),
    back: club.spin * lie.spinFactor * strike.spinFactor,
    // Early = closed face = draws left
    side: -(strike.sidespinAdd || 0)
  };
}
__name(buildLaunch, "buildLaunch");
function slopeAlong(world, ball, dirX, dirZ) {
  const g = [0, 0];
  world.gradAt(ball.x, ball.z, g);
  const ahead = (world.heightAt(ball.x + dirX * 1.5, ball.z + dirZ * 1.5) - world.heightAt(ball.x, ball.z)) / 1.5;
  return Math.max(g[0] * dirX + g[1] * dirZ, ahead);
}
__name(slopeAlong, "slopeAlong");

// ../src/core/swing.js
var SWING = {
  POWER_SPEED: 72,
  // marker units/s on the way up (0 -> 100 in ~1.4s)
  ACCURACY_SPEED: 95,
  // marker units/s at the top of the return sweep...
  EASE: 0.5,
  // ...slowing to this fraction as it nears the line
  TOP_HOLD: 0.5,
  // seconds the marker rests at 100 before the return sweep
  LINE: 8,
  // strike line value on the return sweep
  WINDOW: 45,
  // units of marker travel mapped to timing -1..+1
  FLOOR: 8 - 45,
  // = -37: the marker stops here and waits for the tap
  LATE_CAP: 0.65,
  // a tap after the marker has stopped is this late, no worse
  // Grade thresholds on |timing| (0..1). Pure is still a skill window (~±65ms).
  PURE_MAX: 0.14,
  GOOD_MAX: 0.4,
  POOR_MAX: 0.7
};
function strikeFromTiming(timing, loft, rng) {
  const t = Math.max(-1, Math.min(1, timing));
  const at = Math.abs(t);
  const early = t > 0;
  const grade = at <= SWING.PURE_MAX ? "pure" : at <= SWING.GOOD_MAX ? "good" : at <= SWING.POOR_MAX ? "poor" : "terrible";
  const maxYawDeg = Math.max(5, 17.5 - 0.25 * loft);
  const strike = {
    timing: t,
    grade,
    early,
    contact: "clean",
    yawDeg: 0,
    // aim rotation at address (+ = left/pull, - = right/push)
    loftDelta: 0,
    // launch loft adjustment
    speedFactor: 1,
    // ball speed multiplier
    spinFactor: 1,
    // backspin multiplier
    sidespinAdd: 0
    // free curve added on top of the player's spin selection
  };
  if (grade === "pure") return strike;
  if (grade === "good") {
    strike.yawDeg = t * maxYawDeg * 0.55;
    strike.speedFactor = 1 - 0.1 * at;
    strike.sidespinAdd = t * 0.9;
    return strike;
  }
  const thinChance = early ? 0.65 : 0.35;
  strike.contact = (rng ? rng() : 0.5) < thinChance ? "thin" : "fat";
  if (strike.contact === "thin") {
    strike.yawDeg = t * maxYawDeg;
    strike.loftDelta = -7;
    strike.speedFactor = 1 - (0.22 + 0.45 * at);
    strike.spinFactor = 0.45;
    strike.sidespinAdd = t * 1.3;
  } else {
    strike.yawDeg = t * maxYawDeg * 0.7;
    strike.loftDelta = 9;
    strike.speedFactor = 1 - (0.3 + 0.5 * at);
    strike.spinFactor = 1.6;
    strike.sidespinAdd = t * 0.9;
  }
  return strike;
}
__name(strikeFromTiming, "strikeFromTiming");

// ../node_modules/simplex-noise/dist/esm/simplex-noise.js
var SQRT3 = /* @__PURE__ */ Math.sqrt(3);
var SQRT5 = /* @__PURE__ */ Math.sqrt(5);
var F2 = 0.5 * (SQRT3 - 1);
var G2 = (3 - SQRT3) / 6;
var F3 = 1 / 3;
var G3 = 1 / 6;
var F4 = (SQRT5 - 1) / 4;
var G4 = (5 - SQRT5) / 20;
var fastFloor = /* @__PURE__ */ __name((x) => Math.floor(x) | 0, "fastFloor");
var grad2 = /* @__PURE__ */ new Float64Array([
  1,
  1,
  -1,
  1,
  1,
  -1,
  -1,
  -1,
  1,
  0,
  -1,
  0,
  1,
  0,
  -1,
  0,
  0,
  1,
  0,
  -1,
  0,
  1,
  0,
  -1
]);
function createNoise2D(random = Math.random) {
  const perm = buildPermutationTable(random);
  const permGrad2x = new Float64Array(perm).map((v) => grad2[v % 12 * 2]);
  const permGrad2y = new Float64Array(perm).map((v) => grad2[v % 12 * 2 + 1]);
  return /* @__PURE__ */ __name(function noise2D(x, y) {
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    const s = (x + y) * F2;
    const i = fastFloor(x + s);
    const j = fastFloor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = ii + perm[jj];
      const g0x = permGrad2x[gi0];
      const g0y = permGrad2y[gi0];
      t0 *= t0;
      n0 = t0 * t0 * (g0x * x0 + g0y * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = ii + i1 + perm[jj + j1];
      const g1x = permGrad2x[gi1];
      const g1y = permGrad2y[gi1];
      t1 *= t1;
      n1 = t1 * t1 * (g1x * x1 + g1y * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = ii + 1 + perm[jj + 1];
      const g2x = permGrad2x[gi2];
      const g2y = permGrad2y[gi2];
      t2 *= t2;
      n2 = t2 * t2 * (g2x * x2 + g2y * y2);
    }
    return 70 * (n0 + n1 + n2);
  }, "noise2D");
}
__name(createNoise2D, "createNoise2D");
function buildPermutationTable(random) {
  const tableSize = 512;
  const p = new Uint8Array(tableSize);
  for (let i = 0; i < tableSize / 2; i++) {
    p[i] = i;
  }
  for (let i = 0; i < tableSize / 2 - 1; i++) {
    const r = i + ~~(random() * (256 - i));
    const aux = p[i];
    p[i] = p[r];
    p[r] = aux;
  }
  for (let i = 256; i < tableSize; i++) {
    p[i] = p[i - 256];
  }
  return p;
}
__name(buildPermutationTable, "buildPermutationTable");

// ../src/core/rng.js
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  h = Math.imul(h ^ h >>> 16, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
__name(hashSeed, "hashSeed");
function mulberry32(seed) {
  let a = seed >>> 0;
  return /* @__PURE__ */ __name(function rng() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }, "rng");
}
__name(mulberry32, "mulberry32");
function createGameRng(seedString) {
  const seed = hashSeed(String(seedString));
  const rng = mulberry32(seed);
  return {
    seed: String(seedString),
    rng,
    // float in [0, 1)
    range: /* @__PURE__ */ __name((min, max) => min + rng() * (max - min), "range"),
    int: /* @__PURE__ */ __name((min, maxInclusive) => Math.floor(min + rng() * (maxInclusive - min + 1)), "int"),
    pick: /* @__PURE__ */ __name((arr) => arr[Math.floor(rng() * arr.length)], "pick"),
    sign: /* @__PURE__ */ __name(() => rng() < 0.5 ? -1 : 1, "sign"),
    noise2D: createNoise2D(rng),
    fork: /* @__PURE__ */ __name((label) => createGameRng(`${seedString}:${label}`), "fork")
  };
}
__name(createGameRng, "createGameRng");

// ../src/course/biomes.js
var BIOMES = {
  parkland: {
    id: "parkland",
    name: "Parkland",
    // Terrain shape
    base: 1.6,
    amp1: 1.5,
    amp2: 0.35,
    greenUndulation: 0.16,
    // Ground palette
    rough: 4885050,
    fairway: 8111442,
    fringe: 9425758,
    green: 11134575,
    tee: 9689186,
    sand: 15785642,
    bed: 4025178,
    deepRough: 4027956,
    // Air: daytime haze tint and how strongly it takes, high-cloud cover
    // range, and the colour the ground throws back up into the shadows
    haze: 13625077,
    hazeAmount: 0,
    cloud: [0.3, 0.55],
    hemiGround: 8824922,
    water: 3972292,
    liquid: "water",
    // Scenery
    treeKind: "round",
    treeShape: "round",
    treeCount: 70,
    canopy: [4160052, 5148474, 6136644, 7051838, 4688961],
    trunk: 7031343,
    tuft: 5214525,
    flowers: [16777215, 16767050, 16748451],
    props: [["bush", 46], ["fence", 9], ["rock", 14]],
    features: [["cottage", 2], ["windmill", 1], ["haystack", 5], ["tent", 1]],
    backdrop: { style: "hills", color: 8367738, height: [28, 80] },
    landmarks: ["village"],
    ambient: ["pollen", [16776160]],
    // Weather (mph)
    wind: [0, 6]
  },
  links: {
    id: "links",
    name: "Links",
    base: 1.4,
    amp1: 1,
    amp2: 0.85,
    greenUndulation: 0.22,
    rough: 12100954,
    fairway: 9420629,
    fringe: 10473570,
    green: 11723380,
    tee: 10473570,
    sand: 16181176,
    bed: 4882310,
    deepRough: 10521672,
    haze: 15328982,
    hazeAmount: 0.75,
    cloud: [0.45, 0.7],
    hemiGround: 11905128,
    water: 3116974,
    liquid: "water",
    treeKind: "scrub",
    treeShape: "scrub",
    treeCount: 16,
    canopy: [7311170, 8231493, 6258490],
    trunk: 7821370,
    tuft: 12758626,
    tufts: 0.6,
    flowers: [15917978, 14272511, 16777215],
    props: [["marram", 70], ["rock", 22], ["fence", 6]],
    features: [["standingStones", 2], ["beachHut", 4], ["boat", 2]],
    backdrop: { style: "dunes", color: 11123082, height: [14, 34] },
    landmarks: ["lighthouse", "seaStacks"],
    ambient: null,
    wind: [6, 14]
  },
  pines: {
    id: "pines",
    name: "Pines",
    base: 1.9,
    amp1: 2.2,
    amp2: 0.4,
    greenUndulation: 0.19,
    rough: 4160064,
    fairway: 7321168,
    fringe: 8571227,
    green: 10477162,
    tee: 8834142,
    sand: 15915424,
    bed: 3496298,
    deepRough: 3368502,
    haze: 12770012,
    hazeAmount: 0.6,
    cloud: [0.2, 0.45],
    hemiGround: 9083488,
    water: 3833776,
    liquid: "water",
    treeKind: "pine",
    treeShape: "pine",
    treeCount: 110,
    canopy: [3107642, 2776888, 3832388, 2383936],
    trunk: 6045744,
    tuft: 4160064,
    flowers: [16757575, 16777215, 16744302],
    props: [["boulder", 26], ["logPile", 9], ["fern", 40]],
    features: [["cabin", 2], ["watchtower", 1], ["tent", 3]],
    backdrop: { style: "peaks", color: 6258566, cap: 16054527, capAt: 0.62, height: [70, 170] },
    landmarks: ["greatPeak"],
    ambient: null,
    wind: [2, 9]
  },
  desert: {
    id: "desert",
    name: "Dry Gulch",
    base: 1.7,
    amp1: 1.8,
    amp2: 0.7,
    greenUndulation: 0.18,
    rough: 14263132,
    fairway: 9225298,
    fringe: 10670688,
    green: 11986290,
    tee: 10670688,
    sand: 16773314,
    bed: 5212800,
    deepRough: 13206596,
    haze: 15849128,
    hazeAmount: 0.8,
    cloud: [0.05, 0.25],
    hemiGround: 14264424,
    water: 3715248,
    liquid: "water",
    treeKind: "cactus",
    treeShape: "scrub",
    treeCount: 34,
    canopy: [5214026, 5937744, 4554568],
    trunk: 8018490,
    tuft: 11049554,
    tufts: 0.3,
    flowers: [16736138, 16767050, 16751164],
    props: [["redRock", 30], ["barrelCactus", 30], ["bones", 6], ["deadBush", 26]],
    features: [["rockArch", 2], ["wagon", 2], ["oilRig", 1], ["hoodoo", 5]],
    backdrop: { style: "mesas", color: 13135932, cap: 14719576, capAt: 0.55, height: [50, 120] },
    landmarks: ["pyramids"],
    ambient: ["dust", [15914656]],
    wind: [3, 11]
  },
  tropics: {
    id: "tropics",
    name: "Coconut Cove",
    base: 1.2,
    amp1: 1.1,
    amp2: 0.35,
    greenUndulation: 0.17,
    rough: 4171338,
    fairway: 8377946,
    fringe: 9691238,
    green: 11464312,
    tee: 9691238,
    sand: 16774876,
    bed: 3843744,
    deepRough: 15916974,
    haze: 13168880,
    hazeAmount: 0.6,
    cloud: [0.25, 0.5],
    hemiGround: 12571274,
    water: 2081992,
    liquid: "water",
    treeKind: "palm",
    treeShape: "round",
    treeCount: 46,
    canopy: [4168252, 5221954, 3115578],
    trunk: 10123858,
    tuft: 4829266,
    tufts: 0.6,
    flowers: [16732026, 16756782, 16777215, 11558143],
    props: [["shell", 18], ["hibiscus", 40], ["surfboard", 8], ["rock", 12]],
    features: [["tiki", 4], ["parasol", 6], ["beachHut", 3], ["boat", 2]],
    backdrop: { style: "islands", color: 5220464, height: [30, 90] },
    landmarks: ["islandVolcano"],
    ambient: null,
    wind: [3, 9]
  },
  snow: {
    id: "snow",
    name: "Frostbite Ridge",
    base: 1.8,
    amp1: 2,
    amp2: 0.45,
    greenUndulation: 0.17,
    rough: 15331831,
    fairway: 8372362,
    fringe: 9686936,
    green: 10936482,
    tee: 9686936,
    sand: 15257494,
    bed: 4882336,
    deepRough: 13951726,
    haze: 15003382,
    hazeAmount: 0.85,
    cloud: [0.5, 0.75],
    hemiGround: 14214384,
    water: 8374504,
    liquid: "water",
    treeKind: "snowPine",
    treeShape: "pine",
    treeCount: 80,
    canopy: [3106386, 2775628, 3830368],
    trunk: 5915702,
    tuft: 16186367,
    tufts: 0.3,
    flowers: [16777215, 13625599, 15223370],
    props: [["snowman", 9], ["iceShard", 26], ["snowRock", 26], ["present", 8]],
    features: [["igloo", 3], ["cabin", 2], ["iceArch", 2]],
    backdrop: { style: "peaks", color: 10335432, cap: 16777215, capAt: 0.3, height: [70, 180] },
    landmarks: ["iceCastle"],
    ambient: ["snow", [16777215]],
    wind: [4, 12]
  },
  autumn: {
    id: "autumn",
    name: "Maple Hollow",
    base: 1.7,
    amp1: 1.7,
    amp2: 0.4,
    greenUndulation: 0.17,
    rough: 9407036,
    fairway: 8831056,
    fringe: 10014556,
    green: 11330156,
    tee: 10014556,
    sand: 15784352,
    bed: 4876890,
    deepRough: 11038766,
    haze: 15916224,
    hazeAmount: 0.7,
    cloud: [0.3, 0.6],
    hemiGround: 11897418,
    water: 4886440,
    liquid: "water",
    treeKind: "round",
    treeShape: "round",
    treeCount: 84,
    canopy: [15235370, 14239786, 15905338, 12071978, 15243818, 10127918],
    trunk: 5191206,
    tuft: 12096058,
    flowers: [15905338, 14239786, 16773312],
    props: [["pumpkin", 34], ["leafPile", 24], ["toadstool", 22], ["fence", 8]],
    features: [["barn", 1], ["haystack", 7], ["scarecrow", 4], ["cottage", 1], ["tent", 1]],
    backdrop: { style: "hills", color: 12614202, height: [30, 90] },
    landmarks: ["greatTree"],
    ambient: ["leaves", [15235370, 14239786, 15905338]],
    wind: [2, 8]
  },
  blossom: {
    id: "blossom",
    name: "Blossom Garden",
    base: 1.4,
    amp1: 1.3,
    amp2: 0.3,
    greenUndulation: 0.15,
    rough: 5937746,
    fairway: 9097832,
    fringe: 10280052,
    green: 11857028,
    tee: 10280052,
    sand: 16050896,
    bed: 4881016,
    deepRough: 4885078,
    haze: 16179176,
    hazeAmount: 0.7,
    cloud: [0.2, 0.5],
    hemiGround: 11583632,
    water: 4892856,
    liquid: "water",
    treeKind: "blossom",
    treeShape: "round",
    treeCount: 62,
    canopy: [16758736, 16751808, 16765152, 16089772, 16777215],
    trunk: 3942954,
    tuft: 6465114,
    tufts: 0.6,
    flowers: [16758736, 16777215, 16744360],
    props: [["bamboo", 30], ["mossRock", 24], ["lantern", 16]],
    features: [["torii", 3], ["teaHouse", 2], ["archBridge", 2]],
    backdrop: { style: "hills", color: 8038544, height: [24, 60] },
    landmarks: ["snowCone", "pagoda"],
    ambient: ["petals", [16762072, 16777215, 16751808]],
    wind: [0, 5]
  },
  volcano: {
    id: "volcano",
    name: "Cinder Peak",
    base: 2,
    amp1: 2.4,
    amp2: 0.65,
    greenUndulation: 0.2,
    rough: 4866630,
    fairway: 6270540,
    fringe: 7651416,
    green: 9624678,
    tee: 7651416,
    sand: 11049616,
    bed: 5904904,
    deepRough: 3025456,
    haze: 9071206,
    hazeAmount: 0.85,
    cloud: [0.5, 0.8],
    hemiGround: 8014394,
    water: 16738836,
    liquid: "lava",
    treeKind: "charred",
    treeShape: "scrub",
    treeCount: 40,
    canopy: [2761766, 3418154, 2235938],
    trunk: 2761252,
    tuft: 5917252,
    tufts: 0.3,
    flowers: [16742942, 16761402, 15219226],
    props: [["obsidian", 40], ["vent", 12], ["basalt", 30], ["bones", 6]],
    features: [["lavaPool", 5], ["skullRock", 2], ["ruin", 3]],
    backdrop: { style: "peaks", color: 3813428, cap: 16734740, capAt: 0.86, capGlow: true, height: [60, 150] },
    landmarks: ["eruption", "fortress"],
    ambient: ["embers", [16747050, 16761418, 16730650]],
    wind: [1, 7]
  },
  toadstool: {
    id: "toadstool",
    name: "Toadstool Glen",
    base: 1.7,
    amp1: 1.8,
    amp2: 0.5,
    greenUndulation: 0.18,
    rough: 4164210,
    fairway: 8376442,
    fringe: 9624712,
    green: 11202710,
    tee: 9624712,
    sand: 15917764,
    bed: 3824266,
    deepRough: 3107434,
    haze: 14209268,
    hazeAmount: 0.7,
    cloud: [0.3, 0.55],
    hemiGround: 8038554,
    water: 5933800,
    liquid: "water",
    treeKind: "mushroom",
    treeShape: "round",
    treeCount: 52,
    canopy: [15221306, 15899178, 10115816, 3844328, 15227560],
    trunk: 15919832,
    tuft: 4889216,
    tufts: 0.6,
    flowers: [12884735, 8055039, 16773754],
    props: [["toadstool", 60], ["crystal", 26], ["mossRock", 18], ["fern", 30]],
    features: [["shroomHouse", 4], ["crystalCluster", 3], ["stoneRing", 1]],
    backdrop: { style: "shrooms", color: 5933722, height: [50, 130] },
    landmarks: ["giantShroom"],
    ambient: ["spores", [13168895, 15780095, 16774832]],
    wind: [0, 5]
  }
};
var BIOME_IDS = Object.keys(BIOMES);
var WORLDS_PER_ROUND = 6;
function courseBiomes(seedString) {
  const rng = mulberry32(hashSeed(`${seedString}:worlds`));
  const pool = [...BIOME_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const WELCOMING = ["parkland", "tropics", "blossom", "autumn", "toadstool"];
  const first = pool.findIndex((id) => WELCOMING.includes(id));
  if (first > 0) [pool[0], pool[first]] = [pool[first], pool[0]];
  return pool.slice(0, WORLDS_PER_ROUND);
}
__name(courseBiomes, "courseBiomes");
function biomeForHole(seedString, number) {
  return courseBiomes(seedString)[Math.floor((number - 1) % 18 / 3)];
}
__name(biomeForHole, "biomeForHole");

// ../src/course/shapes.js
function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
__name(smoothstep, "smoothstep");
function lerp(a, b, t) {
  return a + (b - a) * t;
}
__name(lerp, "lerp");
function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return len;
}
__name(pathLength, "pathLength");
function pointAlongPath(path, d) {
  let remaining = d;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dz = path[i].z - path[i - 1].z;
    const segLen = Math.hypot(dx, dz);
    if (remaining <= segLen || i === path.length - 1) {
      const t = segLen > 0 ? Math.max(0, Math.min(1, remaining / segLen)) : 0;
      return {
        x: path[i - 1].x + dx * t,
        z: path[i - 1].z + dz * t,
        dirX: segLen > 0 ? dx / segLen : 1,
        dirZ: segLen > 0 ? dz / segLen : 0
      };
    }
    remaining -= segLen;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, dirX: 1, dirZ: 0 };
}
__name(pointAlongPath, "pointAlongPath");
function pathInfo(path, x, z) {
  let dist = Infinity, along = 0, across = 0;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x, az = path[i - 1].z;
    const dx = path[i].x - ax, dz = path[i].z - az;
    const segLen = Math.hypot(dx, dz);
    if (segLen === 0) continue;
    const ux = dx / segLen, uz = dz / segLen;
    const px = x - ax, pz = z - az;
    const proj = Math.max(0, Math.min(segLen, px * ux + pz * uz));
    const d = Math.hypot(px - ux * proj, pz - uz * proj);
    if (d < dist) {
      dist = d;
      along = walked + proj;
      across = px * -uz + pz * ux;
    }
    walked += segLen;
  }
  return { dist, along, across };
}
__name(pathInfo, "pathInfo");
function blobRadius(shape, angle) {
  const w = shape.wobble ?? 1;
  const p = shape.phase || 0;
  const f = 1 + w * (0.26 * Math.sin(angle * 2 + p) + 0.16 * Math.sin(angle * 3 + p * 2.3) + 0.1 * Math.sin(angle * 5 + p * 0.7));
  return shape.r * Math.max(0.45, f);
}
__name(blobRadius, "blobRadius");
function blobCovers(shape, x, z, margin = 0) {
  const dx = x - shape.x, dz = z - shape.z;
  const d = Math.hypot(dx, dz);
  if (d > shape.r * 1.7 + margin) return false;
  return d < blobRadius(shape, Math.atan2(dz, dx)) + margin;
}
__name(blobCovers, "blobCovers");
var FRINGE_EDGE = 1.13;
function greenDistance(green, x, z) {
  if (green.channel) return pathInfo(green.channel.pts, x, z).dist / green.channel.w;
  const dx = x - green.x, dz = z - green.z;
  const c = Math.cos(-green.angle), s = Math.sin(-green.angle);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const size = green.size;
  const ellipse = Math.sqrt((lx / 1.35) ** 2 + lz ** 2) / size;
  const bite = Math.sqrt((lx + size * 0.25) ** 2 + (lz - size * 1.25) ** 2) / (size * 0.62);
  return Math.max(ellipse, 1 + (1 - bite) * 1.5);
}
__name(greenDistance, "greenDistance");

// ../src/core/progression.js
var clamp01 = /* @__PURE__ */ __name((v) => Math.max(0, Math.min(1, v)), "clamp01");
var lerp2 = /* @__PURE__ */ __name((a, b, t) => a + (b - a) * t, "lerp");
function holeDifficulty(number) {
  return clamp01((number - 1) / 11);
}
__name(holeDifficulty, "holeDifficulty");
function courseTuning(number) {
  const d = holeDifficulty(number);
  return {
    difficulty: d,
    wind: lerp2(0.35, 1.3, d),
    // multiplies the biome's wind
    slope: lerp2(0.6, 1.25, d),
    // green tilt and undulation
    pinNear: lerp2(0.15, 0.42, d),
    // pin distance from the middle, as a
    pinFar: lerp2(0.5, 0.8, d),
    //   fraction of the green's size
    pinEdge: lerp2(0.62, 0.84, d),
    // how close to the edge a pin may sit
    fairway: lerp2(1.12, 0.86, d)
    // fairway width
  };
}
__name(courseTuning, "courseTuning");

// ../src/course/holeDesigner.js
var TILE_HALF = 240;
var PLAY_HALF = 228;
var FEATURE_BOUND = 205;
var PAR_BANDS = { 3: [100, 165], 4: [250, 330], 5: [425, 475] };
var ROUND_PLAN = [
  { par: 4, archetypes: ["skiJump"], gimmick: "rings" },
  // 1  downhill, confidence
  { par: 3, archetypes: ["minigolf"] },
  // 2  putting, the walls
  { par: 4, archetypes: ["doglegR", "doglegL"] },
  // 3  cut the corner over water?
  { par: 5, archetypes: ["halfpipe"], gimmick: "boing" },
  // 4  long, forgiving sides
  { par: 3, archetypes: ["lookout"] },
  // 5  cliff-top, judge the drop
  { par: 4, archetypes: ["lakeside"], gimmick: "rings" },
  // 6  water down one side
  { par: 4, archetypes: ["bottleneck"] },
  // 7  thread the gate
  { par: 5, archetypes: ["terraces"] },
  // 8  land on a shelf
  { par: 4, archetypes: ["hogsback"], gimmick: "bullseye" },
  // 9  hold the ridge
  { par: 4, archetypes: ["dunes"] },
  // 10 bunkers all the way home
  { par: 4, archetypes: ["doglegL", "doglegR"], gimmick: "boing" },
  // 11 the other dogleg
  { par: 5, archetypes: ["cape"] },
  // 12 bite off the lake
  { par: 4, archetypes: ["gorge"] },
  // 13 carry the creek, or lay up
  { par: 3, archetypes: ["potBunkers", "overWater"], gimmick: "bullseye" },
  // 14 a tiny target
  { par: 5, archetypes: ["doubleDogleg"], gimmick: "rings" },
  // 15 two turns
  { par: 4, archetypes: ["ascent", "waterApproach"] },
  // 16 uphill, or the moat
  { par: 3, archetypes: ["islandGreen"] },
  // 17 all carry
  { par: 4, archetypes: ["punchbowl", "minigolf"] }
  // 18 a feed to the flag, or putt-putt (par 4 bowl)
];
function roundHoles(length) {
  if (length >= 18) return ROUND_PLAN.map((_, i) => i + 1);
  if (length === 9) return [1, 2, 3, 4, 5, 6, 12, 13, 17];
  return [1, 2, 17].slice(0, length);
}
__name(roundHoles, "roundHoles");
function layoutHole(rng, plan) {
  const { par, archetype } = plan;
  const biome = BIOMES[plan.biome];
  const band = PAR_BANDS[par];
  const tune = courseTuning(plan.number);
  let totalLen = rng.range(band[0], band[1]);
  if (archetype === "islandGreen") totalLen = rng.range(100, 125);
  if (archetype === "potBunkers") totalLen = rng.range(95, 120);
  if (archetype === "overWater") totalLen = rng.range(120, 150);
  if (archetype === "lookout") totalLen = rng.range(135, 160);
  if (archetype === "punchbowl") totalLen = rng.range(125, 150);
  if (archetype === "ascent") totalLen = rng.range(255, 285);
  const mini = archetype === "minigolf";
  const tee = { x: 0, z: 0 };
  const at = /* @__PURE__ */ __name((len, ang, from = tee) => ({ x: from.x + Math.cos(ang) * len, z: from.z + Math.sin(ang) * len }), "at");
  const rad = /* @__PURE__ */ __name((deg) => deg * Math.PI / 180, "rad");
  let path;
  let dogleg = null;
  if (mini) {
    const s = rng.sign(), a = rng.range(16, 20), b = rng.range(11, 15), c = rng.range(14, 18);
    const kink = rng.range(-3, 3);
    path = [tee, { x: a, z: 0 }, { x: a + 10, z: s * b }, { x: a + 10 + c, z: s * (b + kink) }, { x: a + 18 + c, z: s * 2.5 }];
  } else if (archetype === "doglegL" || archetype === "doglegR" || archetype === "cape") {
    const side = archetype === "doglegL" ? 1 : archetype === "doglegR" ? -1 : rng.sign();
    const angle = rad(rng.range(26, 44)) * side;
    const l1 = totalLen * rng.range(0.56, 0.64);
    const corner = at(l1, 0);
    path = [tee, corner, at(totalLen - l1, angle, corner)];
    dogleg = { corner, side, l1 };
  } else if (archetype === "doubleDogleg") {
    const side = rng.sign();
    const a1 = rad(rng.range(34, 42)) * side;
    const l1 = totalLen * 0.42, l2 = totalLen * 0.3;
    const c1 = at(l1, 0);
    const c2 = at(l2, a1, c1);
    path = [tee, c1, c2, at(totalLen - l1 - l2, a1 * -0.55, c2)];
    dogleg = { corner: c1, side, l1 };
  } else if (par > 3) {
    const mid = { x: totalLen * 0.5, z: rng.range(-9, 9) };
    path = [tee, mid, { x: totalLen, z: 0 }];
  } else {
    path = [tee, { x: totalLen, z: 0 }];
  }
  totalLen = pathLength(path);
  const greenPt = path[path.length - 1];
  const prev = path[path.length - 2];
  const green = {
    x: greenPt.x,
    z: greenPt.z,
    size: archetype === "potBunkers" ? 11.5 : par === 3 ? rng.range(13, 15) : rng.range(14, 16.5),
    angle: Math.atan2(greenPt.z - prev.z, greenPt.x - prev.x),
    elev: archetype === "elevatedGreen" ? rng.range(1.8, 2.8) : 0,
    tiltAngle: rng.range(0, Math.PI * 2),
    tilt: rng.range(8e-3, 0.024) * tune.slope,
    undulation: biome.greenUndulation * rng.range(0.8, 1.25) * tune.slope
  };
  if (mini) {
    const cx2 = path.reduce((t, p) => t + p.x, 0) / path.length, cz2 = path.reduce((t, p) => t + p.z, 0) / path.length;
    const reach = Math.max(...path.map((p) => Math.hypot(p.x - cx2, p.z - cz2)));
    Object.assign(green, { x: cx2, z: cz2, size: (reach + 9) / 1.75, angle: 0, tilt: 4e-3, undulation: 0, channel: { pts: path, w: 3.4, half: 2.5 } });
  }
  const fairwayHalf = (par === 5 ? 12 : 13) * tune.fairway;
  let fairwayStart = mini ? totalLen + 99 : par === 3 ? totalLen - green.size * 2.4 : rng.range(28, 40);
  const bunkers = [];
  const water = [];
  const trees = [];
  const offPath = /* @__PURE__ */ __name((along, across) => {
    const p = pointAlongPath(path, along);
    return { x: p.x - p.dirZ * across, z: p.z + p.dirX * across };
  }, "offPath");
  const addBunker = /* @__PURE__ */ __name((along, across, r, depth = 0.5) => {
    bunkers.push({ ...offPath(along, across), r, depth, phase: rng.range(0, 6.28), wobble: 0.9 });
  }, "addBunker");
  const addPond = /* @__PURE__ */ __name((center, r, wobble = 1) => {
    water.push({ x: center.x, z: center.z, r, wobble, phase: rng.range(0, 6.28) });
  }, "addPond");
  const greenside = /* @__PURE__ */ __name(() => {
    if (rng.rng() < 0.75) addBunker(totalLen - rng.range(2, 8), rng.sign() * (green.size + 5), rng.range(4.5, 6));
  }, "greenside");
  let shape = null;
  switch (archetype) {
    case "lookout":
      shape = { kind: "drop", h: rng.range(13, 17) };
      greenside();
      greenside();
      break;
    case "skiJump":
      shape = { kind: "drop", h: rng.range(10, 13) };
      addBunker(totalLen * 0.72, rng.sign() * (fairwayHalf + 5), rng.range(6, 8));
      greenside();
      break;
    case "ascent":
      shape = { kind: "climb", h: rng.range(7, 9.5) };
      addBunker(totalLen * 0.6, rng.sign() * (fairwayHalf + 5), rng.range(6, 7));
      greenside();
      break;
    case "halfpipe":
      shape = { kind: "halfpipe", h: rng.range(3, 3.8) };
      greenside();
      break;
    case "hogsback":
      shape = { kind: "hogsback", h: rng.range(2, 2.6) };
      addBunker(totalLen * 0.66, fairwayHalf + 9, rng.range(6, 8));
      addBunker(totalLen * 0.7, -(fairwayHalf + 9), rng.range(6, 8));
      break;
    case "terraces":
      shape = { kind: "terraces", h: rng.range(9, 11), steps: 3 };
      greenside();
      break;
    case "gorge": {
      shape = { kind: "gorge", h: rng.range(4, 5), at: rng.range(0.6, 0.66), w: rng.range(20, 24) };
      const at2 = shape.at * totalLen;
      for (const across of [-fairwayHalf - 6, 0, fairwayHalf + 6]) addPond(offPath(at2, across), 9.5, 0.55);
      greenside();
      break;
    }
    case "punchbowl":
      shape = { kind: "punchbowl", h: rng.range(2.4, 3) };
      break;
    case "minigolf":
      shape = { kind: "channel", hump: rng.range(0.35, 0.5), at: rng.range(0.42, 0.58) };
      break;
    default:
      break;
  }
  switch (archetype) {
    case "straight": {
      addBunker(totalLen * 0.64, fairwayHalf + 6, rng.range(6, 8));
      addBunker(totalLen * 0.7, -(fairwayHalf + 6), rng.range(6, 8));
      greenside();
      break;
    }
    case "doglegL":
    case "doglegR": {
      addBunker(dogleg.l1 + 10, -dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      addBunker(totalLen - 6, dogleg.side * (green.size + 5), rng.range(5, 6));
      const r = rng.range(17, 22);
      addPond(offPath(dogleg.l1 - 6, dogleg.side * (fairwayHalf + 6 + r)), r, 0.75);
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) {
        const along = dogleg.l1 + rng.range(-10, 14);
        const across = dogleg.side * (fairwayHalf + 2 * r + rng.range(8, 22));
        trees.push({ ...offPath(along, across), s: rng.range(1, 1.4) });
      }
      break;
    }
    case "doubleDogleg": {
      addBunker(dogleg.l1 + 8, -dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      addBunker(totalLen * 0.72, dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      const c1 = dogleg.corner, gx = greenPt.x, gz = greenPt.z;
      const L = Math.hypot(gx - tee.x, gz - tee.z) || 1, ux = (gx - tee.x) / L, uz = (gz - tee.z) / L;
      const t = (c1.x - tee.x) * ux + (c1.z - tee.z) * uz;
      const foot = { x: tee.x + ux * t, z: tee.z + uz * t };
      const gap = Math.hypot(foot.x - c1.x, foot.z - c1.z);
      const r = Math.max(18, Math.min(30, gap * 0.6));
      addPond({ x: tee.x + ux * 232, z: tee.z + uz * 232 }, r, 0.7);
      greenside();
      break;
    }
    case "cape": {
      const r = rng.range(30, 38);
      const inside = offPath(dogleg.l1 - 8, dogleg.side * (fairwayHalf * 0.5 + r));
      addPond(inside, r, 0.7);
      addBunker(dogleg.l1 + 14, -dogleg.side * (fairwayHalf + 5), rng.range(6, 7));
      greenside();
      break;
    }
    case "overWater": {
      const r = rng.range(24, 32);
      addPond(offPath(totalLen * rng.range(0.42, 0.52), 0), r);
      fairwayStart = totalLen - green.size * 2.2;
      greenside();
      break;
    }
    case "waterApproach": {
      const r = rng.range(17, 22);
      addPond(offPath(totalLen - green.size * 1.5 - r - 6, rng.range(-6, 6)), r, 0.8);
      addBunker(totalLen + 2, rng.sign() * (green.size + 5), rng.range(5, 6));
      break;
    }
    case "lakeside": {
      const side = rng.sign();
      const r = rng.range(30, 40);
      addPond(offPath(totalLen * rng.range(0.55, 0.68), side * (fairwayHalf * 0.55 + r)), r, 0.8);
      addBunker(totalLen * 0.62, -side * (fairwayHalf + 6), rng.range(6, 8));
      greenside();
      break;
    }
    case "bottleneck": {
      const gateAlong = totalLen * rng.range(0.56, 0.64);
      const gap = rng.range(11, 13);
      for (const side of [1, -1]) {
        for (let i = 0; i < 4; i++) {
          const along = gateAlong - 16 + i * 10 + rng.range(-2, 2);
          trees.push({ ...offPath(along, side * (gap + 4.5 + rng.range(0, 3))), s: rng.range(1.1, 1.4) });
          trees.push({ ...offPath(along + 4, side * (gap + 14 + rng.range(0, 8))), s: rng.range(1, 1.4) });
        }
      }
      addBunker(totalLen * 0.84, rng.sign() * (fairwayHalf + 5), rng.range(5, 7));
      greenside();
      break;
    }
    case "elevatedGreen": {
      addBunker(totalLen - 4, green.size + 5, rng.range(5, 6), 0.7);
      addBunker(totalLen - 4, -(green.size + 5), rng.range(5, 6), 0.7);
      if (par > 3) addBunker(totalLen * 0.66, rng.sign() * (fairwayHalf + 6), rng.range(6, 8));
      break;
    }
    case "potBunkers": {
      const n = 5;
      const start = rng.range(0, 6.28);
      for (let i = 0; i < n; i++) {
        const a = start + i / n * Math.PI * 2 + rng.range(-0.25, 0.25);
        bunkers.push({
          x: green.x + Math.cos(a) * (green.size * 1.32 + 3),
          z: green.z + Math.sin(a) * (green.size * 1.2 + 3),
          r: rng.range(3.2, 4.2),
          depth: 0.95,
          phase: rng.range(0, 6.28),
          wobble: 0.5
        });
      }
      break;
    }
    case "dunes": {
      let side = rng.sign();
      for (let f = 0.34; f < 0.9; f += rng.range(0.13, 0.18)) {
        addBunker(totalLen * f, side * (fairwayHalf + rng.range(3, 7)), rng.range(5, 7.5), 0.7);
        side = -side;
      }
      greenside();
      break;
    }
    case "islandGreen": {
      addPond({ x: green.x, z: green.z }, green.size * 2.7, 0.3);
      fairwayStart = totalLen;
      break;
    }
  }
  let fishing = null;
  if (!water.length && par > 3 && rng.rng() < 0.85) {
    const side = rng.sign();
    const r = rng.range(9, 12);
    const spot = offPath(totalLen * rng.range(0.3, 0.62), side * (fairwayHalf + 10 + r));
    const pond = { x: spot.x, z: spot.z, r, wobble: 0.8, phase: rng.range(0, 6.28), fishing: true };
    if (!bunkers.some((b) => Math.hypot(b.x - pond.x, b.z - pond.z) < b.r + r + 4)) {
      water.push(pond);
      fishing = { x: pond.x, z: pond.z, r, side };
    }
  }
  let pin = { x: green.x, z: green.z };
  if (mini) pin = { ...pointAlongPath(path, totalLen - 2) };
  for (let i = 0; i < (mini ? 0 : 30); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(tune.pinNear, tune.pinFar) * green.size;
    const c = { x: green.x + Math.cos(a) * d, z: green.z + Math.sin(a) * d };
    if (greenDistance(green, c.x, c.z) < tune.pinEdge) {
      pin = c;
      break;
    }
  }
  const blocked = /* @__PURE__ */ __name((x, z, pad) => Math.hypot(x - tee.x, z - tee.z) < 16 + pad || greenDistance(green, x, z) < 1.55 + pad / green.size || water.some((w) => blobCovers(w, x, z, 5 + pad)) || bunkers.some((b) => blobCovers(b, x, z, 4 + pad)), "blocked");
  for (let i = trees.length - 1; i >= 0; i--) {
    if (blocked(trees[i].x, trees[i].z, 0)) trees.splice(i, 1);
  }
  const corridor = fairwayHalf + 10;
  const span = totalLen * 0.5 + 95;
  const cx = (tee.x + greenPt.x) / 2, cz = (tee.z + greenPt.z) / 2;
  for (let i = 0; i < biome.treeCount * 5 && trees.length < biome.treeCount; i++) {
    const x = cx + rng.range(-span, span);
    const z = cz + rng.range(-span, span);
    const info = pathInfo(path, x, z);
    if (info.dist < corridor || info.dist > 120) continue;
    if (blocked(x, z, 2)) continue;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < 8)) continue;
    trees.push({ x, z, s: rng.range(0.8, 1.35) });
  }
  const theta = rng.range(0, Math.PI * 2);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const rot = /* @__PURE__ */ __name((p) => {
    const x = p.x * cosT - p.z * sinT, z = p.x * sinT + p.z * cosT;
    p.x = x;
    p.z = z;
  }, "rot");
  const pathPts = path.map((p) => ({ ...p }));
  pathPts.forEach(rot);
  for (const p of pathPts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const ox = -(minX + maxX) / 2, oz = -(minZ + maxZ) / 2;
  const move = /* @__PURE__ */ __name((p) => {
    rot(p);
    p.x += ox;
    p.z += oz;
  }, "move");
  pathPts.forEach((p) => {
    p.x += ox;
    p.z += oz;
  });
  [green, pin, ...bunkers, ...water, ...trees].forEach(move);
  if (fishing) move(fishing);
  green.angle += theta;
  green.tiltAngle += theta;
  if (green.channel) green.channel = { ...green.channel, pts: pathPts };
  const windSpeed = Math.round(rng.range(biome.wind[0], biome.wind[1]) * tune.wind);
  const windAngle = rng.range(0, Math.PI * 2);
  const spec = {
    seed: plan.seed,
    number: plan.number,
    par,
    archetype,
    biome: biome.id,
    length: Math.round(totalLen),
    path: pathPts,
    tee: { x: pathPts[0].x, z: pathPts[0].z },
    green,
    pin,
    fairwayHalf,
    fairwayStart,
    shape,
    fishing,
    gimmick: plan.gimmick ? buildGimmick(plan.gimmick, rng, { pathPts, totalLen, fairwayHalf, green, par, water, bunkers }) : null,
    bunkers,
    water,
    trees,
    difficulty: tune.difficulty,
    wind: { speed: windSpeed, x: Math.cos(windAngle) * windSpeed, z: Math.sin(windAngle) * windSpeed }
  };
  spec.carryRequired = computeCarry(spec);
  return spec;
}
__name(layoutHole, "layoutHole");
function buildGimmick(kind, rng, { pathPts, totalLen, fairwayHalf, green, par, water, bunkers }) {
  const clear = /* @__PURE__ */ __name((p, m) => !water.some((w) => blobCovers(w, p.x, p.z, m)) && !bunkers.some((b) => blobCovers(b, p.x, p.z, m)), "clear");
  const off = /* @__PURE__ */ __name((along, across) => {
    const p = pointAlongPath(pathPts, along);
    return { x: p.x - p.dirZ * across, z: p.z + p.dirX * across };
  }, "off");
  if (kind === "bullseye") {
    for (const along of par > 3 ? [178, 168, 158, 188] : [totalLen - green.size * 2.6]) {
      const p = off(Math.min(along, totalLen - green.size * 2.4), rng.range(-3, 3));
      if (clear(p, 13)) return { kind, x: p.x, z: p.z };
    }
    return null;
  }
  if (kind === "boing") {
    const pads = [];
    const tries = [[150, fairwayHalf + 5], [172, -(fairwayHalf + 5)], [totalLen - green.size * 2.2 - 14, rng.sign() * 7], [120, -(fairwayHalf + 4)]];
    for (const [along, across] of tries) {
      if (along < 60 || along > totalLen - green.size * 1.8) continue;
      const p = off(along, across);
      if (clear(p, 6) && pads.length < 3) pads.push({ x: p.x, z: p.z, r: 2.6 });
    }
    return pads.length ? { kind, pads } : null;
  }
  return { kind };
}
__name(buildGimmick, "buildGimmick");
function computeCarry(spec) {
  if (!spec.water.length) return 0;
  const len = pathLength(spec.path);
  let maxCarry = 0, cur = 0;
  for (let d = 0; d <= len; d += 1) {
    const p = pointAlongPath(spec.path, d);
    const wet = greenDistance(spec.green, p.x, p.z) > 1.15 && spec.water.some((w) => blobCovers(w, p.x, p.z));
    cur = wet ? cur + 1 : 0;
    maxCarry = Math.max(maxCarry, cur);
  }
  return maxCarry;
}
__name(computeCarry, "computeCarry");
function evaluateFitness(spec) {
  const checks = {};
  const { green, tee, pin } = spec;
  const wetAt = /* @__PURE__ */ __name((x, z, m) => spec.water.some((w) => blobCovers(w, x, z, m)), "wetAt");
  const sandAt = /* @__PURE__ */ __name((x, z, m) => spec.bunkers.some((b) => blobCovers(b, x, z, m)), "sandAt");
  checks.inBounds = [...spec.path, ...spec.water, ...spec.bunkers].every(
    (p) => Math.abs(p.x) + (p.r || 0) <= FEATURE_BOUND && Math.abs(p.z) + (p.r || 0) <= FEATURE_BOUND
  );
  checks.teeClear = !wetAt(tee.x, tee.z, 12) && !sandAt(tee.x, tee.z, 8);
  checks.pinClear = !sandAt(pin.x, pin.z, 4);
  checks.greenDry = spec.archetype === "islandGreen" || !wetAt(green.x, green.z, green.size * 0.9);
  checks.carryOk = spec.carryRequired <= 120;
  checks.waterInPlay = !["overWater", "islandGreen"].includes(spec.archetype) || spec.carryRequired >= 18;
  if (spec.par > 3) {
    let ok = false;
    for (let d = 150; d <= 195; d += 5) {
      const p = pointAlongPath(spec.path, Math.min(d, spec.length - 30));
      if (!wetAt(p.x, p.z, 3) && !sandAt(p.x, p.z, 1)) {
        ok = true;
        break;
      }
    }
    checks.landingClear = ok;
  }
  const names = Object.keys(checks);
  const passed = names.filter((n) => checks[n]).length;
  return { checks, score: passed / names.length, pass: passed === names.length };
}
__name(evaluateFitness, "evaluateFitness");
function designHole(seedString, holeNumber, request = {}) {
  const holeRng = createGameRng(`${seedString}:design-${holeNumber}`);
  const plan = ROUND_PLAN[(holeNumber - 1) % ROUND_PLAN.length];
  const archetype = request.archetype || holeRng.pick(plan.archetypes);
  const par = request.par || plan.par;
  const biome = request.biome || biomeForHole(seedString, holeNumber);
  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = holeRng.fork(`attempt-${attempt}`);
    const spec = layoutHole(rng, { seed: seedString, number: holeNumber, par, archetype, biome, gimmick: request.gimmick ?? plan.gimmick });
    const fitness = evaluateFitness(spec);
    spec.fitness = { ...fitness, attempts: attempt + 1 };
    if (fitness.pass) return spec;
    if (!best || fitness.score > best.fitness.score) best = spec;
  }
  best.fitness.bestEffort = true;
  return best;
}
__name(designHole, "designHole");

// ../src/course/courseWorld.js
var SURFACE_IDS = ["rough", "fairway", "fringe", "green", "tee", "bunker", "water"];
var ID = Object.fromEntries(SURFACE_IDS.map((s, i) => [s, i]));
var COARSE = 2.5;
var FINE = 0.5;
var TEE_RADIUS = 4;
function buildWorld(spec) {
  const biome = BIOMES[spec.biome];
  const noise = createGameRng(`${spec.seed}:terrain-${spec.number}`).noise2D;
  const { green, path } = spec;
  const totalLen = pathLength(path);
  const low = /* @__PURE__ */ __name((x, z) => biome.base + biome.amp1 * noise(x * 6e-3, z * 6e-3), "low");
  const detail = /* @__PURE__ */ __name((x, z) => biome.amp2 * noise(x * 0.024 + 50, z * 0.024 - 50), "detail");
  const shape = spec.shape || null;
  const lift = /* @__PURE__ */ __name((info, x, z) => {
    if (!shape) return 0;
    const t = Math.max(0, Math.min(1, info.along / totalLen));
    const half = spec.fairwayHalf;
    switch (shape.kind) {
      case "drop":
        return shape.h * (1 - smoothstep(0.04, 0.6, t));
      case "climb":
        return shape.h * smoothstep(0.25, 0.95, t);
      case "halfpipe": {
        const along = smoothstep(0.08, 0.2, t) * (1 - smoothstep(0.82, 0.94, t));
        return shape.h * smoothstep(half * 0.45, half + 15, info.dist) * along;
      }
      case "hogsback": {
        const along = smoothstep(0.1, 0.25, t) * (1 - smoothstep(0.75, 0.9, t));
        return shape.h * (1 - smoothstep(half * 0.3, half + 12, info.dist)) * along;
      }
      case "terraces": {
        const n = shape.steps, f = t * n, k = Math.floor(f);
        return shape.h * (n - (k + smoothstep(0.72, 1, f - k))) / n * (1 - smoothstep(0.9, 1, t));
      }
      case "gorge": {
        const u = (info.along - shape.at * totalLen) / shape.w;
        return -shape.h * Math.exp(-u * u);
      }
      case "punchbowl": {
        const gd = greenDistance(green, x, z);
        return shape.h * smoothstep(1.15, 2.1, gd) * (1 - smoothstep(2.6, 4.2, gd));
      }
      default:
        return 0;
    }
  }, "lift");
  const infoAt = /* @__PURE__ */ __name((p) => pathInfo(path, p.x, p.z), "infoAt");
  const teeY = low(spec.tee.x, spec.tee.z) + lift(infoAt(spec.tee), spec.tee.x, spec.tee.z) + 0.4;
  const greenY = Math.max(0.6, low(green.x, green.z)) + lift(infoAt(green), green.x, green.z) + green.elev;
  const tiltX = Math.cos(green.tiltAngle) * green.tilt;
  const tiltZ = Math.sin(green.tiltAngle) * green.tilt;
  const greenBlend = 0.32 + green.elev * 0.14;
  const fairwayHalfAt = /* @__PURE__ */ __name((along) => {
    const t = along / totalLen;
    return spec.fairwayHalf * (1 + 0.18 * Math.sin(t * Math.PI * 2.3 + spec.number));
  }, "fairwayHalfAt");
  const ground = /* @__PURE__ */ __name((x, z, info) => {
    const l = low(x, z);
    const d = detail(x, z);
    const half = fairwayHalfAt(info.along);
    const w = info.along < spec.fairwayStart - 6 ? 0 : 1 - smoothstep(half, half + 14, info.dist);
    return l + d * lerp(1, 0.2, w) + lift(info, x, z);
  }, "ground");
  const ponds = spec.water.map((w) => {
    const info = pathInfo(path, w.x, w.z);
    return { ...w, level: Math.min(ground(w.x, w.z, info), low(w.x, w.z)) - 0.55 };
  });
  const bunkers = spec.bunkers.map((b) => ({ ...b }));
  const channel = green.channel;
  const lane = /* @__PURE__ */ __name((x, z) => {
    const info = pathInfo(channel.pts, x, z);
    const wall = 1 * smoothstep(channel.half, channel.half + 1.1, info.dist);
    const u = (info.along - shape.at * totalLen) / 3.2;
    return wall + shape.hump * Math.exp(-u * u) * (1 - smoothstep(channel.half * 0.6, channel.half, info.dist));
  }, "lane");
  const greenSurface = /* @__PURE__ */ __name((x, z) => greenY + tiltX * (x - green.x) + tiltZ * (z - green.z) + green.undulation * noise(x * 0.055 + 200, z * 0.055 + 200) + (channel ? lane(x, z) : 0), "greenSurface");
  const baseHeight = /* @__PURE__ */ __name((x, z) => {
    const info = pathInfo(path, x, z);
    let h = ground(x, z, info);
    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > p.r * 2.2) continue;
      const edge = blobRadius(p, Math.atan2(dz, dx));
      const bank = p.level + 0.22;
      const shore = Math.max(h, bank);
      h = lerp(shore, h, smoothstep(edge * 1.25, edge * 1.6, d));
      if (d < edge) h = lerp(p.level - 0.8, h, smoothstep(edge * 0.72, edge, d));
    }
    const teeD = Math.hypot(x - spec.tee.x, z - spec.tee.z);
    const teeOut = shape?.kind === "drop" ? 5 : 2.2;
    if (!green.channel && teeD < TEE_RADIUS * teeOut) h = lerp(teeY, h, smoothstep(TEE_RADIUS, TEE_RADIUS * teeOut, teeD));
    const gd = greenDistance(green, x, z);
    if (gd < FRINGE_EDGE + greenBlend) {
      h = lerp(greenSurface(x, z), h, smoothstep(FRINGE_EDGE, FRINGE_EDGE + greenBlend, gd));
    }
    return h;
  }, "baseHeight");
  const height = /* @__PURE__ */ __name((x, z) => {
    let h = baseHeight(x, z);
    for (const b of bunkers) {
      const dx = x - b.x, dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r * 1.7) continue;
      const edge = blobRadius(b, Math.atan2(dz, dx));
      if (d >= edge) continue;
      const keep = smoothstep(1, FRINGE_EDGE, greenDistance(green, x, z));
      const t = smoothstep(edge * 0.4, edge, d);
      h -= b.depth * (1 - t) * keep;
    }
    return h;
  }, "height");
  const surfaceType = /* @__PURE__ */ __name((x, z, h) => {
    const gd = greenDistance(green, x, z);
    if (gd < 1) return ID.green;
    if (gd < FRINGE_EDGE) return ID.fringe;
    if (Math.hypot(x - spec.tee.x, z - spec.tee.z) < TEE_RADIUS) return ID.tee;
    for (const p of ponds) if (h < p.level + 0.04 && blobCovers(p, x, z, 1)) return ID.water;
    for (const b of bunkers) if (blobCovers(b, x, z)) return ID.bunker;
    const info = pathInfo(path, x, z);
    if (info.along >= spec.fairwayStart && info.dist <= fairwayHalfAt(info.along)) return ID.fairway;
    return ID.rough;
  }, "surfaceType");
  const fineR = green.size * 1.75;
  const axis = /* @__PURE__ */ __name((center) => {
    const lo = Math.floor((center - fineR) / COARSE) * COARSE;
    const hi = Math.ceil((center + fineR) / COARSE) * COARSE;
    const out = [];
    for (let v = -TILE_HALF; v < lo - 1e-6; v += COARSE) out.push(v);
    for (let v = lo; v < hi - 1e-6; v += FINE) out.push(v);
    for (let v = hi; v <= TILE_HALF + 1e-6; v += COARSE) out.push(v);
    return Float32Array.from(out);
  }, "axis");
  const xs = axis(green.x);
  const zs = axis(green.z);
  const nx = xs.length, nz = zs.length;
  const BUCKET = FINE;
  const nBuckets = Math.ceil(TILE_HALF * 2 / BUCKET) + 1;
  const lut = /* @__PURE__ */ __name((arr) => {
    const out = new Uint16Array(nBuckets);
    let i = 0;
    for (let b = 0; b < nBuckets; b++) {
      const v = -TILE_HALF + b * BUCKET;
      while (i < arr.length - 2 && arr[i + 1] <= v + 1e-6) i++;
      out[b] = i;
    }
    return out;
  }, "lut");
  const lutX = lut(xs), lutZ = lut(zs);
  const cell = /* @__PURE__ */ __name((arr, table, v) => {
    const b = Math.max(0, Math.min(nBuckets - 1, (v + TILE_HALF) / BUCKET | 0));
    let i = table[b];
    while (i < arr.length - 2 && arr[i + 1] <= v) i++;
    return i;
  }, "cell");
  const heights = new Float32Array(nx * nz);
  const types = new Uint8Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const h = height(xs[ix], zs[iz]);
      heights[ix * nz + iz] = h;
      types[ix * nz + iz] = surfaceType(xs[ix], zs[iz], h);
    }
  }
  const clampT = /* @__PURE__ */ __name((v) => Math.max(-TILE_HALF, Math.min(TILE_HALF - 1e-3, v)), "clampT");
  const heightAt = /* @__PURE__ */ __name((x, z) => {
    x = clampT(x);
    z = clampT(z);
    const ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    const fx = (x - xs[ix]) / (xs[ix + 1] - xs[ix]);
    const fz = (z - zs[iz]) / (zs[iz + 1] - zs[iz]);
    const i = ix * nz + iz;
    const h00 = heights[i], h01 = heights[i + 1], h10 = heights[i + nz], h11 = heights[i + nz + 1];
    return (h00 * (1 - fz) + h01 * fz) * (1 - fx) + (h10 * (1 - fz) + h11 * fz) * fx;
  }, "heightAt");
  const gradAt = /* @__PURE__ */ __name((x, z, out) => {
    x = clampT(x);
    z = clampT(z);
    const ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    const dx = xs[ix + 1] - xs[ix], dz = zs[iz + 1] - zs[iz];
    const fx = (x - xs[ix]) / dx, fz = (z - zs[iz]) / dz;
    const i = ix * nz + iz;
    const h00 = heights[i], h01 = heights[i + 1], h10 = heights[i + nz], h11 = heights[i + nz + 1];
    out[0] = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / dx;
    out[1] = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / dz;
  }, "gradAt");
  const surfaceAt = /* @__PURE__ */ __name((x, z) => {
    x = clampT(x);
    z = clampT(z);
    let ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    if (x - xs[ix] > xs[ix + 1] - x) ix++;
    if (z - zs[iz] > zs[iz + 1] - z) iz++;
    return SURFACE_IDS[types[ix * nz + iz]];
  }, "surfaceAt");
  const waterLevelAt = /* @__PURE__ */ __name((x, z) => {
    let level = -Infinity;
    for (const p of ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.7 && p.level > level) level = p.level;
    }
    return level;
  }, "waterLevelAt");
  const cup = { x: spec.pin.x, z: spec.pin.z, y: heightAt(spec.pin.x, spec.pin.z), r: spec.cupR || void 0 };
  const tee = { x: spec.tee.x, z: spec.tee.z, y: heightAt(spec.tee.x, spec.tee.z) };
  const kind = biome.treeShape;
  const trees = spec.trees.map((t) => {
    const y = heightAt(t.x, t.z);
    const s = t.s;
    if (kind === "pine") {
      return { x: t.x, z: t.z, y, s, trunkR: 0.3 * s, trunkTop: y + 2.2 * s, cy: y + 5.4 * s, cr: 2.3 * s };
    }
    if (kind === "scrub") {
      return { x: t.x, z: t.z, y, s, trunkR: 0.25 * s, trunkTop: y + 1.2 * s, cy: y + 2.3 * s, cr: 1.9 * s };
    }
    return { x: t.x, z: t.z, y, s, trunkR: 0.34 * s, trunkTop: y + 3.2 * s, cy: y + 5.6 * s, cr: 2.9 * s };
  });
  return {
    spec,
    biome,
    xs,
    zs,
    nx,
    nz,
    heights,
    types,
    heightAt,
    gradAt,
    surfaceAt,
    waterLevelAt,
    cup,
    tee,
    trees,
    ponds,
    bunkers,
    half: PLAY_HALF,
    tileHalf: TILE_HALF,
    length: totalLen,
    fairwayHalfAt
  };
}
__name(buildWorld, "buildWorld");
function aimTarget(world, x, z) {
  const path = world.spec.path;
  const info = pathInfo(path, x, z);
  let walked = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ax = path[i].x - path[i - 1].x, az = path[i].z - path[i - 1].z;
    const bx = path[i + 1].x - path[i].x, bz = path[i + 1].z - path[i].z;
    walked += Math.hypot(ax, az);
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    const ahead = world.spec.green.channel ? 2.5 : 45;
    if (turn > 0.2 && walked > info.along + ahead) return { x: path[i].x, z: path[i].z, isPin: false };
  }
  return { x: world.cup.x, z: world.cup.z, isPin: true };
}
__name(aimTarget, "aimTarget");
var TEE_SLOTS = [[0, 0], [1.9, 0], [-1.9, 0], [0.95, -1.9], [-0.95, -1.9], [3.7, 0], [-3.7, 0], [2.85, -1.9]];
function teeSlot(world, i) {
  const { tee, spec } = world;
  const p = spec.path;
  const fdx = p[1].x - p[0].x, fdz = p[1].z - p[0].z, d = Math.hypot(fdx, fdz) || 1;
  const fx = fdx / d, fz = fdz / d;
  const [lat, back] = TEE_SLOTS[(i % TEE_SLOTS.length + TEE_SLOTS.length) % TEE_SLOTS.length];
  const k = spec.green.channel ? 0.45 : 1;
  return { x: tee.x - fz * lat * k - fx * back * k, z: tee.z + fx * lat * k - fz * back * k };
}
__name(teeSlot, "teeSlot");

// ../src/core/camp.js
var HAIR_STYLES = ["short", "spiky", "messy", "parted", "curly", "buzz", "bob", "bun", "long", "twintails", "ponytail"];
var EYE_SHAPES = ["round", "soft", "sharp", "sleepy", "smiley"];
var OUTFITS = [
  {
    id: "trail",
    name: "Trail Hoodie",
    top: "hoodie",
    jacket: 16182742,
    trim: 7319132,
    shirt: 7319132,
    bottoms: "shorts",
    bottomColor: 5212764,
    legs: 3881798,
    shoes: 15764028,
    hat: "none"
  },
  {
    id: "beanie",
    name: "Blue Beanie",
    top: "coat",
    jacket: 3356223,
    trim: 16183782,
    shirt: 14918700,
    collar: true,
    bottoms: "pants",
    bottomColor: 2303276,
    legs: null,
    shoes: 9056058,
    hat: "pom",
    hatColor: 4024496,
    scarf: 15918792,
    goal: ["rounds", 1],
    how: "Finish a round"
  },
  {
    id: "ranger",
    name: "Ranger",
    top: "vest",
    jacket: 12165738,
    trim: 7035444,
    shirt: 6262618,
    bottoms: "shorts",
    bottomColor: 9075274,
    legs: null,
    shoes: 7031342,
    hat: "bucket",
    hatColor: 9083477,
    pack: 12999226,
    goal: ["fairways", 10],
    how: "Hit 10 fairways"
  },
  {
    id: "puffer",
    name: "Snow Puffer",
    top: "long",
    jacket: 16249588,
    trim: 16249588,
    shirt: 13121084,
    collar: true,
    bottoms: "shorts",
    bottomColor: 7315408,
    legs: 2500140,
    shoes: 13121084,
    hat: "beanie",
    hatColor: 16249588,
    pack: 13482378,
    goal: ["fish", 3],
    how: "Catch 3 fish"
  },
  {
    id: "flannel",
    name: "Camp Flannel",
    top: "coat",
    jacket: 12992559,
    trim: 2829099,
    shirt: 16183782,
    check: true,
    bottoms: "pants",
    bottomColor: 4153231,
    legs: null,
    shoes: 8017458,
    hat: "cap",
    hatColor: 2829099,
    goal: ["friends", 1],
    how: "Play a hole with a friend"
  },
  {
    id: "owl",
    name: "Night Owl",
    top: "long",
    jacket: 5917338,
    trim: 16765503,
    shirt: 2762560,
    collar: true,
    bottoms: "skirt",
    bottomColor: 2762560,
    legs: 2762560,
    shoes: 16765503,
    hat: "pom",
    hatColor: 16765503,
    scarf: 16765503,
    goal: ["birdies", 5],
    how: "Make 5 birdies"
  },
  {
    id: "chef",
    name: "Camp Chef",
    top: "hoodie",
    jacket: 16777215,
    trim: 14239803,
    shirt: 16777215,
    apron: 14239803,
    bottoms: "pants",
    bottomColor: 4211791,
    legs: null,
    shoes: 3356223,
    hat: "bandana",
    hatColor: 14239803,
    goal: ["perfectGrill", 1],
    how: "Grill a perfect yakizakana"
  },
  {
    id: "classic",
    name: "Clubhouse",
    top: "vest",
    jacket: 3042127,
    trim: 15985362,
    shirt: 16777215,
    check: true,
    bottoms: "pants",
    bottomColor: 15260864,
    legs: null,
    shoes: 16777215,
    hat: "flat",
    hatColor: 9071178,
    goal: ["holes", 18],
    how: "Play 18 holes"
  },
  {
    id: "gold",
    name: "Golden Hour",
    top: "long",
    jacket: 15775290,
    trim: 16774344,
    shirt: 16742972,
    collar: true,
    bottoms: "shorts",
    bottomColor: 8018462,
    legs: 4863268,
    shoes: 16774344,
    hat: "earflap",
    hatColor: 16774344,
    goal: ["gold", 1],
    how: "Catch the golden ball"
  },
  {
    id: "hanten",
    name: "Cozy Hanten",
    top: "long",
    jacket: 3428490,
    trim: 15128240,
    shirt: 16183782,
    check: true,
    collar: true,
    bottoms: "pants",
    bottomColor: 5916214,
    legs: null,
    shoes: 3811874,
    hat: "none",
    scarf: 12992559,
    goal: ["nabe", 1],
    how: "Share a hot pot by the fire"
  },
  {
    id: "skipper",
    name: "Lake Windbreaker",
    top: "hoodie",
    jacket: 3122848,
    trim: 16183782,
    shirt: 15911244,
    bottoms: "shorts",
    bottomColor: 2837098,
    legs: 2829107,
    shoes: 15911244,
    hat: "bucket",
    hatColor: 16183782,
    goal: ["skip6", 1],
    how: "Skip a stone 6 times"
  },
  {
    id: "walker",
    name: "Dog Walker",
    top: "vest",
    jacket: 14190394,
    trim: 7031342,
    shirt: 16183782,
    bottoms: "pants",
    bottomColor: 4872762,
    legs: null,
    shoes: 8017458,
    hat: "cap",
    hatColor: 13780540,
    pack: 9083477,
    goal: ["pets", 15],
    how: "Give Kuri 15 pats"
  }
];

// ../src/net/bots.js
var BOT_LEVELS = {
  easy: { label: "Easy", skill: 1.3, think: [2.2, 3.8] },
  par: { label: "Par", skill: 0.75, think: [1.6, 3] },
  pro: { label: "Pro", skill: 0.32, think: [1.2, 2.2] }
};
var NAMES = ["Rin", "Nade", "Chiaki", "Aoi", "Ena", "Minami", "Saito", "Toba", "Ayano", "Akari", "Haru", "Momo"];
function botLook(i, taken = []) {
  const r = mulberry32(hashSeed(`bot-${Date.now()}-${i}-${Math.random()}`));
  const pick = /* @__PURE__ */ __name((a) => a[Math.floor(r() * a.length)], "pick");
  const name = NAMES.filter((n) => !taken.includes(n))[Math.floor(r() * Math.max(1, NAMES.length - taken.length))] || `Bot ${i + 1}`;
  return {
    body: r() < 0.5 ? "girl" : "boy",
    skin: Math.floor(r() * 4),
    hair: pick(HAIR_STYLES),
    hairColor: Math.floor(r() * 7),
    eyes: Math.floor(r() * 6),
    eyeShape: pick(EYE_SHAPES),
    extra: r() < 0.25 ? "glasses" : "none",
    outfit: pick(OUTFITS).id,
    name
  };
}
__name(botLook, "botLook");
var Bots = class {
  static {
    __name(this, "Bots");
  }
  /** @param {object} net  the NetPlay (host side); it relays our messages */
  constructor(net) {
    this.net = net;
    this.list = [];
  }
  get game() {
    return this.net.g;
  }
  add(level = "par") {
    const n = this.list.length;
    const bot = { id: `bot-${n + 1}-${Math.random().toString(36).slice(2, 6)}`, level, ball: createBall(), strokes: 0, total: 0, state: "idle", t: 0 };
    this.list.push(bot);
    return bot;
  }
  remove(id) {
    this.list = this.list.filter((b) => b.id !== id);
  }
  clear() {
    this.list = [];
  }
  get(id) {
    return this.list.find((b) => b.id === id);
  }
  /** A new hole: everyone back to the tee, lining up. */
  atHole() {
    const { world, round } = this.game;
    this.list.forEach((b) => {
      b.strokes = 0;
      b.putts = 0;
      b.drive = 0;
      b.pin = null;
      b.holed = false;
      b.rng = mulberry32(hashSeed(`${round.seed}:${b.id}:${round.index}`));
      const at = teeSlot(world, this.net.seatOf(b.id));
      placeBall(b.ball, world, at.x, at.z);
      this.arrive(b, 0.8 + Math.random() * 1.2);
    });
  }
  /** They are at their ball: say so, then get ready after a think. */
  arrive(b, delay) {
    const { round } = this.game;
    b.state = "arriving";
    b.t = delay;
    this.net.deliverBot(b.id, { t: "at", x: b.ball.x, z: b.ball.z, hole: round.index });
  }
  /** GO for these ids: the named bots swing. */
  go(ids) {
    for (const b of this.list) if (ids.includes(b.id) && b.state === "ready") {
      b.state = "swinging";
      b.t = 0.9 + Math.random() * 0.6;
    }
  }
  /** Plan and play one shot. Returns the message describing it. */
  shot(b) {
    const { world, round } = this.game;
    const ball = b.ball;
    const env = { windX: world.spec.wind.x, windZ: world.spec.wind.z };
    const lvl = BOT_LEVELS[b.level] || BOT_LEVELS.par;
    const skill = lvl.skill;
    const rng = b.rng;
    const onTee = b.strokes === 0;
    const lie = lieFor(ball.surface);
    const toPin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    const fromX = ball.x, fromZ = ball.z;
    let msg;
    if (lie.id === "green" || lie.id === "fringe" && toPin < 12 || world.spec.green.channel) {
      const read = b.read || this.quickRead(b, 99);
      const paceError = 1 + (rng() - 0.5) * 0.3 * skill;
      const aimError = (rng() - 0.5) * 0.06 * skill;
      const c = Math.cos(aimError), s = Math.sin(aimError);
      const putt = { speed: read.speed * paceError, dirX: read.dirX * c - read.dirZ * s, dirZ: read.dirX * s + read.dirZ * c };
      puttBall(ball, putt);
      b.putts += 1;
      msg = { t: "shot", kind: "putt", x: fromX, z: fromZ, ...putt };
    } else {
      const target = aimTarget(world, ball.x, ball.z);
      const dist = Math.hypot(target.x - ball.x, target.z - ball.z);
      const club = autoSelectClub(dist, lie, onTee);
      const power = Math.min(100, powerFor(club, dist, lie.speedFactor) * (1 + (rng() - 0.5) * 0.16 * skill));
      const strike = strikeFromTiming((rng() - 0.5) * 1.1 * skill, club.loft, rng);
      const dirX = (target.x - ball.x) / dist, dirZ = (target.z - ball.z) / dist;
      const launch = buildLaunch({ club, power, lie, strike, scatter: rng() * 2 - 1, dirX, dirZ, slope: slopeAlong(world, ball, dirX, dirZ) });
      launchBall(ball, launch);
      msg = { t: "shot", kind: "full", x: fromX, z: fromZ, launch };
    }
    b.strokes += 1;
    const run = simulate(ball, world, env, { maxTime: 40 });
    b.flightTime = Math.min(28, run.time ?? 8);
    if (onTee && world.spec.par > 3) b.drive = Math.hypot(ball.x - fromX, ball.z - fromZ);
    if (onTee && world.spec.par === 3 && (ball.mode === "rest" || ball.mode === "holed") && ball.surface === "green") b.pin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    msg.hole = round.index;
    return msg;
  }
  /** The ball has stopped (or gone): next state. */
  landed(b) {
    const { world, round } = this.game;
    const ball = b.ball;
    if (ball.mode === "holed") {
      b.holed = true;
      this.net.deliverBot(b.id, { t: "holed" });
      b.state = "done";
      b.t = 1.2;
      return;
    }
    if (ball.mode === "water" || ball.mode === "oob") {
      b.strokes += 1;
      placeBall(ball, world, ball.dryX, ball.dryZ);
    } else if (ball.mode !== "rest") {
      ball.vx = ball.vy = ball.vz = 0;
      ball.mode = "rest";
    } else {
      placeBall(ball, world, ball.x, ball.z);
    }
    if (b.strokes >= 12) {
      b.state = "done";
      b.t = 0.5;
      return;
    }
    this.arrive(b, 1 + Math.random() * 1.5);
    void round;
  }
  /**
   * Crazy golf: the furthest point down the lane the ball can reach in a
   * straight line without touching a wall (the cup itself if it is in sight).
   */
  laneTarget(ball) {
    const { world } = this.game;
    const ch = world.spec.green.channel, pts = ch.pts;
    const total = pathLength(pts), here = pathInfo(pts, ball.x, ball.z).along;
    for (let ahead = total - here; ahead > 2; ahead -= 1.5) {
      const p = ahead >= total - here - 0.01 ? world.cup : pointAlongPath(pts, here + ahead);
      let clear = true;
      for (let k = 1; k < 12 && clear; k++) {
        const x = ball.x + (p.x - ball.x) * (k / 12), z = ball.z + (p.z - ball.z) * (k / 12);
        if (pathInfo(pts, x, z).dist > ch.half - 0.5) clear = false;
      }
      if (clear) return { x: p.x, z: p.z };
    }
    return aimTarget(world, ball.x, ball.z);
  }
  /**
   * A bot's putt read, done a couple of simulations at a time while it
   * thinks (the full readPutt the bot used to call was hundreds of rolls in
   * one frame: a freeze on a phone every time a bot putted). Pace for the
   * straight line, then aim corrections from where the ball actually goes.
   * budget: simulations to spend now. Returns the read when it is done.
   */
  quickRead(b, budget = 2) {
    const { world } = this.game;
    const ball = b.ball;
    let r = b.reading;
    if (!r) {
      const to = world.spec.green.channel ? this.laneTarget(ball) : world.cup;
      const dx = to.x - ball.x, dz = to.z - ball.z, dist = Math.hypot(dx, dz) || 1;
      r = b.reading = { dist, aim: Math.atan2(dz, dx), speed: null, tries: 0, best: null, to };
    }
    while (budget-- > 0) {
      const dirX = Math.cos(r.aim), dirZ = Math.sin(r.aim);
      if (r.speed === null) {
        if (!r.pace) r.pace = { lo: 0.2, hi: Math.min(30, 1.5 + (r.dist + 0.45) * 0.9), n: 0, grow: 0 };
        const pc = r.pace, want = r.dist + 0.45;
        const mid = pc.grow < 5 && pc.n === 0 ? pc.hi : (pc.lo + pc.hi) / 2;
        const t = createBall();
        placeBall(t, world, ball.x, ball.z);
        puttBall(t, { speed: mid, dirX, dirZ });
        simulate(t, { ...world, cup: null }, null, { maxTime: 12 });
        const rolled = (t.x - ball.x) * dirX + (t.z - ball.z) * dirZ;
        const short = rolled < want && t.mode === "rest";
        if (pc.grow < 5 && pc.n === 0) {
          if (short) {
            pc.lo = pc.hi;
            pc.hi = Math.min(30, pc.hi * 1.8);
            pc.grow += 1;
          } else pc.grow = 5;
          if (pc.grow >= 5) pc.n = 1;
          continue;
        }
        if (short) pc.lo = mid;
        else pc.hi = mid;
        if (++pc.n > 12) r.speed = (pc.lo + pc.hi) / 2;
        continue;
      }
      if (world.spec.green.channel) {
        const ch = world.spec.green.channel, pts = ch.pts, total = pathLength(pts);
        if (!r.cands) {
          const here = pathInfo(pts, ball.x, ball.z).along;
          const pts2 = [world.cup, r.to];
          for (const L of [6, 10, 15, 21]) if (here + L < total - 1) pts2.push(pointAlongPath(pts, here + L));
          r.cands = [];
          for (const p of pts2) for (const mult of [1, 1.18]) r.cands.push({ x: p.x, z: p.z, mult });
        }
        const c = r.cands.shift();
        if (c) {
          const d = Math.hypot(c.x - ball.x, c.z - ball.z) || 1, ang = Math.atan2(c.z - ball.z, c.x - ball.x);
          const speed = r.speed * Math.sqrt(d / r.dist) * c.mult;
          const t = createBall();
          placeBall(t, world, ball.x, ball.z);
          puttBall(t, { speed, dirX: Math.cos(ang), dirZ: Math.sin(ang) });
          simulate(t, world, null, { maxTime: 12 });
          const left = t.mode === "holed" ? -1 : total - pathInfo(pts, t.x, t.z).along + Math.hypot(t.x - world.cup.x, t.z - world.cup.z) * 0.3;
          if (!r.best || left < r.best.left) r.best = { dirX: Math.cos(ang), dirZ: Math.sin(ang), speed, left, miss: left };
        }
        if (!r.cands.length || r.best?.left === -1) {
          b.read = r.best;
          b.reading = null;
          return b.read;
        }
        continue;
      }
      const test = createBall();
      placeBall(test, world, ball.x, ball.z);
      puttBall(test, { speed: r.speed, dirX, dirZ });
      simulate(test, world, null, { maxTime: 12 });
      const miss = test.mode === "holed" ? 0 : Math.hypot(test.x - r.to.x, test.z - r.to.z);
      if (!r.best || miss < r.best.miss) r.best = { dirX, dirZ, speed: r.speed, miss };
      r.tries += 1;
      if (test.mode === "holed" || r.tries >= 4) {
        b.read = r.best;
        b.reading = null;
        return b.read;
      }
      const ex = test.x - ball.x, ez = test.z - ball.z;
      const off = Math.atan2(r.to.z - ball.z, r.to.x - ball.x) - Math.atan2(ez, ex);
      r.aim += Math.atan2(Math.sin(off), Math.cos(off)) * 0.9;
    }
    return null;
  }
  update(dt) {
    const { round, world } = this.game;
    if (!round || !world) return;
    let budget = 3;
    for (const b of this.list) {
      b.t -= dt;
      const lvl = BOT_LEVELS[b.level] || BOT_LEVELS.par;
      if (b.state === "arriving" && b.t <= 0) {
        b.state = "thinking";
        b.t = lvl.think[0] + Math.random() * (lvl.think[1] - lvl.think[0]);
        b.read = null;
        b.reading = null;
        const target = world.spec.green.channel || lieFor(b.ball.surface).id === "green" || lieFor(b.ball.surface).id === "fringe" ? world.cup : aimTarget(world, b.ball.x, b.ball.z);
        b.aim = Math.atan2(target.z - b.ball.z, target.x - b.ball.x);
        const lie = lieFor(b.ball.surface);
        const toPin = Math.hypot(world.cup.x - b.ball.x, world.cup.z - b.ball.z);
        const putting = lie.id === "green" || lie.id === "fringe" && toPin < 12 || world.spec.green.channel;
        const club = putting ? null : autoSelectClub(Math.hypot(target.x - b.ball.x, target.z - b.ball.z), lie, b.strokes === 0);
        b.kind = !club ? "putter" : club.id === "driver" || club.id === "wood3" ? "wood" : "iron";
      } else if (b.state === "thinking" && b.kind === "putter" && !b.read) {
        while (budget > 0 && !b.read) {
          budget -= 1;
          this.quickRead(b, 1);
        }
      } else if (b.state === "thinking" && b.t <= 0) {
        b.state = "ready";
        this.net.deliverBot(b.id, { t: "status", s: "ready", aim: b.aim, kind: b.kind });
      } else if (b.state === "swinging" && b.t <= 0) {
        this.net.deliverBot(b.id, { t: "status", s: "swing", aim: b.aim, kind: b.kind });
        b.state = "striking";
        b.t = 0.75;
      } else if (b.state === "striking" && b.t <= 0) {
        const msg = this.shot(b);
        this.net.deliverBot(b.id, msg);
        b.state = "flying";
        b.t = b.flightTime + 0.6;
      } else if (b.state === "flying" && b.t <= 0) {
        this.landed(b);
      } else if (b.state === "done" && b.t <= 0) {
        b.state = "finished";
        b.total += b.strokes - world.spec.par;
        this.net.deliverBot(b.id, { t: "done", strokes: b.strokes, total: b.total, drive: b.drive || 0, pin: b.pin ?? null });
      }
    }
  }
};

// room.js
var MAX_PLAYERS = 8;
var BOT_TICK = 200;
var LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
var GONE_AFTER = 4e4;
var SWEEP_EVERY = 15e3;
var KEEP_EMPTY = 6e4;
var RoomObject = class {
  static {
    __name(this, "RoomObject");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = /* @__PURE__ */ new Map();
    this.hostId = null;
    this.seq = 0;
    this.round = null;
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get("room");
      if (saved) {
        this.players = new Map(saved.players);
        this.hostId = saved.hostId;
        this.seq = saved.seq || 0;
        this.created = saved.created;
        this.round = saved.round || null;
      }
    });
  }
  // ---- Bots ---------------------------------------------------------------------
  /**
   * The bots' view of the game: the same three things a phone gave them
   * (the hole and round, a way to speak, seat numbers), so src/net/bots.js
   * runs here unchanged.
   */
  botHost() {
    if (this.bots) return this.bots;
    const room = this;
    const net = {
      g: { world: null, round: null },
      deliverBot: /* @__PURE__ */ __name((id, msg) => room.broadcast({ ...msg, from: id }), "deliverBot"),
      seatOf: /* @__PURE__ */ __name((id) => Math.max(0, [...room.players.keys()].indexOf(id)), "seatOf")
    };
    this.bots = new Bots(net);
    Object.defineProperty(this.bots, "game", { get: /* @__PURE__ */ __name(() => net.g, "get") });
    this.botNet = net;
    for (const p of this.players.values()) if (p.bot) this.bots.list.push(this.freshBot(p.id, p.level));
    return this.bots;
  }
  freshBot(id, level) {
    const b = this.bots.add(level);
    this.bots.list.pop();
    b.id = id;
    return b;
  }
  /** Load the round's current hole for the bots and send them to the tee. */
  botsToHole() {
    const r = this.round;
    const bots = this.botHost();
    if (!r || r.index >= r.holes.length || !bots.list.length) {
      this.botNet.g.world = null;
      return;
    }
    const spec = designHole(r.seed, r.holes[r.index]);
    this.botNet.g.world = buildWorld(spec);
    this.botNet.g.round = { seed: r.seed, index: r.index };
    bots.atHole();
    this.lastTick = Date.now();
    this.scheduleTick();
  }
  botsPlaying() {
    return !!(this.bots?.list.length && this.botNet?.g.world && this.round);
  }
  async scheduleTick() {
    if (!this.botsPlaying()) return;
    const cur = await this.state.storage.getAlarm();
    const at = Date.now() + BOT_TICK;
    if (!cur || cur > at) await this.state.storage.setAlarm(at);
  }
  tickBots() {
    if (!this.botsPlaying()) return;
    const now = Date.now();
    const dt = Math.min(1, (now - (this.lastTick || now)) / 1e3);
    this.lastTick = now;
    for (let k = 0; k < 4; k++) this.bots.update(k === 0 ? dt : 0);
  }
  /** Game messages the server listens in on, to keep its bots in step with the round. */
  watch(from, msg) {
    if (from !== this.hostId) return;
    if (msg.t === "start" && typeof msg.seed === "string") {
      const length = msg.length === 9 ? 9 : 18;
      this.round = { seed: msg.seed.slice(0, 40), length, holes: roundHoles(length), index: 0 };
      for (const b of this.botHost().list) b.total = 0;
      this.botsToHole();
    } else if (msg.t === "next" && this.round && Number.isInteger(msg.hole)) {
      this.round.index = msg.hole;
      this.botsToHole();
    } else if (msg.t === "go" && Array.isArray(msg.ids)) {
      this.botHost().go(msg.ids);
    }
  }
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const url = new URL(req.url);
    if (!this.created && url.searchParams.get("create") !== "1") {
      const pair2 = new WebSocketPair();
      const [client2, server2] = Object.values(pair2);
      server2.accept();
      server2.send('{"t":"nope"}');
      server2.close(4e3, "no such room");
      return new Response(null, { status: 101, webSocket: client2 });
    }
    if (!this.created) {
      this.created = Date.now();
      await this.save();
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id: null, heard: Date.now() });
    await this.state.storage.setAlarm(Date.now() + SWEEP_EVERY);
    return new Response(null, { status: 101, webSocket: client });
  }
  sockets() {
    return this.state.getWebSockets();
  }
  socketOf(id) {
    return this.sockets().find((ws) => ws.deserializeAttachment()?.id === id) || null;
  }
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
    }
  }
  broadcast(msg, except = null) {
    for (const ws of this.sockets()) if (ws !== except && ws.deserializeAttachment()?.id) this.send(ws, msg);
  }
  async save() {
    await this.state.storage.put("room", { players: [...this.players.entries()], hostId: this.hostId, seq: this.seq, created: this.created, round: this.round });
  }
  async shareRoster() {
    this.broadcast({ t: "roster", players: [...this.players.values()], hostId: this.hostId });
    await this.save();
  }
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const att = ws.deserializeAttachment() || {};
    att.heard = Date.now();
    ws.serializeAttachment(att);
    if (msg.t === "ping") return;
    if (msg.t === "hello") {
      if (att.id) return;
      let id = typeof msg.id === "string" && this.players.has(msg.id) && !this.players.get(msg.id).bot ? msg.id : null;
      if (id) {
        const old = this.socketOf(id);
        if (old && old !== ws) {
          try {
            old.close(1e3, "replaced");
          } catch {
          }
        }
        const p = this.players.get(id);
        p.look = msg.look ?? p.look;
        p.build = String(msg.build || p.build || "");
      } else {
        if (this.players.size >= MAX_PLAYERS) {
          const bot = [...this.players.values()].find((p) => p.bot);
          if (!bot) {
            this.send(ws, { t: "full" });
            ws.close(4001, "full");
            return;
          }
          this.players.delete(bot.id);
          this.bots?.remove(bot.id);
          this.broadcast({ t: "bot:dropped", id: bot.id });
        }
        id = this.hostId ? `p-${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}` : "host";
        if (!this.hostId) this.hostId = id;
        this.players.set(id, { id, host: id === this.hostId, look: msg.look, build: String(msg.build || "") });
      }
      att.id = id;
      ws.serializeAttachment(att);
      this.send(ws, { t: "welcome", id, hostId: this.hostId });
      await this.shareRoster();
      return;
    }
    if (!att.id) return;
    if (att.id === this.hostId) {
      if (msg.t === "bot:add" && this.players.size < MAX_PLAYERS) {
        const level = BOT_LEVELS[msg.level] ? msg.level : "par";
        const bots = this.botHost();
        const b = bots.add(level);
        const taken = [...this.players.values()].map((p) => p.look?.name);
        this.players.set(b.id, { id: b.id, host: false, bot: true, level, look: botLook(bots.list.length, taken) });
        await this.shareRoster();
        if (this.round) this.botsToHole();
        return;
      }
      if (msg.t === "bot:remove" && this.players.get(msg.id)?.bot) {
        this.players.delete(msg.id);
        this.bots?.remove(msg.id);
        await this.shareRoster();
        return;
      }
      if (msg.t === "as" && typeof msg.id === "string" && this.players.get(msg.id)?.bot && msg.msg && typeof msg.msg === "object") {
        this.broadcast({ ...msg.msg, from: msg.id }, ws);
        return;
      }
    }
    if (msg.t === "bot:add" || msg.t === "bot:remove" || msg.t === "as" || msg.t === "roster" || msg.t === "welcome" || msg.t === "host") return;
    this.broadcast({ ...msg, from: att.id }, ws);
    this.watch(att.id, msg);
  }
  async webSocketClose(ws) {
    await this.drop(ws, true);
  }
  async webSocketError(ws) {
    await this.drop(ws, true);
  }
  /**
   * A socket went. graceful: the player may be back in a moment (a phone in a
   * pocket), so their seat is kept until the sweep finds nobody on it.
   */
  async drop(ws, graceful = false) {
    const id = ws.deserializeAttachment()?.id;
    if (!id || !this.players.has(id)) return;
    if (graceful) return;
    await this.remove(id);
  }
  async remove(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    if (id === this.hostId) {
      const next = [...this.players.values()].find((p) => !p.bot);
      this.hostId = next?.id ?? null;
      for (const p of this.players.values()) p.host = p.id === this.hostId;
      if (next) this.broadcast({ t: "host", id: next.id });
    }
    await this.shareRoster();
  }
  /** Sweep: seats whose socket has been silent (or gone) too long are given up. */
  async alarm() {
    const now = Date.now();
    if (this.round && !this.botNet?.g.world) this.botsToHole();
    this.tickBots();
    if (this.nextSweep && now < this.nextSweep) {
      await this.rearm(now);
      return;
    }
    this.nextSweep = now + SWEEP_EVERY;
    const live = /* @__PURE__ */ new Set();
    for (const ws of this.sockets()) {
      const att = ws.deserializeAttachment();
      if (!att?.id) continue;
      if (now - att.heard > GONE_AFTER) {
        try {
          ws.close(1e3, "quiet");
        } catch {
        }
        continue;
      }
      live.add(att.id);
    }
    for (const p of [...this.players.values()]) {
      if (p.bot) continue;
      if (!live.has(p.id)) {
        p.lostAt ??= now;
        if (now - p.lostAt > GONE_AFTER) await this.remove(p.id);
      } else delete p.lostAt;
    }
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans) {
      this.emptySince = null;
      await this.rearm(now);
    } else if (!this.emptySince) {
      this.emptySince = now;
      this.round = null;
      await this.state.storage.setAlarm(now + KEEP_EMPTY);
    } else if (now - this.emptySince >= KEEP_EMPTY) {
      this.players.clear();
      this.hostId = null;
      this.created = null;
      this.round = null;
      this.bots = null;
      await this.state.storage.deleteAll();
    } else await this.state.storage.setAlarm(this.emptySince + KEEP_EMPTY);
  }
  /** The next alarm: the next bot step if bots are playing, else the next sweep. */
  async rearm(now) {
    const sweep = this.nextSweep || now + SWEEP_EVERY;
    await this.state.storage.setAlarm(this.botsPlaying() ? Math.min(sweep, now + BOT_TICK) : sweep);
  }
};
var room_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (url.pathname === "/new") {
      let code = "";
      for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      return Response.json({ code }, { headers: cors });
    }
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response("ThreeWood rooms", { status: 200, headers: cors });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(req);
  }
};

// ../../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-lTFXGe/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = room_default;

// ../../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-lTFXGe/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomObject,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=room.js.map
