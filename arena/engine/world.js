import { lcg } from "./math.js";

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 2500;
const BORDER = 40;
const CAR_RADIUS = 14;

export function makeWorld(options = {}) {
  const {
    procedural = false,
    seed = 1337,
    swapSpawns = false,
  } = options;

  const MAX_ATTEMPTS = 8;
  let attempt = 0;
  let world = procedural ? makeProceduralWorld(seed) : makeDefaultWorld();
  while (procedural && attempt < MAX_ATTEMPTS && !isWorldPassable(world)) {
    const nextSeed = (seed + 1009 * (attempt + 1)) >>> 0;
    world = makeProceduralWorld(nextSeed);
    attempt++;
  }
  if (swapSpawns && world.spawns.length >= 2) {
    world.spawns = [...world.spawns].reverse();
  }
  return world;
}

function outerWalls() {
  return [
    { x: 0, y: 0, w: WORLD_WIDTH, h: BORDER },
    { x: 0, y: WORLD_HEIGHT - BORDER, w: WORLD_WIDTH, h: BORDER },
    { x: 0, y: 0, w: BORDER, h: WORLD_HEIGHT },
    //{ x: WORLD_WIDTH - BORDER, y: 0, w: BORDER, h: WORLD_HEIGHT },
  ];
}

function makeDefaultWorld() {
  const layoutWalls = [
    // Стартовый коридор
    { x: 200, y: 200, w: 1000, h: 60 },
    { x: 200, y: 900, w: 1000, h: 60 },
    { x: 200, y: 260, w: 60, h: 640 },
   // { x: 1140, y: 260, w: 60, h: 640 },

    // Боковые стены арены
    { x: 2600, y: 200, w: 60, h: 1400 },
    { x: 3400, y: 200, w: 900, h: 60 },
    { x: 3400, y: 1400, w: 900, h: 60 },

    // Зигзаг у финиша
    { x: 3600, y: 1600, w: 300, h: 60 },
    { x: 3600, y: 1200, w: 300, h: 60 },
  ];

  const walls = outerWalls().concat(layoutWalls);

  const finish = {
    x: 3750,
    y: 1400,
    w: 200,
    h: 200,
  };

  const spawns = [
    { x: 120, y: 400, a: 0 },   // верхний старт
    { x: 120, y: 700, a: 0 },   // нижний старт
  ];

  const turrets = [
    { x: 800, y: 300 },
    { x: 800, y: 800 },
    { x: 1450, y: 350 },
    { x: 1750, y: 650 },
    { x: 2050, y: 950 },
    { x: 2350, y: 500 },
    { x: 1650, y: 1200 },
    { x: 2750, y: 500 },
    { x: 3050, y: 500 },
    { x: 3350, y: 500 },
    { x: 2750, y: 1100 },
    { x: 3050, y: 1100 },
    { x: 3350, y: 1100 },
    { x: 3550, y: 1150 },
    { x: 3550, y: 1550 },
    { x: 3850, y: 1350 },
  ];

  return { walls, finish, spawns, turrets };
}

function makeProceduralWorld(seed = 1337) {
  const rng = typeof seed === "number" ? lcg(seed) : Math.random;
  const rand = () => rng();

  const startX = 160;
  const startLen = 900;
  const trackStart = startX + startLen;
  const trackEnd = WORLD_WIDTH - 260;
  const trackLen = trackEnd - trackStart;
  const corridorHalf = 150 + rand() * 90;
  const marginY = 320;
  const minCenter = marginY + corridorHalf;
  const maxCenter = WORLD_HEIGHT - marginY - corridorHalf;
  const centerY = minCenter + rand() * (maxCenter - minCenter);
  const walkwayTop = centerY - corridorHalf;
  const walkwayBottom = centerY + corridorHalf;

  const walls = outerWalls();

  // Стартовая безопасная зона
  const startHeight = walkwayBottom - walkwayTop + 120;
  walls.push({ x: startX - 60, y: walkwayTop - 60, w: startLen + 120, h: 40 });
  walls.push({ x: startX - 60, y: walkwayBottom + 20, w: startLen + 120, h: 40 });
  walls.push({ x: startX - 80, y: walkwayTop - 60, w: 40, h: startHeight });
 // walls.push({ x: startX + startLen + 40, y: walkwayTop - 60, w: 40, h: startHeight });

  // Основной коридор
  walls.push({ x: trackStart, y: walkwayTop - 40, w: trackLen, h: 40 });
  walls.push({ x: trackStart, y: walkwayBottom, w: trackLen, h: 40 });

  const gates = [];
  const gateCount = 6;
  for (let i = 0; i < gateCount; i++) {
    const base = trackStart + (i + 1) * (trackLen / (gateCount + 1));
    const gateX = base + (rand() - 0.5) * 120;
    const gateW = 50 + rand() * 30;
    const offset = (rand() - 0.5) * corridorHalf * 1.1;
    const gapCenter = centerY + offset;
    const gapHalf = 60 + rand() * 60;
    const gapTop = Math.max(walkwayTop, gapCenter - gapHalf);
    const gapBottom = Math.min(walkwayBottom, gapCenter + gapHalf);
    if (gapTop > walkwayTop + 5) {
      walls.push({ x: gateX, y: walkwayTop, w: gateW, h: gapTop - walkwayTop });
    }
    if (gapBottom < walkwayBottom - 5) {
      walls.push({ x: gateX, y: gapBottom, w: gateW, h: walkwayBottom - gapBottom });
    }
    gates.push({ x: gateX + gateW / 2, gapCenter });
  }

  // Карманы и укрытия снаружи коридора
  const alcoveCount = 5;
  for (let i = 0; i < alcoveCount; i++) {
    const fromTop = rand() > 0.5;
    const width = 140 + rand() * 200;
    const height = 140 + rand() * 220;
    const x = trackStart + rand() * Math.max(200, trackLen - width - 200);
    const y = fromTop
      ? walkwayTop - height - (40 + rand() * 80)
      : walkwayBottom + (40 + rand() * 80);
    walls.push({ x, y, w: width, h: height });
  }

  // Полу-блоки внутри коридора (прижаты к краям)
  const blockerCount = 4;
  for (let i = 0; i < blockerCount; i++) {
    const topAligned = rand() > 0.5;
    const width = 80 + rand() * 120;
    const height = 80 + rand() * 120;
    const x = trackStart + rand() * Math.max(200, trackLen - width - 200);
    const y = topAligned ? walkwayTop + 10 : walkwayBottom - height - 10;
    walls.push({ x, y, w: width, h: height });
  }

  const finishHeight = Math.min(320, (walkwayBottom - walkwayTop) - 40);
  const finish = {
    x: trackEnd,
    y: centerY - finishHeight / 2,
    w: 220,
    h: finishHeight,
  };

  const spawns = [
    { x: startX + 40, y: centerY - 110, a: 0 },
    { x: startX + 40, y: centerY + 110, a: 0 },
  ];

  const turrets = [];
  for (const gate of gates) {
    turrets.push({ x: gate.x - 80, y: gate.gapCenter - 120 });
    turrets.push({ x: gate.x + 80, y: gate.gapCenter + 120 });
  }
  turrets.push({ x: finish.x - 120, y: walkwayTop + 30 });
  turrets.push({ x: finish.x - 120, y: walkwayBottom - 30 });
  turrets.push({ x: finish.x + finish.w / 2, y: centerY });

  return { walls, finish, spawns, turrets };
}

function isWorldPassable(world) {
  const cellSize = 80;
  const cols = Math.ceil(WORLD_WIDTH / cellSize);
  const rows = Math.ceil(WORLD_HEIGHT / cellSize);
  const margin = CAR_RADIUS + 8;

  const start = world.spawns?.[0] || { x: BORDER * 2, y: BORDER * 2 };
  const finish = {
    x: world.finish.x + world.finish.w / 2,
    y: world.finish.y + world.finish.h / 2,
  };

  const toCell = (p) => ({
    cx: Math.floor(Math.min(Math.max(p.x, 0), WORLD_WIDTH - 1) / cellSize),
    cy: Math.floor(Math.min(Math.max(p.y, 0), WORLD_HEIGHT - 1) / cellSize),
  });
  const cellCenter = (cx, cy) => ({
    x: cx * cellSize + cellSize / 2,
    y: cy * cellSize + cellSize / 2,
  });

  function blockedPoint(point) {
    if (point.x < BORDER || point.x > WORLD_WIDTH - BORDER || point.y < BORDER || point.y > WORLD_HEIGHT - BORDER) return true;
    for (const w of world.walls) {
      if (
        point.x >= w.x - margin &&
        point.x <= w.x + w.w + margin &&
        point.y >= w.y - margin &&
        point.y <= w.y + w.h + margin
      ) {
        return true;
      }
    }
    return false;
  }

  const startCell = toCell(start);
  const targetCell = toCell(finish);
  if (blockedPoint(start) || blockedPoint(finish)) return false;

  const visited = new Array(rows).fill(null).map(() => new Array(cols).fill(false));
  const queue = [];
  const pushCell = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    if (visited[cy][cx]) return;
    const center = cellCenter(cx, cy);
    if (blockedPoint(center)) return;
    visited[cy][cx] = true;
    queue.push({ cx, cy });
  };

  pushCell(startCell.cx, startCell.cy);

  while (queue.length) {
    const { cx, cy } = queue.shift();
    if (Math.abs(cx - targetCell.cx) <= 1 && Math.abs(cy - targetCell.cy) <= 1) return true;
    pushCell(cx + 1, cy);
    pushCell(cx - 1, cy);
    pushCell(cx, cy + 1);
    pushCell(cx, cy - 1);
  }
  return false;
}
