import { Game } from "./engine/game.js";
import { GAME_STEP_DT } from "./constants.js";

if (typeof self !== "undefined" && typeof self.window === "undefined") {
  self.window = self;
}

let abortRequested = false;
let cachedBots = null;
let cachedPaths = null;

function ensureLocalStorage(snapshot = []) {
  const store = new Map();
  snapshot.forEach(entry => {
    if (!entry || typeof entry.key !== "string") return;
    store.set(entry.key, entry.value ?? null);
  });
  const storage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      const keys = Array.from(store.keys());
      return keys[index] ?? null;
    },
  };
  Object.defineProperty(storage, "length", {
    get() {
      return store.size;
    }
  });
  globalThis.localStorage = storage;
}

function withQuery(url, slot) {
  const u = new URL(url);
  u.searchParams.set("fastsimSlot", String(slot));
  return u.href;
}

async function loadBots(botPaths = []) {
  const samePaths = cachedPaths && botPaths.length === cachedPaths.length && botPaths.every((p, idx) => p === cachedPaths[idx]);
  if (samePaths && cachedBots) return cachedBots;
  cachedPaths = botPaths.slice();
  cachedBots = await Promise.all(botPaths.map((path, idx) => import(withQuery(path, idx))));
  return cachedBots;
}

function orderBots(seed, modules, randomizeSides) {
  const shouldSwap = randomizeSides && ((seed & 1) === 1);
  if (shouldSwap) {
    return { bots: [modules[1], modules[0]], names: ["B", "A"], botAIndex: 1 };
  }
  return { bots: [modules[0], modules[1]], names: ["A", "B"], botAIndex: 0 };
}

function runSingleMatch(modules, cfg, matchIndex) {
  const seed = (cfg.randomSeed + matchIndex * 997) >>> 0;
  const ordered = orderBots(seed, modules, cfg.randomizeSides);
  const game = new Game({
    seed,
    bots: ordered.bots,
    botNames: ordered.names,
    worldOptions: {
      randomPreset: cfg.randomPreset,
      presetId: cfg.presetId,
    },
  });

  const maxSteps = cfg.maxTime * 60;
  for (let step = 0; step < maxSteps && !game.winner && !abortRequested; step++) {
    for (let s = 0; s < cfg.speed && !game.winner && !abortRequested; s++) {
      game.step(GAME_STEP_DT);
    }
  }

  const botAId = ordered.botAIndex;
  if (game.winner === botAId) return "A";
  if (game.winner === 1 - botAId) return "B";
  return "draw";
}

async function handleRun(config) {
  ensureLocalStorage(config.storageSnapshot || []);
  const modules = await loadBots(config.botPaths || []);
  abortRequested = false;
  for (let i = 0; i < config.matches && !abortRequested; i++) {
    const result = runSingleMatch(modules, config, i);
    self.postMessage({ type: "match", workerId: config.workerId, result });
  }
  const wasAborted = abortRequested;
  abortRequested = false;
  self.postMessage({ type: "done", workerId: config.workerId, aborted: wasAborted });
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "run") {
    handleRun({
      matches: Math.max(0, data.matches || 0),
      speed: Math.max(1, data.speed || 1),
      maxTime: Math.max(10, data.maxTime || 60),
      randomizeSides: !!data.randomizeSides,
      randomPreset: !!data.randomPreset,
      presetId: Math.max(0, Math.min(4, Math.floor(data.presetId ?? 0))),
      botPaths: data.botPaths || [],
      storageSnapshot: data.storageSnapshot || [],
      workerId: data.workerId ?? 0,
      randomSeed: data.randomSeed ?? (Math.random() * 0xFFFFFFFF) >>> 0,
    }).catch(err => {
      self.postMessage({ type: "error", workerId: data.workerId ?? 0, message: err?.message || String(err) });
    });
  } else if (data.type === "abort") {
    abortRequested = true;
  }
};
