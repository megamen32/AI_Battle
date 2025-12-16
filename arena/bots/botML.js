import { getBrain } from "./bot3Brain.js";

const BULLET_SPEED = 520;

const State = {
  prevEnemyRel: null,
  prevTime: null,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}

function hypot2(x, y) {
  return Math.hypot(x, y);
}

function normalizeAngle(rad) {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function getFeatures(input) {
  const { me, enemy, finishRel, sense, rules } = input;
  const finishDist = hypot2(finishRel.x, finishRel.y);
  const enemyDist = hypot2(enemy.relPos.x, enemy.relPos.y);
  const finishAngle = Math.atan2(finishRel.y, finishRel.x) / Math.PI;
  const enemyAngle = Math.atan2(enemy.relPos.y, enemy.relPos.x) / Math.PI;
  const hpDiff = clamp((me.hp - enemy.hp) / 100, -1, 1);
  const bullets = sense?.bullets ?? [];
  const turrets = sense?.turrets ?? [];
  let bulletPressure = 0;
  for (const b of bullets) {
    const d = hypot2(b.rel.x, b.rel.y);
    bulletPressure += Math.max(0, 1 - Math.min(1, d / 260));
  }
  let turretPressure = 0;
  for (const t of turrets) {
    const d = hypot2(t.rel.x, t.rel.y);
    turretPressure += Math.max(0, 1 - Math.min(1, d / 400));
  }
  const ca = Math.cos(me.ang);
  const sa = Math.sin(me.ang);
  const forwardVel = clamp((me.vel.x * ca + me.vel.y * sa) / ((rules?.maxSpeed) || 360), -1, 1);

  return [
    1,
    clamp(finishAngle, -1, 1),
    Math.min(1, finishDist / 600),
    clamp(enemyAngle, -1, 1),
    Math.min(1, enemyDist / 450),
    hpDiff,
    clamp(bulletPressure, 0, 1),
    clamp(turretPressure, 0, 1),
    forwardVel,
  ];
}

function estimateEnemyVelocity(enemyRel, currentTime) {
  if (!State.prevEnemyRel || State.prevTime == null) {
    State.prevEnemyRel = { ...enemyRel };
    State.prevTime = currentTime;
    return { x: 0, y: 0 };
  }
  const dt = Math.max(1e-3, currentTime - State.prevTime);
  const vel = {
    x: (enemyRel.x - State.prevEnemyRel.x) / dt,
    y: (enemyRel.y - State.prevEnemyRel.y) / dt,
  };
  State.prevEnemyRel = { ...enemyRel };
  State.prevTime = currentTime;
  return vel;
}

function leadAngle(enemyRel, enemyVel) {
  const rx = enemyRel.x;
  const ry = enemyRel.y;
  const vx = enemyVel.x;
  const vy = enemyVel.y;

  const a = vx * vx + vy * vy - BULLET_SPEED * BULLET_SPEED;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;
  let t = 0;
  const discriminant = b * b - 4 * a * c;
  if (Math.abs(a) < 1e-6 || discriminant < 0) {
    t = Math.sqrt(c) / BULLET_SPEED;
  } else {
    const sqrt = Math.sqrt(discriminant);
    const t1 = (-b + sqrt) / (2 * a);
    const t2 = (-b - sqrt) / (2 * a);
    t = Math.min(t1, t2);
    if (t < 0) t = Math.max(t1, t2);
    if (!isFinite(t) || t < 0) t = Math.sqrt(c) / BULLET_SPEED;
  }
  t = Math.max(0, Math.min(0.9, t));
  const aimX = rx + vx * t;
  const aimY = ry + vy * t;
  return normalizeAngle(Math.atan2(aimY, aimX));
}

function nearestFrontWall(vision) {
  let best = null;
  for (const ray of vision) {
    if (Math.abs(ray.angle) > 0.5) continue;
    if (ray.hit !== "wall") continue;
    if (!best || ray.dist < best.dist) best = ray;
  }
  return best;
}

export function decide(input) {
  const { me, enemy, vision, finishRel, sense } = input;
  if (State.prevTime !== null && input.t < State.prevTime) {
    State.prevTime = null;
    State.prevEnemyRel = null;
  }
  const brain = getBrain();
  const feats = getFeatures(input);

  let steer = Math.tanh(dot(brain.steer, feats));
  let throttle = Math.tanh(dot(brain.throttle, feats));

  // Soft bias toward finish when enemy is far
  const enemyDist = hypot2(enemy.relPos.x, enemy.relPos.y);
  if (enemyDist > 320) {
    const finishAngle = Math.atan2(finishRel.y, finishRel.x);
    steer = clamp(steer * 0.7 + clamp(finishAngle * 0.4, -0.6, 0.6), -1, 1);
  }

  // Wall avoidance safeguard
  const wallRay = nearestFrontWall(vision || []);
  if (wallRay && wallRay.dist < 45) {
    throttle = -0.8;
  } else if (wallRay && wallRay.dist < 90) {
    throttle = Math.min(throttle, 0.2);
    steer += wallRay.angle > 0 ? -0.7 : 0.7;
  }

  // Encourage dodge when bullets close
  const bullets = sense?.bullets ?? [];
  if (bullets.length) {
    let dodge = 0;
    for (const b of bullets) {
      if (b.rel.x < -40) continue;
      const d = hypot2(b.rel.x, b.rel.y);
      if (d > 140) continue;
      dodge += b.rel.y > 0 ? -0.6 : 0.6;
    }
    steer = clamp(steer + dodge, -1, 1);
  }

  const shootScore = dot(brain.shoot, feats) - (brain.shootBias ?? 0.2);
  const enemyVel = estimateEnemyVelocity(enemy.relPos, input.t);
  const aimAngle = leadAngle(enemy.relPos, enemyVel);
  const shoot = shootScore > 0 && enemyDist < 360 && Math.abs(aimAngle) < 1.15 && me.shootCd <= 0;

  // Slight aggression boost when enemy low
  if (enemy.hp < 30 && enemyDist < 200) throttle = clamp(throttle + 0.2, -1, 1);

  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    shoot,
    aimAngle,
  };
}
