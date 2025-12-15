// Improved aggressive finisher + precise killer
// Основные улучшения:
// - Более точный lead с учётом собственной скорости
// - Агрессивнее преследует врага (меньше отклоняется от цели из-за боковых стен)
// - Лучший контроль throttle (реже тормозит без необходимости)
// - Раньше начинает бой при преимуществе HP
// - Улучшенная проверка LoS и стрельба даже при лёгкой блокировке (если враг близко)

const State = {
  prevT: null,
  prevEnemyRel: null,
  prevMeVel: null
};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function hypot2(x, y) { return Math.hypot(x, y); }
function sign(x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); }

function nearestFrontRay(vision) {
  let best = null;
  for (const r of vision) {
    const a = Math.abs(r.angle);
    if (!best || a < best.a) best = { a, r };
  }
  return best ? best.r : null;
}

function losNotBlocked(vision, targetAngle, targetDist) {
  let best = null;
  for (const r of vision) {
    const da = Math.abs(r.angle - targetAngle);
    if (!best || da < best.da) best = { da, r };
  }
  if (!best) return true;
  const r = best.r;
  if (r.hit === "wall" && r.dist < targetDist * 0.95) return false;
  return true;
}

export function decide(input) {
  const { t, me, enemy, vision, finishRel, sense } = input;

  // Tunables — чуть агрессивнее
  const SAFE_WALL = 60;
  const HARD_WALL = 30;

  const SAFE_TURRET = 140;

  const BULLET_WARN = 120;
  const BULLET_CRIT = 65;

  const SHOOT_DIST = 340;       // чуть дальше
  const SHOOT_FOV = 0.26;        // шире угол
  const BULLET_SPEED = 520;     // реальная скорость пули машины!

  const FINISH_FORCE_DIST = 350; // чуть раньше игнорируем бой
  const KILL_HP = 40;            // начинаем убивать при 40 hp врага
  const HP_ADVANTAGE = 20;       // +20 hp уже преимущество

  // Distances
  const finishDist = hypot2(finishRel.x, finishRel.y);
  const enemyRel = enemy.relPos;
  const enemyDist = hypot2(enemyRel.x, enemyRel.y);

  // dt и относительная скорость
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

  // Пример: собственная скорость в локальных координатах (примерно)
  const myLocalVel = State.prevMeVel ? {
    x: Math.cos(me.ang) * me.vel.x + Math.sin(me.ang) * me.vel.y,  // грубо, но лучше чем ничего
    y: -Math.sin(me.ang) * me.vel.x + Math.cos(me.ang) * me.vel.y
  } : { x: 0, y: 0 };
  State.prevMeVel = { x: me.vel.x, y: me.vel.y };

  // Решение: драться или финиш?
  const enemyAhead = enemyRel.x > -30;
  const shouldForceFinish = finishDist < FINISH_FORCE_DIST || enemy.hp === 0 || me.hp < 15;
  
  const shouldEngage = !shouldForceFinish &&
    enemyAhead &&
    enemyDist < 320 &&
    (enemy.hp <= KILL_HP || me.hp > enemy.hp + HP_ADVANTAGE || (enemy.hp < 60 && me.hp > 50));

  const target = shouldEngage ? enemyRel : finishRel;
  let targetAngle = Math.atan2(target.y, target.x);

  // Базовый steer к цели
  let steer = clamp(targetAngle * 2.2, -1, 1);  // чуть острее поворот
  let throttle = 1;

  // Wall avoidance — слабее на боках, сильнее спереди
  let wallAvoid = 0;
  for (const r of vision) {
    if (r.hit !== "wall" || r.dist >= SAFE_WALL) continue;
    const k = (SAFE_WALL - r.dist) / SAFE_WALL;
    const angleFactor = Math.abs(r.angle);
    const centerWeight = angleFactor < 0.5 ? 2.2 : 1.0;
    const sidePenalty = angleFactor > 0.9 ? 0.5 : 1.0;  // меньше паники от боковых стен
    wallAvoid += -sign(r.angle) * k * centerWeight * sidePenalty;
  }

  // Turret avoidance
  let turretAvoid = 0;
  const turrets = sense.turrets || [];
  for (const tr of turrets) {
    const d = hypot2(tr.rel.x, tr.rel.y);
    if (d >= SAFE_TURRET || tr.rel.x < -30) continue;
    const a = Math.atan2(tr.rel.y, tr.rel.x);
    const k = (SAFE_TURRET - d) / SAFE_TURRET;
    turretAvoid += -sign(a) * k * 1.5;
  }

  // Bullet dodge — сильнее, но не тормозим
  let dodge = 0;
  let bulletDanger = 0;
  const bullets = sense.bullets || [];
  for (const b of bullets) {
    const d = hypot2(b.rel.x, b.rel.y);
    if (d >= BULLET_WARN || b.rel.x < -50) continue;
    const a = Math.atan2(b.rel.y, b.rel.x);
    const k = (BULLET_WARN - d) / BULLET_WARN;
    const w = k * 1.2;
    bulletDanger += w;
    dodge += -sign(a) * w;
  }

  // Комбинируем
  steer = clamp(steer + wallAvoid * 1.1 + turretAvoid * 1.4 + dodge * 2.3, -1, 1);

  // Throttle — стараемся держать максимальную скорость
  const front = nearestFrontRay(vision);
  if (front && front.hit === "wall") {
    if (front.dist < HARD_WALL) throttle = -1;
    else if (front.dist < SAFE_WALL) throttle = 0.4;  // поменьше тормозим
  }

  if (Math.abs(steer) > 0.9) throttle = Math.min(throttle, 0.85); // только при очень крутом повороте

  if (bulletDanger > 0.7) throttle = 1; // под огнём — газ в пол

  // Не застревать у турелей
  for (const tr of turrets) {
    const d = hypot2(tr.rel.x, tr.rel.y);
    if (d < 90 && tr.rel.x > -20) throttle = Math.max(throttle, 0.9);
  }

  // Shooting — агрессивнее и точнее
  let shoot = false;
  let aimAngle = me.ang;

  if (me.shootCd <= 0 && enemy.hp > 0 && enemyDist < SHOOT_DIST) {
    const baseAng = Math.atan2(enemyRel.y, enemyRel.x);

    if (Math.abs(baseAng) < 1.0) {
      // Улучшенный lead с учётом относительной скорости
      const relVel = enemyRelVel;
      const leadT = enemyDist / BULLET_SPEED;
      const predX = enemyRel.x + relVel.x * leadT;
      const predY = enemyRel.y + relVel.y * leadT;
      let a = Math.atan2(predY, predX);

      // Корректировка на собственное движение (примерная)
      const myForward = myLocalVel.x > 100 ? myLocalVel.x * 0.0008 : 0;
      a -= myForward * Math.sign(a);

      if (Math.abs(a) < SHOOT_FOV) {
        const blocked = !losNotBlocked(vision, a, enemyDist);
        const tooCloseBullet = bullets.some(b => hypot2(b.rel.x, b.rel.y) < BULLET_CRIT && b.rel.x > -30);

        if (!tooCloseBullet && (!blocked || enemyDist < 120)) {  // стреляем даже через стену, если очень близко
          shoot = true;
          aimAngle = me.ang + a;  // важно: aimAngle — абсолютный!
        }
      }
    }
  }

  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    shoot,
    aimAngle
  };
}