import { BOT3_CONFIG } from "./bot3Policy.js";

const STORAGE_KEY = "bot3BrainState:v2";

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function initArray(len, scale = 0.08) {
  const arr = new Array(len);
  for (let i = 0; i < len; i++) arr[i] = randn() * scale;
  return arr;
}

const defaultBrain = (() => {
  const hidden = BOT3_CONFIG.hiddenSize;
  const obs = BOT3_CONFIG.obsSize;
  const act = BOT3_CONFIG.actionSize;
  return {
    version: 2,
    obsSize: obs,
    hiddenSize: hidden,
    actionSize: act,
    core: {
      w1: initArray(hidden * obs),
      b1: new Array(hidden).fill(0),
    },
    actor: {
      wMean: initArray(act * hidden),
      bMean: new Array(act).fill(0),
      logStd: new Array(act).fill(Math.log(0.6)),
      wShoot: initArray(hidden),
      bShoot: 0,
    },
    critic: {
      wValue: initArray(hidden),
      bValue: 0,
    },
  };
})();

let runtimeBrain = structuredClone(defaultBrain);
let lastSavedAt = null;

function arraysMatch(arr, len) {
  return Array.isArray(arr) && arr.length === len;
}

function sanitizeBrain(brain) {
  if (!brain || typeof brain !== "object") return structuredClone(defaultBrain);
  if (brain.version !== defaultBrain.version) return structuredClone(defaultBrain);
  if (brain.obsSize !== BOT3_CONFIG.obsSize || brain.hiddenSize !== BOT3_CONFIG.hiddenSize) {
    return structuredClone(defaultBrain);
  }

  const safe = structuredClone(defaultBrain);

  if (brain.core) {
    if (arraysMatch(brain.core.w1, BOT3_CONFIG.hiddenSize * BOT3_CONFIG.obsSize)) safe.core.w1 = brain.core.w1.slice();
    if (arraysMatch(brain.core.b1, BOT3_CONFIG.hiddenSize)) safe.core.b1 = brain.core.b1.slice();
  }

  if (brain.actor) {
    if (arraysMatch(brain.actor.wMean, BOT3_CONFIG.actionSize * BOT3_CONFIG.hiddenSize)) safe.actor.wMean = brain.actor.wMean.slice();
    if (arraysMatch(brain.actor.bMean, BOT3_CONFIG.actionSize)) safe.actor.bMean = brain.actor.bMean.slice();
    if (arraysMatch(brain.actor.logStd, BOT3_CONFIG.actionSize)) safe.actor.logStd = brain.actor.logStd.slice();
    if (arraysMatch(brain.actor.wShoot, BOT3_CONFIG.hiddenSize)) safe.actor.wShoot = brain.actor.wShoot.slice();
    if (typeof brain.actor.bShoot === "number") safe.actor.bShoot = brain.actor.bShoot;
  }

  if (brain.critic) {
    if (arraysMatch(brain.critic.wValue, BOT3_CONFIG.hiddenSize)) safe.critic.wValue = brain.critic.wValue.slice();
    if (typeof brain.critic.bValue === "number") safe.critic.bValue = brain.critic.bValue;
  }

  return safe;
}

function loadStoredBrain() {
  if (typeof localStorage === "undefined") {
    runtimeBrain = structuredClone(defaultBrain);
    return runtimeBrain;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      runtimeBrain = structuredClone(defaultBrain);
      return runtimeBrain;
    }
    const parsed = JSON.parse(saved);
    if (parsed?.brain) {
      runtimeBrain = sanitizeBrain(parsed.brain);
      lastSavedAt = parsed.savedAt ?? null;
    } else {
      runtimeBrain = structuredClone(defaultBrain);
    }
  } catch (err) {
    console.warn("Failed to load bot3 brain:", err);
    runtimeBrain = structuredClone(defaultBrain);
  }

  return runtimeBrain;
}

function saveBrainState(brain = runtimeBrain) {
  if (typeof localStorage === "undefined") return null;
  try {
    lastSavedAt = Date.now();
    const payload = { brain, savedAt: lastSavedAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return lastSavedAt;
  } catch (err) {
    console.warn("Failed to save bot3 brain:", err);
    return null;
  }
}

export function getBrain() {
  return runtimeBrain;
}

export function setBrain(brain) {
  runtimeBrain = sanitizeBrain(brain);
  return runtimeBrain;
}

export function commitBrain(brain) {
  const updated = setBrain(brain);
  saveBrainState(updated);
  return updated;
}

export function saveBrain() {
  return saveBrainState(runtimeBrain);
}

export function loadBrain() {
  return loadStoredBrain();
}

export function resetBrain() {
  runtimeBrain = structuredClone(defaultBrain);
  saveBrainState(runtimeBrain);
  return runtimeBrain;
}

export function getDefaultBrain() {
  return structuredClone(defaultBrain);
}

export function getLastSavedAt() {
  return lastSavedAt;
}

loadStoredBrain();
