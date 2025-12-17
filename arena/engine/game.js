import { makeWorld } from "./world.js";
import { add, sub, mul, len, norm, clamp, rot, circleRectResolve, reflect, lcg, v, rayCircle, rayRect } from "./math.js";

const CAR_PHYSICS = {
  TURN_RATE: 3.2,
  TURN_MIN_FACTOR: 0.28,
  TURN_REFERENCE_SPEED: 320,
  ACCEL_FWD: 520,
  ACCEL_REV: 360,
  BRAKE_FORCE: 900,
  MAX_SPEED_FWD: 360,
  MAX_SPEED_REV: 220,
  MAX_SPEED: 360,
  DRAG_LONGITUDINAL: 1.6,   // per-second decay of forward velocity
  DRAG_LATERAL: 10.5,       // lateral velocity bleeds much faster to avoid drifting
  DRAG_AERO: 0.85,          // scales with absolute speed (per second)
  IDLE_BRAKE: 140,          // additional braking when throttle released
};

export class Game {
  constructor({ seed=1337, bots, botNames=["A","B"], worldOptions=null }) {
    this.rng = lcg(seed);
    this.seed = seed;
    this.botMods = bots;
    this.botNames = botNames;

    const worldOpts = { seed, ...(worldOptions || {}) };
    this.world = makeWorld(worldOpts);
    this.world.finishCenter = () => ({ x: this.world.finish.x + this.world.finish.w/2, y: this.world.finish.y + this.world.finish.h/2 });
 
    this.time = 0;
    this.winner = null;
    this.winReason = null;

    this.cars = this.world.spawns.map((s, i) => ({
      id: i,
      name: botNames[i] || String(i),
      pos: { x: s.x, y: s.y },
      vel: v(0,0),
      ang: s.a,
      hp: 100,
      radius: 14,
      shootCd: 0,
      kills: 0,
      reachedFinish: false,
      lastAction: null,
    }));

    this.turrets = this.world.turrets.map((t, i) => ({
      id: i,
      pos: { x: t.x, y: t.y },
      cd: 0,
    }));

    this.bullets = []; // {pos, vel, owner: "turret"|"car", ownerId, dmg, ttl}
    this._loggedInputFor = new Set();
  }

  step(dt) {
    if (this.winner) return;

    this.time += dt;

    // 1) bots decide
    for (const car of this.cars) {
      car.shootCd = Math.max(0, car.shootCd - dt);
      const input = this.makeInputFor(car.id);
      const action = this.safeDecide(car.id, input);
      car.lastAction = action;
      this.applyAction(car, action, dt);
    }

    // 2) turret AI
    this.stepTurrets(dt);

    // 3) integrate physics
    for (const car of this.cars) this.integrateCar(car, dt);

    // 4) bullets
    this.stepBullets(dt);

    // 5) win conditions
    this.checkWin();
  }

  safeDecide(botId, input) {
    const mod = this.botMods[botId];
    try {
      // минимальная защита от мусора: deep-freeze не делаем, но хотя бы копию
      const res = mod.decide(structuredClone(input));
      return this.sanitizeAction(res);
    } catch (e) {
      // бот упал — сам виноват: стоим и не стреляем
      return { throttle: 0, steer: 0, shoot: false, aimAngle: 0 };
    }
  }

  sanitizeAction(a) {
    const throttle = clamp(Number(a?.throttle ?? 0), -1, 1);
    const steer = clamp(Number(a?.steer ?? 0), -1, 1);
    const shoot = Boolean(a?.shoot ?? false);
    const aimAngle = Number(a?.aimAngle ?? 0);
    return { throttle, steer, shoot, aimAngle };
  }

  makeInputFor(carId) {
    const me = this.cars[carId];
    const enemy = this.cars[1 - carId];

    const relEnemyWorld = sub(enemy.pos, me.pos);

    // Ray casting for vision (LIDAR-like)
    const RAYS = [-1.2, -0.8, -0.4, -0.2, 0, 0.2, 0.4, 0.8, 1.2];
    const MAX_DIST = 400;

    const vision = RAYS.map(a => {
      const ang = me.ang + a;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const rayHit = this.castRay(me.pos, dir, MAX_DIST);
      return {
        angle: a,
        hit: rayHit.hit,
        dist: rayHit.dist,
      };
    });

    const nearbyBullets = this.bullets
      .filter(b => len(sub(b.pos, me.pos)) < 260)
      .map(b => ({
        rel: sub(b.pos, me.pos),
        vel: b.vel,
        owner: b.owner,
        dmg: b.dmg,
      }));

    const nearbyTurrets = this.turrets
      .filter(t => len(sub(t.pos, me.pos)) < 420)
      .map(t => ({ rel: sub(t.pos, me.pos) }));

    // Convert many fields into car-local coordinates (x=forward, y=right)
    // Local: x = forward (me.ang direction), y = right
    const ca = Math.cos(me.ang), sa = Math.sin(me.ang);
    function toLocal(v) {
      return { x: v.x * ca + v.y * sa, y: -v.x * sa + v.y * ca };
    }

    const enemyLocal = toLocal(relEnemyWorld);
    const finishLocal = toLocal(sub(this.world.finishCenter(), me.pos));

    const bulletsLocal = nearbyBullets.map(b => ({
      ...b,
      rel: toLocal(b.rel),
      vel: toLocal(b.vel)
    }));

    const turretsLocal = nearbyTurrets.map(t => ({
      ...t,
      rel: toLocal(t.rel)
    }));

    // enrich vision with local hit-point when available
    const visionLocal = vision.map(r => {
      const ang = me.ang + r.angle;
      const endWorld = { x: me.pos.x + Math.cos(ang) * r.dist, y: me.pos.y + Math.sin(ang) * r.dist };
      const endLocal = toLocal(sub(endWorld, me.pos));
      if (r.hit === null) return { ...r, endPosLocal: endLocal };
      return { ...r, hitPosLocal: endLocal };
    });

    const input = {
      t: this.time,
      seed: this.seed,
      me: {
        pos: structuredClone(me.pos),
        vel: structuredClone(me.vel),
        ang: me.ang,
        hp: me.hp,
        shootCd: me.shootCd,
      },
      // Almost everything except `me` is provided in the car-local frame
      enemy: {
        relPos: enemyLocal, // local coords: x forward, y right
        hp: enemy.hp,
      },
      vision: visionLocal, // angles are relative to car; `hitPosLocal` available when hit
      finishRel: finishLocal, // local coords
      sense: {
        bullets: bulletsLocal,
        turrets: turretsLocal,
      },
      rules: {
        maxSpeed: 360,
        carRadius: me.radius,
        shootCooldown: 0.25,
      }
    };

    // optional one-time logging for debugging via UI checkbox
    try {
      if (typeof window !== 'undefined' && window.DEBUG_LOG_INPUT && !this._loggedInputFor.has(carId)) {
        // shallow clone the input for logging to avoid circular structures
        console.log('Game.makeInputFor (carId=' + carId + ')', JSON.parse(JSON.stringify(input)));
        this._loggedInputFor.add(carId);
      }
    } catch (e) {
      // ignore logging errors
    }

    return input;
  }

  castRay(origin, dir, maxDist) {
    let best = { hit: null, dist: maxDist };

    // Check walls
    for (const w of this.world.walls) {
      const d = rayRect(origin, dir, w, maxDist);
      if (d !== null && d < best.dist) {
        best = { hit: "wall", dist: d };
      }
    }

    // Check enemy cars
    for (const car of this.cars) {
      const d = rayCircle(origin, dir, car.pos, car.radius, maxDist);
      if (d !== null && d < best.dist) {
        best = { hit: "enemy", dist: d };
      }
    }

    // Check turrets
    for (const t of this.turrets) {
      const d = rayCircle(origin, dir, t.pos, 10, maxDist);
      if (d !== null && d < best.dist) {
        best = { hit: "turret", dist: d };
      }
    }

    // Check finish
    const dF = rayRect(origin, dir, this.world.finish, maxDist);
    if (dF !== null && dF < best.dist) {
      best = { hit: "finish", dist: dF };
    }

    return best;
  }

  applyAction(car, action, dt) {
    const cfg = CAR_PHYSICS;
    const throttle = clamp(action.throttle ?? 0, -1, 1);
    const steer = clamp(action.steer ?? 0, -1, 1);

    const speed = len(car.vel);
    const steerFactor = clamp(1 - (speed / cfg.TURN_REFERENCE_SPEED), cfg.TURN_MIN_FACTOR, 1);
    car.ang += steer * cfg.TURN_RATE * steerFactor * dt;

    const fwd = rot(car.ang);
    const right = { x: -fwd.y, y: fwd.x };
    let forwardSpeed = car.vel.x * fwd.x + car.vel.y * fwd.y;
    let sideSpeed = car.vel.x * right.x + car.vel.y * right.y;

    if (throttle > 0.02) {
      if (forwardSpeed < -5) {
        // braking from reverse before accelerating forward
        const brake = cfg.BRAKE_FORCE * throttle * dt;
        forwardSpeed = Math.min(0, forwardSpeed + brake);
      } else {
        forwardSpeed += cfg.ACCEL_FWD * throttle * dt;
      }
    } else if (throttle < -0.02) {
      if (forwardSpeed > 5) {
        // braking while moving forward
        const brake = cfg.BRAKE_FORCE * -throttle * dt;
        forwardSpeed = Math.max(0, forwardSpeed - brake);
      } else {
        forwardSpeed += cfg.ACCEL_REV * throttle * dt;
      }
    } else if (Math.abs(forwardSpeed) > 0.01) {
      // natural slow-down when throttle is released
      const idle = Math.min(Math.abs(forwardSpeed), cfg.IDLE_BRAKE * dt);
      forwardSpeed -= Math.sign(forwardSpeed) * idle;
    }

    // aerodynamic and tire drag
    const longDecay = Math.exp(-cfg.DRAG_LONGITUDINAL * dt);
    const latDecay = Math.exp(-cfg.DRAG_LATERAL * dt);
    forwardSpeed *= longDecay;
    sideSpeed *= latDecay;

    const aeroStrength = Math.exp(-cfg.DRAG_AERO * (speed / cfg.MAX_SPEED) * dt);
    forwardSpeed *= aeroStrength;
    sideSpeed *= aeroStrength;

    // clamp components
    forwardSpeed = clamp(forwardSpeed, -cfg.MAX_SPEED_REV, cfg.MAX_SPEED_FWD);
    const maxSide = cfg.MAX_SPEED * 0.65;
    sideSpeed = clamp(sideSpeed, -maxSide, maxSide);

    car.vel = add(mul(fwd, forwardSpeed), mul(right, sideSpeed));

    // clamp overall speed for safety
    const ns = len(car.vel);
    if (ns > cfg.MAX_SPEED) car.vel = mul(norm(car.vel), cfg.MAX_SPEED);

    // shooting
    if (action.shoot && car.shootCd <= 0) {
      car.shootCd = 0.25;
      const dir = rot(car.ang + action.aimAngle);
      const muzzle = add(car.pos, mul(dir, car.radius + 6));
      this.bullets.push({
        pos: muzzle,
        vel: mul(dir, 520),
        owner: "car",
        ownerId: car.id,
        dmg: 12,
        ttl: 1.4,
      });
    }
  }

  integrateCar(car, dt) {
    if (car.hp <= 0) return;

    // residual ground drag so cars eventually stop if inputs zero
    const groundDrag = Math.exp(-0.45 * dt);
    car.vel = mul(car.vel, groundDrag);

    // move
    car.pos = add(car.pos, mul(car.vel, dt));

    // collisions vs walls
    for (const w of this.world.walls) {
      const r = circleRectResolve(car.pos, car.radius, w);
      if (r.hit) {
        car.pos = r.pos;
        car.vel = reflect(car.vel, r.n, 0.15);
      }
    }

    // finish check
    if (this.pointInRect(car.pos, this.world.finish)) {
      car.reachedFinish = true;
    }
  }

  stepTurrets(dt) {
    for (const t of this.turrets) {
      t.cd = Math.max(0, t.cd - dt);
      if (t.cd > 0) continue;

      // target ближайший живой
      const alive = this.cars.filter(c => c.hp > 0);
      if (!alive.length) continue;

      alive.sort((a,b) => len(sub(a.pos, t.pos)) - len(sub(b.pos, t.pos)));
      const target = alive[0];
      const to = sub(target.pos, t.pos);
      const dist = len(to);

      if (dist < 520) {
        t.cd = 0.65 + this.rng()*0.25; // чуть рандома, но детерминированно
        const dir = norm(to);

        this.bullets.push({
          pos: add(t.pos, mul(dir, 14)),
          vel: mul(dir, 420),
          owner: "turret",
          ownerId: t.id,
          dmg: 8,
          ttl: 1.9,
        });
      }
    }
  }

  stepBullets(dt) {
    const next = [];
    for (const b of this.bullets) {
      b.ttl -= dt;
      if (b.ttl <= 0) continue;

      b.pos = add(b.pos, mul(b.vel, dt));

      // collide with walls: disappear
      let hitWall = false;
      for (const w of this.world.walls) {
        if (this.pointInRect(b.pos, w)) { hitWall = true; break; }
      }
      if (hitWall) continue;

      // collide with cars
      for (const car of this.cars) {
        if (car.hp <= 0) continue;
        if (b.owner === "car" && b.ownerId === car.id) continue;

        const d = len(sub(b.pos, car.pos));
        if (d <= car.radius) {
          car.hp = Math.max(0, car.hp - b.dmg);
          // kill credit
          if (car.hp === 0 && b.owner === "car") {
            this.cars[b.ownerId].kills += 1;
          }
          hitWall = true;
          break;
        }
      }
      if (hitWall) continue;

      next.push(b);
    }
    this.bullets = next;
  }

  checkWin() {
    const alive = this.cars.filter(c => c.hp > 0);
    if (alive.length === 1) {
      this.winner = alive[0].id;
      this.winReason = "kill";
      return;
    }
    if (alive.length === 0) {
      this.winner = -1;
      this.winReason = "draw";
      return;
    }

    // finish имеет приоритет: кто первый достиг, тот победил
    const a = this.cars[0], b = this.cars[1];
    if (a.reachedFinish && !b.reachedFinish) { this.winner = 0; this.winReason = "finish"; }
    else if (b.reachedFinish && !a.reachedFinish) { this.winner = 1; this.winReason = "finish"; }
    else if (a.reachedFinish && b.reachedFinish) {
      // оба в финише — по времени попадания надо хранить, но для MVP ничья
      this.winner = -1;
      this.winReason = "draw";
    }
  }

  pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  debugText() {
    const a = this.cars[0], b = this.cars[1];
    const w = this.winner;
    const head = w === null ? "RUNNING" : (w === -1 ? `DRAW (${this.winReason})` : `WINNER: ${this.botNames[w]} (${this.winReason})`);
    return [
      head,
      `t=${this.time.toFixed(2)} seed=${this.seed}`,
      `A: hp=${a.hp.toFixed(0)} kills=${a.kills} pos=(${a.pos.x.toFixed(1)},${a.pos.y.toFixed(1)})`,
      `B: hp=${b.hp.toFixed(0)} kills=${b.kills} pos=(${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)})`,
      `bullets=${this.bullets.length} turrets=${this.turrets.length}`,
      "",
      `A lastAction=${JSON.stringify(a.lastAction)}`,
      `B lastAction=${JSON.stringify(b.lastAction)}`,
    ].join("\n");
  }
}

// helper for input
makeWorld.prototype?.finishCenter; // noop
// proper method:
