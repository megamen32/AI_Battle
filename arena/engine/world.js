import { lcg } from "./math.js";

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 2500;
const BORDER = 40;
const CAR_RADIUS = 14;

const PRESET_BUILDERS = [
  makePreset1,
  makePreset2,
  makePreset3,
  makePreset4,
  makePreset5,
];

export function makeWorld(options = {}) {
  const {
    seed = 1337,
    swapSpawns = false,
    presetId = 0,
    randomPreset = false,
  } = options;

  let presetIndex = Math.max(0, Math.min(PRESET_BUILDERS.length - 1, Math.floor(presetId || 0)));
  if (randomPreset) {
    const rng = typeof seed === "number" ? lcg(seed) : Math.random;
    presetIndex = Math.floor(rng() * PRESET_BUILDERS.length);
  }

  let world = PRESET_BUILDERS[presetIndex](seed);
  world.presetId = presetIndex;
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

function makePreset1() {
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

function makePreset2() {
  const walls = outerWalls();

  // длинный коридор вдоль верхней части карты
  walls.push({ x: 120, y: 260, w: 1500, h: 70 });
  walls.push({ x: 120, y: 620, w: 1500, h: 70 });
  walls.push({ x: 1620, y: 260, w: 70, h: 360 });

  // S-поворот
  walls.push({ x: 1900, y: 260, w: 900, h: 70 });
  walls.push({ x: 1900, y: 680, w: 900, h: 70 });
  walls.push({ x: 2800, y: 260, w: 70, h: 420 });
  walls.push({ x: 2800, y: 680, w: 420, h: 70 });
  walls.push({ x: 3220, y: 680, w: 70, h: 340 });

  // нижний коридор
  walls.push({ x: 150, y: 1180, w: 1200, h: 70 });
  walls.push({ x: 450, y: 1560, w: 900, h: 70 });
  walls.push({ x: 1350, y: 1180, w: 70, h: 450 });
  walls.push({ x: 1350, y: 1560, w: 1200, h: 70 });

  // центр с препятствиями
  const midBlocks = [
    { x: 1900, y: 1080, w: 260, h: 220 },
    { x: 2250, y: 1420, w: 320, h: 210 },
    { x: 2600, y: 1040, w: 260, h: 260 },
    { x: 3020, y: 1240, w: 360, h: 220 },
  ];
  walls.push(...midBlocks);

  const finish = { x: 3380, y: 1520, w: 320, h: 320 };
  const spawns = [
    { x: 220, y: 400, a: 0 },
    { x: 220, y: 520, a: 0 },
  ];

  const turrets = [
    { x: 700, y: 460 },
    { x: 1100, y: 460 },
    { x: 1700, y: 500 },
    { x: 2050, y: 520 },
    { x: 2400, y: 540 },
    { x: 2850, y: 520 },
    { x: 3200, y: 560 },
    { x: 1700, y: 1350 },
    { x: 2050, y: 1650 },
    { x: 2420, y: 1480 },
    { x: 2850, y: 1680 },
    { x: 3300, y: 1340 },
    { x: 3550, y: 1680 },
  ];

  return { walls, finish, spawns, turrets };
}

function makePreset3() {
  const walls = outerWalls();

  // арена с островами
  walls.push({ x: 300, y: 300, w: 200, h: 900 });
  walls.push({ x: 300, y: 1450, w: 200, h: 700 });
  walls.push({ x: 650, y: 300, w: 600, h: 200 });
  walls.push({ x: 650, y: 900, w: 600, h: 200 });
  walls.push({ x: 650, y: 1500, w: 600, h: 200 });
  walls.push({ x: 650, y: 2000, w: 600, h: 200 });

  walls.push({ x: 1400, y: 600, w: 400, h: 400 });
  walls.push({ x: 1400, y: 1400, w: 400, h: 400 });
  walls.push({ x: 1900, y: 900, w: 300, h: 300 });
  walls.push({ x: 1900, y: 1600, w: 300, h: 300 });

  walls.push({ x: 2300, y: 320, w: 700, h: 200 });
  walls.push({ x: 2300, y: 820, w: 700, h: 200 });
  walls.push({ x: 2300, y: 1420, w: 700, h: 200 });
  walls.push({ x: 2300, y: 1950, w: 700, h: 200 });

  walls.push({ x: 3200, y: 320, w: 200, h: 1800 });

  const finish = { x: 3450, y: 1080, w: 320, h: 320 };
  const spawns = [
    { x: 180, y: 420, a: 0.1 },
    { x: 180, y: 640, a: 0.1 },
  ];

  const turrets = [
    { x: 500, y: 700 },
    { x: 520, y: 1200 },
    { x: 1000, y: 650 },
    { x: 1020, y: 1900 },
    { x: 1600, y: 850 },
    { x: 1600, y: 1250 },
    { x: 1600, y: 1850 },
    { x: 2050, y: 1350 },
    { x: 2440, y: 1180 },
    { x: 2440, y: 1720 },
    { x: 2720, y: 520 },
    { x: 2720, y: 2100 },
    { x: 3300, y: 1160 },
    { x: 3620, y: 1220 },
  ];

  return { walls, finish, spawns, turrets };
}

function makePreset4() {
  const walls = outerWalls();

  // вертикальные каньоны с пролетами
  const columns = [
    { x: 320, segments: [{ y: 200, h: 380 }, { y: 880, h: 540 }, { y: 1680, h: 300 }] },
    { x: 720, segments: [{ y: 200, h: 520 }, { y: 1040, h: 420 }, { y: 1620, h: 420 }] },
    { x: 1120, segments: [{ y: 200, h: 460 }, { y: 940, h: 500 }, { y: 1660, h: 360 }] },
    { x: 1520, segments: [{ y: 200, h: 400 }, { y: 820, h: 420 }, { y: 1320, h: 420 }, { y: 1880, h: 220 }] },
  ];
  for (const col of columns) {
    for (const s of col.segments) {
      walls.push({ x: col.x, y: s.y, w: 200, h: s.h });
    }
  }

  // центральные стены
  walls.push({ x: 2000, y: 600, w: 900, h: 140 });
  walls.push({ x: 2000, y: 1100, w: 900, h: 140 });
  walls.push({ x: 2000, y: 1600, w: 900, h: 140 });
  walls.push({ x: 2600, y: 400, w: 140, h: 1600 });

  // бункеры, за которыми спрятан финиш
  walls.push({ x: 3200, y: 500, w: 420, h: 560 });
  walls.push({ x: 3200, y: 1320, w: 420, h: 560 });

  const finish = { x: 3400, y: 1140, w: 400, h: 220 };

  const spawns = [
    { x: 200, y: 420, a: 0 },
    { x: 200, y: 740, a: 0 },
  ];

  const turrets = [
    { x: 520, y: 320 },
    { x: 520, y: 1020 },
    { x: 520, y: 1760 },
    { x: 920, y: 600 },
    { x: 920, y: 1460 },
    { x: 1320, y: 880 },
    { x: 1320, y: 1680 },
    { x: 2100, y: 860 },
    { x: 2100, y: 1360 },
    { x: 2450, y: 1120 },
    { x: 2800, y: 900 },
    { x: 2800, y: 1540 },
    { x: 3250, y: 920 },
    { x: 3250, y: 1500 },
  ];

  return { walls, finish, spawns, turrets };
}

function makePreset5() {
  const walls = outerWalls();

  // диагональная трасса
  walls.push({ x: 200, y: 200, w: 400, h: 200 });
  walls.push({ x: 500, y: 500, w: 400, h: 200 });
  walls.push({ x: 800, y: 800, w: 400, h: 200 });
  walls.push({ x: 1100, y: 1100, w: 400, h: 200 });
  walls.push({ x: 1400, y: 1400, w: 400, h: 200 });
  walls.push({ x: 1700, y: 1700, w: 400, h: 200 });
  walls.push({ x: 2000, y: 2000, w: 400, h: 200 });
  walls.push({ x: 2300, y: 1700, w: 500, h: 200 });
  walls.push({ x: 2600, y: 1400, w: 500, h: 200 });
  walls.push({ x: 2900, y: 1100, w: 500, h: 200 });
  walls.push({ x: 3200, y: 800, w: 500, h: 200 });

  // центральные ловушки
  walls.push({ x: 1500, y: 400, w: 200, h: 400 });
  walls.push({ x: 2000, y: 600, w: 200, h: 400 });
  walls.push({ x: 2500, y: 400, w: 200, h: 400 });
  walls.push({ x: 1800, y: 900, w: 260, h: 260 });
  walls.push({ x: 2200, y: 1200, w: 260, h: 260 });
  walls.push({ x: 2600, y: 1500, w: 260, h: 260 });

  const finish = { x: 3320, y: 360, w: 360, h: 260 };
  const spawns = [
    { x: 220, y: 430, a: 0.6 },
    { x: 220, y: 660, a: 0.6 },
  ];

  const turrets = [
    { x: 450, y: 320 },
    { x: 780, y: 640 },
    { x: 1110, y: 980 },
    { x: 1400, y: 1260 },
    { x: 1700, y: 1560 },
    { x: 2000, y: 1860 },
    { x: 2420, y: 1580 },
    { x: 2720, y: 1280 },
    { x: 3020, y: 980 },
    { x: 3320, y: 680 },
    { x: 3540, y: 480 },
    { x: 2260, y: 760 },
    { x: 2560, y: 1060 },
    { x: 2860, y: 1360 },
  ];

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
