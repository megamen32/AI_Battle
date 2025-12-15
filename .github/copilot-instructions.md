# AI Coding Instructions for Bot Battle Arena

## Project Overview
**Bot Battle Arena** is a competitive 2D tank racing simulation where AI agents navigate mazes, engage in combat, and race to a finish line while avoiding turrets and bullets. This is a **deterministic physics engine** (fixed 60 Hz timestep) with raycasting vision and ballistic combat.

Two game variants exist:
- `arena/`: Combat focus with turrets, pickup health zones
- `arena_tank/`: Dueling variant (less explored)

## Architecture

### Three Core Layers

#### 1. **Engine** (`engine/`)
- **`game.js`**: Simulation orchestrator
  - Owns physics integration, collision resolution, raycast vision, win conditions
  - `step(dt)` calls bot decision → physics → bullet update → collision checks
  - **Key pattern**: Bot input is **sandboxed** via `safeDecide()` with structuredClone + try-catch
  - Returns deeply-structured input object with world state; bots **cannot mutate** it

- **`world.js`**: Hardcoded map (walls, finish line, turret placement, spawn points)
  - Axis-aligned rect obstacles; finish zone is 200×200 box
  - 10 turrets total; 2 spawn points; ~3 distinct zones (start maze → arena → finish)

- **`math.js`**: Collision primitives (no physics library)
  - Vector ops: `add`, `sub`, `mul`, `norm`, `len`, `dot`, `rot`
  - Ray-cast: `rayRect()`, `rayCircle()` (both SAT/parametric, return hit distance)
  - Circle-rect collision: `circleRectResolve()` with normal + penetration
  - Deterministic RNG: `lcg()` (Linear Congruential Generator)
  - All output 2D `{x, y}` objects; no external geometry lib

- **`render.js`**: Canvas rendering + debug overlays
  - Draws cars, bullets, walls, raycasts (if debug flag on)
  - Camera system: zoom + pan (right-click drag)

#### 2. **Bot Interface** (`bots/botA.js`, `botB.js`)
Every bot **exports single function**:
```javascript
export function decide(input) {
  return { throttle, steer, shoot, aimAngle };
}
```

**Input Object** (car-local coordinates; x=forward, y=right):
- `t`: game time (seconds)
- `me`: `{pos, vel, ang, hp, shootCd, radius}`
- `enemy`: `{pos, vel, ang, hp, relPos, shootCd, radius}`
- `vision`: array of 9 raycasts `{angle, hit: "wall"|null, dist, hitPosLocal}`
- `finishRel`: `{x, y}` local offset to finish center
- `sense`: `{bullets: [...], turrets: [...]}` nearby objects with local pos/vel
- `rules`: `{maxSpeed: 360}`

**Output** (all values clamped to [-1, 1]):
- `throttle`: -1 = full reverse, 0 = coast, 1 = full forward
- `steer`: -1 = hard left, 0 = straight, 1 = hard right
- `shoot`: boolean
- `aimAngle`: relative local angle offset (added to me.ang internally by engine)

**Critical invariant**: Input is **immutable** (structuredClone'd). Safe to ignore edge cases.

#### 3. **UI & Bootstrap** (`main.js`, `index.html`, `style.css`)
- WebModule dynamic import (no bundler)
- Debug overlays: ray visualization, car state, hit detection
- Seed-based deterministic replays with **bot swapping**: odd seeds swap bot positions (fairness)
- Reset button generates new seed and updates UI
- Bot selection validation: prevents selecting same script for both positions
- Fast simulation mode tracks wins by bot script (not position)

## Key Design Patterns

### 1. **Local Coordinate Transform**
```javascript
// World: x=right, y=down. Local: x=forward, y=right
const ca = Math.cos(me.ang), sa = Math.sin(me.ang);
function toLocal(v) {
  return { x: v.x*ca + v.y*sa, y: -v.x*sa + v.y*ca };
}
```
**Every bot uses this.** Most of input is already in local coords. Velocities require conversion.

### 2. **Intercept Solving (Ballistic Lead)**
Example from botA (lines 63–104):
- Solves quadratic: `||pos + vel·t|| = bulletSpeed·t`
- Returns intercept time + aim local offset
- Used for accurate targeting, not just sign-based shooting
- Handles zero-velocity case (linear solver)

### 3. **Wall Avoidance via Raycasts**
Pattern (botA lines 260–278):
```javascript
let wallAvoid = 0;
for (const r of vision) {
  if (r.hit !== "wall") continue;
  if (r.dist >= SAFE_WALL) continue;
  
  const k = (SAFE_WALL - r.dist) / SAFE_WALL; // 0..1 risk
  const frontW = Math.abs(r.angle) < 0.35 ? 2.6 : 1.2; // more weight front
  const sideSign = r.angle > 0 ? 1 : -1;
  wallAvoid += -sideSign * k * frontW;
}
```
- Risk model: exponential-ish (SAFE_WALL - dist) / SAFE_WALL
- Front rays get 2–3× weight vs sides
- Steer += wallAvoid weighting (~1.15)

### 4. **Decision Tree: Fight vs Finish**
Example (botA lines 179–193):
```javascript
const forceFinish = enemy.hp === 0 || finishDist < FORCE_FINISH_DIST || lowHP || turretRisk > 0.65;
const wantEngage = !forceFinish && enemyAhead && enemyDist < ENGAGE_DIST && ...;
const target = wantEngage ? enemyRel : finishRel;
```
- Clear priority: finish if low HP, enemy dead, or turret danger
- Engage only if ahead, close, and HP advantage clear
- Reuse same steering/speed code; just swap target

### 5. **Throttle & Speed Control**
Separate from steering; smooth P-controller:
```javascript
const spdErr = desiredSpeed - currentForwardSpeed;
throttle = clamp(spdErr / 240, -1, 1);
```
- desiredSpeed depends on turn sharpness, front wall proximity, panic
- Hard brake (-1) only if wall < 32px ahead
- Lateral sliding penalizes throttle (stability)

### 6. **Stuck Detection**
State persistence (botA lines 158–165):
```javascript
const moved = Math.hypot(dx, dy);
if (moved < 2.2) S.stuckT += dt;
else S.stuckT = Math.max(0, S.stuckT - dt * 0.5);
const stuck = S.stuckT > 0.7;
```
- Hysteresis: easier to detect stuck than to exit
- Escape: reverse + hard steer to wider wall side

## Common Pitfalls & Conventions

1. **Coordinate System**: World Y increases downward; input vision angles are relative to me.ang. Double-check local transforms in any new targeting code.

2. **Physics Timestep**: Fixed dt=1/60 (16.67ms). Bot code can't change this; assume deterministic replay.

3. **Vision Raycasts**: 9 rays at [-1.2, -0.8, ..., 0, ..., 1.2] radians relative. Missing gap at far angles. Use `nearestRay(vision, angle)` to find closest ray if interpolation needed.

4. **Bullet Dodge**: Use **perpendicular** direction (cross product) not position sign. Dodging along velocity perp is strongest evasion (botA lines 341–350).

5. **Shooting**: Turrets fire every ~1 sec; bots have shootCd. Check `me.shootCd <= 0` before shooting. LoS check is soft (raycast distance < target distance × 0.92); allow slight block if enemy <110px away.

6. **Speed Tuning**: `maxSpeed = 360` is nominal. Accelerating takes time (throttle ÷ 240 = spdErr). Don't assume instant velocity changes.

7. **Input Clipping**: All action outputs auto-clipped to [-1, 1]. No need to guard; engine does it.

8. **Relative Velocity**: Enemy relVel is computed from delta over one frame `(relPos_t - relPos_t-1) / dt`. Small dt can amplify noise; valid pattern to smooth or clamp.

## Testing & Debugging

- **Debug Overlay**: Check "Rays", "Ray hits", "Car info" to visualize vision & collisions
- **Log Input**: Check "Log input once" to dump full decision input to console (one snapshot)
- **Replay**: Seed value in UI is read but not set; matches `Game { seed }` internal
- **Bot Swap**: Dropdown selectors allow botA vs botA or botB vs botB for testing

## File Patterns

- Bot AI logic: ~200–400 lines; state in module-level closure
- Utility functions (clamp, hypot2, wrapPI) defined per-bot, not shared
- No dependencies beyond browser globals (Math, structuredClone, console)
- Determinism: seed drives world generation + physics RNG; bots must be pure (no Date.now() in decide)

## References

- **Intercept math**: `solveIntercept()` in botA is complete; botB approximates
- **Wall follow**: botA's weighted ray model is sophisticated; botB uses simpler logic
- **Shooter config**: SHOOT_DIST (~380px), SHOOT_FOV (~0.33 rad), BULLET_SPEED (520) are tunables tuned per-bot
