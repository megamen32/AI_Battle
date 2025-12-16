const STORAGE_KEY = "bot3BrainState:v1";

const defaultWeights = {
  version: 1,
  steer: [0.1, 0.8, -0.2, 1.1, -0.6, 0.4, -0.5, 0.2, 0.5],
  throttle: [0.6, -0.5, -0.3, 0.2, -0.1, 0.4, -0.6, -0.4, 0.8],
  shoot: [-0.2, 0.4, -0.4, -0.1, -0.1, 0.35, -0.5, 0.1, 0.2],
  shootBias: 0.2,
};

let runtimeBrain = cloneBrain(defaultWeights);
let lastSavedAt = null;

function cloneBrain(brain) {
  return JSON.parse(JSON.stringify(brain));
}

function loadStoredBrain() {
  if (typeof localStorage === "undefined") {
    runtimeBrain = cloneBrain(defaultWeights);
    return runtimeBrain;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      runtimeBrain = cloneBrain(defaultWeights);
      return runtimeBrain;
    }
    const parsed = JSON.parse(saved);
    if (parsed?.brain) {
      runtimeBrain = sanitizeBrain(parsed.brain);
      lastSavedAt = parsed.savedAt ?? null;
    } else {
      runtimeBrain = cloneBrain(defaultWeights);
    }
  } catch (err) {
    console.warn("Failed to load bot3 brain:", err);
    runtimeBrain = cloneBrain(defaultWeights);
  }

  return runtimeBrain;
}

function sanitizeBrain(brain) {
  const safe = cloneBrain(defaultWeights);
  if (!brain) return safe;
  if (Array.isArray(brain.steer) && brain.steer.length === safe.steer.length) safe.steer = brain.steer.slice();
  if (Array.isArray(brain.throttle) && brain.throttle.length === safe.throttle.length) safe.throttle = brain.throttle.slice();
  if (Array.isArray(brain.shoot) && brain.shoot.length === safe.shoot.length) safe.shoot = brain.shoot.slice();
  if (typeof brain.shootBias === "number") safe.shootBias = brain.shootBias;
  return safe;
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
  runtimeBrain = cloneBrain(defaultWeights);
  saveBrainState(runtimeBrain);
  return runtimeBrain;
}

export function getDefaultBrain() {
  return cloneBrain(defaultWeights);
}

export function getLastSavedAt() {
  return lastSavedAt;
}

loadStoredBrain();
