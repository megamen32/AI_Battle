const S = {
  prevT: null,
  prevEnemyRel: null,
  stuckT: 0,
  lastPos: null,
};
const CELL = 120;              // размер ячейки туннеля
const VISIT_DECAY = 0.995;     // медленное забывание

S.visited = new Map();

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function hypot2(x, y) { return Math.hypot(x, y); }
function wrapPI(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function worldToLocal(ang, v) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: c * v.x + s * v.y, y: -s * v.x + c * v.y };
}

function nearestRay(vision, angle) {
  let best = null;
  for (const r of vision) {
    const da = Math.abs(r.angle - angle);
    if (!best || da < best.da) best = { da, r };
  }
  return best ? best.r : null;
}

function frontRay(vision) {
  return nearestRay(vision, 0);
}

function losOK(vision, ang, dist) {
  const r = nearestRay(vision, ang);
  if (!r) return true;
  if (r.hit === "wall" && r.dist < dist * 0.92) return false;
  return true;
}
function cellKey(pos) {
  const cx = Math.floor(pos.x / CELL);
  const cy = Math.floor(pos.y / CELL);
  return `${cx}:${cy}`;
}

function updateVisited(pos, dt) {
  // decay
  for (const [k, v] of S.visited) {
    const nv = v * Math.pow(VISIT_DECAY, dt * 60);
    if (nv < 0.05) S.visited.delete(k);
    else S.visited.set(k, nv);
  }

  const k = cellKey(pos);
  S.visited.set(k, (S.visited.get(k) || 0) + dt);
}

function visitPenalty(pos) {
  const k = cellKey(pos);
  return S.visited.get(k) || 0;
}

function solveIntercept(relPos, relVel, bulletSpeed, maxT = 1.2) {
  const px = relPos.x, py = relPos.y;
  const vx = relVel.x, vy = relVel.y;
  const a = (vx * vx + vy * vy) - bulletSpeed * bulletSpeed;
  const b = 2 * (px * vx + py * vy);
  const c = (px * px + py * py);

  let t = null;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) {
      const tt = -c / b;
      if (tt > 0) t = tt;
    }
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const sd = Math.sqrt(d);
      const t1 = (-b - sd) / (2 * a);
      const t2 = (-b + sd) / (2 * a);
      t = t1 > 0 ? t1 : (t2 > 0 ? t2 : null);
    }
  }
  if (!t || t <= 0) return null;
  if (t > maxT) t = maxT;
  return {
    t,
    aimLocal: { x: px + vx * t, y: py + vy * t }
  };
}

function bestEscapeRay(vision) {
  // выбираем луч с максимальной дистанцией (предпочитаем не "wall")
  let best = null;
  for (const r of vision) {
    let score = r.dist;
    if (r.hit === null) score += 120;        // открытое направление очень ценно
    if (Math.abs(r.angle) < 0.35) score += 30; // чуть предпочитаем более "вперёд", чтобы не крутиться на месте
    if (!best || score > best.score) best = { score, r };
  }
  return best ? best.r : null;
}

export function decide(input) {
  const { t, me, enemy, vision, finishRel, sense, rules } = input;

  const MAX_SPD = rules?.maxSpeed ?? 360;

  const SAFE_WALL = 70;
  const HARD_WALL = 32;
  const SAFE_TURRET = 150;

  const BULLET_WARN = 150;
  const BULLET_CRIT = 75;

  const SHOOT_DIST = 380;
  const SHOOT_FOV = 0.33;
  const BULLET_SPEED = 520;

  const FORCE_FINISH_DIST = 330;
  const ENGAGE_DIST = 340;
  const KILL_HP = 44;
  const ADV_HP = 16;

  // dt
  let dt = 0;
  if (S.prevT != null) dt = Math.max(1e-6, t - S.prevT);
  S.prevT = t;

  updateVisited(me.pos, dt);
const loopPenalty = visitPenalty(me.pos);
const inLoop = loopPenalty > 1.2;   // ~1–1.5 сек в одной зоне


  // enemy rel vel (local)
  let enemyRelVel = { x: 0, y: 0 };
  if (S.prevEnemyRel && dt > 0) {
    enemyRelVel = {
      x: (enemy.relPos.x - S.prevEnemyRel.x) / dt,
      y: (enemy.relPos.y - S.prevEnemyRel.y) / dt,
    };
  }
  S.prevEnemyRel = { ...enemy.relPos };

  // stuck detection
  if (S.lastPos) {
    const moved = hypot2(me.pos.x - S.lastPos.x, me.pos.y - S.lastPos.y);
    if (moved < 2.2) S.stuckT += dt;
    else S.stuckT = Math.max(0, S.stuckT - dt * 0.7);
  }
  S.lastPos = { ...me.pos };

  const vLocal = worldToLocal(me.ang, me.vel);
  const speedAbs = hypot2(me.vel.x, me.vel.y);
  const stuck = (S.stuckT > 0.7) && (speedAbs < 12);

  const bullets = sense?.bullets || [];
  const turrets = sense?.turrets || [];

  let turretRisk = 0;
  for (const tr of turrets) {
    const d = hypot2(tr.rel.x, tr.rel.y);
    if (d < SAFE_TURRET && tr.rel.x > -40)
      turretRisk = Math.max(turretRisk, (SAFE_TURRET - d) / SAFE_TURRET);
  }

  // fight vs finish
  const enemyRel = enemy.relPos;
  const enemyDist = hypot2(enemyRel.x, enemyRel.y);
  const finishDist = hypot2(finishRel.x, finishRel.y);

  const enemyAhead = enemyRel.x > -35;
  const forceFinish =
    enemy.hp === 0 ||
    finishDist < FORCE_FINISH_DIST ||
    me.hp < 18 ||
    turretRisk > 0.65;

  const wantEngage =
    !forceFinish &&
    enemyAhead &&
    enemyDist < ENGAGE_DIST &&
    (enemy.hp <= KILL_HP ||
      me.hp >= enemy.hp + ADV_HP ||
      (me.hp > 55 && enemy.hp < 70));

  const target = wantEngage ? enemyRel : finishRel;
  const angToTarget = Math.atan2(target.y, target.x);

  // behind-turn mode (не едем быстро, если цель сзади)
  const targetBehind = target.x < -60 && Math.abs(angToTarget) > 1.0;

  // base steer
  let steer = clamp(angToTarget * 2.4, -1, 1);

  // wall / bullet / turret steering modifiers (упрощённо, как в А)
  let wallAvoid = 0;
  let frontRisk = 0;
  for (const r of vision) {
    if (r.hit !== "wall") continue;
    if (r.dist >= SAFE_WALL) continue;
    const k = (SAFE_WALL - r.dist) / SAFE_WALL;
    const a = r.angle;
    const absA = Math.abs(a);
    const frontW = absA < 0.35 ? 2.6 : (absA < 0.8 ? 1.2 : 0.55);
    const sideSign = a > 0 ? 1 : -1;
    wallAvoid += -sideSign * k * frontW;
    if (absA < 0.25) frontRisk = Math.max(frontRisk, k);
  }

  let turretAvoid = 0;
  for (const tr of turrets) {
    const d = hypot2(tr.rel.x, tr.rel.y);
    if (d >= SAFE_TURRET || tr.rel.x < -50) continue;
    const a = Math.atan2(tr.rel.y, tr.rel.x);
    const k = (SAFE_TURRET - d) / SAFE_TURRET;
    turretAvoid += -Math.sign(a || 1) * k * 1.8;
  }

  let bulletAvoid = 0;
  let panic = 0;
  for (const b of bullets) {
    const d = hypot2(b.rel.x, b.rel.y);
    if (d >= BULLET_WARN || b.rel.x < -80) continue;
    const v = b.vel;
    const vLen = hypot2(v.x, v.y);
    if (vLen < 1e-3) continue;
    const nx = v.x / vLen, ny = v.y / vLen;
    const cross = b.rel.x * ny - b.rel.y * nx;
    const dodgeDir = cross >= 0 ? 1 : -1;
    const k = (BULLET_WARN - d) / BULLET_WARN;
    panic = Math.max(panic, k);
    const comingFront = (b.rel.x > 0) ? 1.15 : 0.85;
    bulletAvoid += dodgeDir * k * 2.2 * comingFront;
  }

  steer = clamp(steer + wallAvoid * 1.15 + turretAvoid * 1.35 + bulletAvoid * 1.0, -1, 1);

  // speed controller
  const vF = vLocal.x;
  const vLat = vLocal.y;

  const turnPenalty = 1 - clamp(Math.abs(steer), 0, 1) * 0.55;
  let desiredSpeed = MAX_SPD;
    if (Math.abs(steer) > 0.7)
    desiredSpeed *= (1 - (Math.abs(steer) - 0.7) * 0.6);


  if (frontRisk > 0) desiredSpeed *= (1 - 0.85 * frontRisk);
  if (panic > 0.25) desiredSpeed = Math.max(desiredSpeed, MAX_SPD * 0.92);
  if (turretRisk > 0.35) desiredSpeed = Math.max(desiredSpeed, MAX_SPD * 0.85);
  if (wantEngage && enemyDist < 220) desiredSpeed = Math.max(desiredSpeed, MAX_SPD * 0.88);

  if (targetBehind) desiredSpeed = 80;

  let throttle = clamp((desiredSpeed - vF) / 240, -1, 1);
  if (Math.abs(vLat) > 180 && throttle > 0.6)
    throttle *= 0.85;




  const fr = frontRay(vision);
  const hardFront = fr && fr.hit === "wall" && fr.dist < HARD_WALL;

  if (hardFront) throttle = -1;

  // === НОВОЕ: нормальный stuck-escape вместо "throttle=0" ===
  if (stuck) {
    const best = bestEscapeRay(vision);
    const front = fr;
    const frontDist = front ? front.dist : 999;

    // если спереди тесно — сдаём назад и выворачиваем к более свободной стороне
    if (front && front.hit === "wall" && frontDist < 85) {
      throttle = -1;
      // steer в сторону луча с лучшей дистанцией (как правило это "дырка")
      const a = best ? best.angle : (front.angle >= 0 ? -1 : 1);
      steer = clamp(a * 1.6, -1, 1);
    } else {
      // иначе пытаемся выйти вперёд в наиболее свободное направление
      const a = best ? best.angle : 0;
      steer = clamp(a * 1.6, -1, 1);
      throttle = 1;
    }
  }
  if (inLoop && !stuck) {
  const best = bestEscapeRay(vision);

  // режем газ — иначе снова пролетит туда же
  throttle = Math.min(throttle, 0.6);

  // сильнее тянем к свободному направлению
  if (best) {
    steer = clamp(
      steer + clamp(best.angle * 2.2, -1, 1),
      -1, 1
    );
  }
}
if (inLoop) {
  const fr = frontRay(vision);
  if (fr && fr.hit !== null && fr.dist > 80) {
    steer = clamp(steer + (fr.angle >= 0 ? -0.8 : 0.8), -1, 1);
  }
}


  // Shooting
  let shoot = false;
  let aimAngle = me.ang;

  if (me.shootCd <= 0 && enemy.hp > 0 && enemyDist < SHOOT_DIST && enemyRel.x > -20) {
    const relVel = enemyRelVel;
    const sol = solveIntercept(enemyRel, relVel, BULLET_SPEED, 1.15);
    if (sol) {
      const a = Math.atan2(sol.aimLocal.y, sol.aimLocal.x);
      const closeBullet = bullets.some(b => hypot2(b.rel.x, b.rel.y) < BULLET_CRIT && b.rel.x > -25);
      const blocked = !losOK(vision, a, enemyDist);
      if (!closeBullet && Math.abs(a) < SHOOT_FOV && (!blocked || enemyDist < 110)) {
        shoot = true;
        aimAngle = wrapPI(me.ang + a);
      }
    } else {
      const a = Math.atan2(enemyRel.y, enemyRel.x);
      if (Math.abs(a) < SHOOT_FOV && losOK(vision, a, enemyDist)) {
        shoot = true;
        aimAngle = wrapPI(me.ang + a);
      }
    }
  }
  if (!hardFront && !stuck && !targetBehind)
  throttle = Math.max(throttle, 0.95);

  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    shoot,
    aimAngle,
  };
}
