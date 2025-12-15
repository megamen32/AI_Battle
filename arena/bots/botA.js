// Deterministic “win” controller: finish-first + hard avoidance + opportunistic kill.
// Assumes rel vectors (finishRel / enemy.relPos / sense.*.rel) are in car-local coords (as in your working example).

const State = {
  prevT: null,
  prevEnemyRel: null
};

function clamp(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

function hypot2(x, y) {
  return Math.hypot(x, y);
}

function sign(x) {
  return x < 0 ? -1 : (x > 0 ? 1 : 0);
}

function nearestFrontRay(vision) {
  let best = null;
  for (const r of vision) {
    const a = Math.abs(r.angle);
    if (!best || a < best.a) best = { a, r };
  }
  return best ? best.r : null;
}

function losNotBlocked(vision, targetAngle, targetDist) {
  // Find closest ray to targetAngle. If it hits a wall closer than target, assume blocked.
  let best = null;
  for (const r of vision) {
    const da = Math.abs(r.angle - targetAngle);
    if (!best || da < best.da) best = { da, r };
  }
  if (!best) return true;
  const r = best.r;
  if (r.hit === "wall" && r.dist < targetDist - 10) return false;
  return true;
}

export function decide(input) {
  const { t, me, enemy, vision, finishRel, sense } = input;

  // Convert world-relative vectors into car-local coordinates (x = forward, y = right)
  const ca = Math.cos(-me.ang), sa = Math.sin(-me.ang);
  const finishLocal = {
    x: finishRel.x * ca - finishRel.y * sa,
    y: finishRel.x * sa + finishRel.y * ca,
  };
  const enemyLocal = {
    x: enemy.relPos.x * ca - enemy.relPos.y * sa,
    y: enemy.relPos.x * sa + enemy.relPos.y * ca,
  };

  // transform sensed bullets/turrets into local frame (keep other fields)
  const localBullets = (sense?.bullets || []).map(b => ({
    ...b,
    rel: {
      x: b.rel.x * ca - b.rel.y * sa,
      y: b.rel.x * sa + b.rel.y * ca,
    }
  }));
  const localTurrets = (sense?.turrets || []).map(tu => ({
    ...tu,
    rel: {
      x: tu.rel.x * ca - tu.rel.y * sa,
      y: tu.rel.x * sa + tu.rel.y * ca,
    }
  }));

  // ---- Tunables ----
  const SAFE_WALL = 55;
  const HARD_WALL = 28;

  const SAFE_TURRET = 150;

  const BULLET_WARN = 110;
  const BULLET_CRIT = 70;

  const SHOOT_DIST = 320;
  const SHOOT_FOV = 0.22;     // radians in local frame (angle from forward)
  const BULLET_SPEED = 800;   // only for lead; driving does not depend on it

  const FINISH_FORCE_DIST = 380; // if finish is close => ignore fights
  const KILL_HP = 30;

  // ---- Distances ----
  const finishDist = hypot2(finishRel.x, finishRel.y);
  // use local coordinates for enemy targeting/motion
  const enemyRel = enemyLocal;
  const enemyDist = hypot2(enemy.relPos.x, enemy.relPos.y);

  // ---- Tick dt and enemy rel-velocity (safe because you guaranteed stable ticks) ----
  let dt = 0;
  if (State.prevT != null) dt = Math.max(1e-6, t - State.prevT);
  State.prevT = t;

  let enemyRelVel = { x: 0, y: 0 };
  if (State.prevEnemyRel && dt > 0) {
    enemyRelVel = {
      x: (enemyRel.x - State.prevEnemyRel.x) / dt,
      y: (enemyRel.y - State.prevEnemyRel.y) / dt
    };
  }
  State.prevEnemyRel = { x: enemyRel.x, y: enemyRel.y };

  // ---- Decide target (finish-first, kill only when выгодно) ----
  const enemyAhead = enemyRel.x > -10; // “примерно впереди”
  const shouldForceFinish = (finishDist < FINISH_FORCE_DIST) || enemy.hp === 0 || me.hp < 18;

  const shouldEngage =
    !shouldForceFinish &&
    enemyAhead &&
    enemyDist < 280 &&
    (enemy.hp <= KILL_HP || me.hp > enemy.hp + 25);

  const target = shouldEngage ? enemyRel : finishRel;
  const targetAngle = Math.atan2(target.y, target.x);

  // ---- Base steering toward target (local angle -> steer) ----
  let steer = clamp(targetAngle * 2.0, -1, 1);
  let throttle = 1;

  // ---- Wall avoidance via LIDAR (repulsion in angle space) ----
  let wallAvoid = 0;
  for (const r of vision) {
    if (r.hit !== "wall") continue;
    if (r.dist >= SAFE_WALL) continue;

    const k = (SAFE_WALL - r.dist) / SAFE_WALL; // 0..1
    // Push away from the side where wall is detected.
    // Stronger near center.
    const centerBoost = 1 + (1 - Math.min(1, Math.abs(r.angle) / 0.8));
    wallAvoid += -sign(r.angle) * k * (0.7 + 0.8 * centerBoost);
  }

  // ---- Turret avoidance (treat as obstacles) ----
  let turretAvoid = 0;
  const turrets = localTurrets || [];
  for (const tr of turrets) {
    const dx = tr.rel.x, dy = tr.rel.y;
    const d = hypot2(dx, dy);
    if (d >= SAFE_TURRET) continue;
    if (dx < -25) continue; // mostly behind: ignore

    const a = Math.atan2(dy, dx);
    const k = (SAFE_TURRET - d) / SAFE_TURRET;
    const frontBoost = Math.abs(a) < 0.5 ? 1.4 : 1.0;
    turretAvoid += -sign(a) * k * frontBoost;
  }

  // ---- Bullet dodge (simple, robust: based on rel position) ----
  let dodge = 0;
  let bulletDanger = 0;
  const bullets = localBullets || [];
  for (const b of bullets) {
    const dx = b.rel.x, dy = b.rel.y;
    const d = hypot2(dx, dy);
    if (d >= BULLET_WARN) continue;
    if (dx < -60) continue; // mostly behind

    const a = Math.atan2(dy, dx);
    const k = (BULLET_WARN - d) / BULLET_WARN;
    const dmg = (b.dmg || 10);
    const w = k * (0.6 + 0.02 * dmg);

    bulletDanger += w;
    dodge += -sign(a) * w;
  }

  // ---- Combine steering influences ----
  steer = clamp(
    steer +
      wallAvoid * 1.25 +
      turretAvoid * 1.6 +
      dodge * 2.1,
    -1, 1
  );

  // ---- Throttle control (front collisions + tight turns) ----
  const front = nearestFrontRay(vision);

  if (front && front.hit === "wall") {
    if (front.dist < HARD_WALL) throttle = -1;
    else if (front.dist < SAFE_WALL) throttle = 0.25;
  }

  // Slow a bit on extreme steering to avoid scraping walls
  if (Math.abs(steer) > 0.85 && throttle > 0.6) throttle = 0.75;

  // Under bullet pressure, prefer speed (unless we must brake for wall)
  if (bulletDanger > 0.9 && throttle > 0) throttle = 1;

  // If turret very close ahead, keep moving (don’t stall)
  // (stalls = death by turret)
  for (const tr of turrets) {
    const d = hypot2(tr.rel.x, tr.rel.y);
    if (d < 80 && tr.rel.x > -10 && throttle > 0) throttle = Math.max(throttle, 0.8);
  }

  // ---- Shooting (opportunistic, with lead; does not affect driving) ----
  let shoot = false;
  let aimAngle = 0;

  if (me.shootCd <= 0 && enemy.hp > 0) {
    const baseAngToEnemy = Math.atan2(enemyRel.y, enemyRel.x);

    if (enemyDist < SHOOT_DIST && Math.abs(baseAngToEnemy) < 0.9) {
      // Lead in local frame using rel-velocity (stable ticks assumed)
      const leadT = clamp(enemyDist / BULLET_SPEED, 0, 0.45);
      const px = enemyRel.x + enemyRelVel.x * leadT;
      const py = enemyRel.y + enemyRelVel.y * leadT;

      const a = Math.atan2(py, px);

      // Only fire if roughly in front and not obviously blocked by a wall ray
      if (Math.abs(a) < SHOOT_FOV && losNotBlocked(vision, a, enemyDist)) {
        // Don’t shoot in “critical bullet” moments: survive first
        let crit = false;
        for (const b of bullets) {
          const d = hypot2(b.rel.x, b.rel.y);
          if (d < BULLET_CRIT && b.rel.x > -40) { crit = true; break; }
        }
        if (!crit) {
          shoot = true;
          aimAngle = a;
        }
      }
    }
  }

  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    shoot,
    aimAngle: shoot ? aimAngle : 0
  };
}
