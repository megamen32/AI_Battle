const LOG_TWO_PI = Math.log(2 * Math.PI);
const HALF_LOG_TWO_PI_E = 0.5 * Math.log(2 * Math.PI * Math.E);
const EPS = 1e-6;

export const BOT3_CONFIG = {
  obsSize: 48,
  hiddenSize: 48,
  actionSize: 3,
  aimScale: 1.35,
  maxVisionDist: 420,
};

export function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

export function createFeatureExtractor() {
  return {
    prevTime: null,
  };
}

export function buildObservation(extractor, input) {
  const { me, enemy, finishRel, vision, sense } = input;
  const features = new Float64Array(BOT3_CONFIG.obsSize);
  let idx = 0;

  const finishDist = Math.hypot(finishRel.x, finishRel.y);
  const finishNorm = Math.min(1, finishDist / 800);
  const finishAng = Math.atan2(finishRel.y, finishRel.x);

  const enemyDist = Math.hypot(enemy.relPos.x, enemy.relPos.y);
  const enemyNorm = Math.min(1, enemyDist / 600);
  const enemyAng = Math.atan2(enemy.relPos.y, enemy.relPos.x);

  const ca = Math.cos(me.ang);
  const sa = Math.sin(me.ang);
  const velForward = clamp((me.vel.x * ca + me.vel.y * sa) / 360, -1, 1);
  const velRight = clamp((-me.vel.x * sa + me.vel.y * ca) / 360, -1, 1);
  const speedNorm = clamp(Math.hypot(me.vel.x, me.vel.y) / 360, 0, 1);

  features[idx++] = clamp(me.hp / 100, 0, 1);
  features[idx++] = clamp(enemy.hp / 100, 0, 1);
  features[idx++] = finishNorm;
  features[idx++] = clamp(finishRel.x / 800, -1, 1);
  features[idx++] = clamp(finishRel.y / 800, -1, 1);
  features[idx++] = Math.cos(finishAng);
  features[idx++] = Math.sin(finishAng);
  features[idx++] = enemyNorm;
  features[idx++] = clamp(enemy.relPos.x / 600, -1, 1);
  features[idx++] = clamp(enemy.relPos.y / 600, -1, 1);
  features[idx++] = Math.cos(enemyAng);
  features[idx++] = Math.sin(enemyAng);
  features[idx++] = velForward;
  features[idx++] = velRight;
  features[idx++] = speedNorm;
  features[idx++] = clamp(me.shootCd / 0.5, 0, 1);

  const bullets = sense?.bullets ?? [];
  const turrets = sense?.turrets ?? [];

  let bulletPressure = 0;
  for (const b of bullets) {
    const dist = Math.hypot(b.rel.x, b.rel.y);
    bulletPressure += Math.max(0, 1 - Math.min(1, dist / 260));
  }
  features[idx++] = clamp(bulletPressure / 3, 0, 1);

  let turretPressure = 0;
  for (const t of turrets) {
    const dist = Math.hypot(t.rel.x, t.rel.y);
    turretPressure += Math.max(0, 1 - Math.min(1, dist / 420));
  }
  features[idx++] = clamp(turretPressure / 3, 0, 1);

  for (let i = 0; i < 2; i++) {
    const b = bullets[i];
    if (b) {
      features[idx++] = clamp(b.rel.x / 300, -1, 1);
      features[idx++] = clamp(b.rel.y / 300, -1, 1);
      features[idx++] = Math.min(1, Math.hypot(b.rel.x, b.rel.y) / 260);
    } else {
      features[idx++] = 0;
      features[idx++] = 0;
      features[idx++] = 0;
    }
  }

  for (let i = 0; i < 2; i++) {
    const t = turrets[i];
    if (t) {
      features[idx++] = clamp(t.rel.x / 500, -1, 1);
      features[idx++] = clamp(t.rel.y / 500, -1, 1);
    } else {
      features[idx++] = 0;
      features[idx++] = 0;
    }
  }

  for (const ray of vision || []) {
    features[idx++] = Math.min(1, ray.dist / BOT3_CONFIG.maxVisionDist);
    let code = 0;
    if (ray.hit === "wall") code = 1;
    else if (ray.hit === "enemy") code = -0.5;
    else if (ray.hit === "turret") code = 0.5;
    else if (ray.hit === "finish") code = 0.2;
    features[idx++] = code;
  }

  const timeNorm = extractor.prevTime == null ? 0 : Math.tanh((input.t - extractor.prevTime) / 10);
  extractor.prevTime = input.t;
  features[idx++] = timeNorm;
  features[idx++] = 1;

  while (idx < features.length) features[idx++] = 0;
  return features;
}

function denseMultiply(outSize, inSize, weights, bias, input, out) {
  for (let o = 0; o < outSize; o++) {
    let sum = bias[o] || 0;
    const base = o * inSize;
    for (let i = 0; i < inSize; i++) {
      sum += weights[base + i] * input[i];
    }
    out[o] = sum;
  }
}

export function evaluatePolicy(brain, obs) {
  const hidden = new Float64Array(brain.hiddenSize);
  denseMultiply(brain.hiddenSize, brain.obsSize, brain.core.w1, brain.core.b1, obs, hidden);
  for (let i = 0; i < hidden.length; i++) {
    hidden[i] = Math.tanh(hidden[i]);
  }

  const mean = new Float64Array(brain.actionSize);
  denseMultiply(brain.actionSize, brain.hiddenSize, brain.actor.wMean, brain.actor.bMean, hidden, mean);

  const logStd = new Float64Array(brain.actor.logStd.length);
  for (let i = 0; i < brain.actor.logStd.length; i++) {
    logStd[i] = brain.actor.logStd[i];
  }

  let shootLogit = brain.actor.bShoot || 0;
  for (let i = 0; i < brain.hiddenSize; i++) {
    shootLogit += brain.actor.wShoot[i] * hidden[i];
  }
  const shootProb = 1 / (1 + Math.exp(-shootLogit));

  let value = brain.critic.bValue || 0;
  for (let i = 0; i < brain.hiddenSize; i++) {
    value += brain.critic.wValue[i] * hidden[i];
  }

  return {
    hidden,
    mean,
    logStd,
    shootLogit,
    shootProb,
    value,
  };
}

function normalSample(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function gaussianLogProb(actionRaw, mean, logStd) {
  const varTerm = Math.exp(2 * logStd);
  const diff = actionRaw - mean;
  return -0.5 * ((diff * diff) / varTerm + 2 * logStd + LOG_TWO_PI);
}

export function actionVectorToControls(vec, shoot) {
  const thr = clamp(vec[0], -1, 1);
  const steer = clamp(vec[1], -1, 1);
  const aim = clamp(vec[2], -1, 1) * BOT3_CONFIG.aimScale;
  return {
    throttle: thr,
    steer,
    shoot: Boolean(shoot),
    aimAngle: aim,
  };
}

export function samplePolicyAction(brain, obs, rng = Math.random) {
  const evalRes = evaluatePolicy(brain, obs);
  const { mean, logStd, shootProb, value } = evalRes;
  const actionRaw = new Float64Array(mean.length);
  const std = logStd.map(ls => Math.exp(ls));
  let logp = 0;

  for (let i = 0; i < mean.length; i++) {
    const noise = normalSample(rng);
    const raw = mean[i] + noise * std[i];
    actionRaw[i] = raw;
    logp += gaussianLogProb(raw, mean[i], logStd[i]);
  }

  const shoot = rng() < shootProb ? 1 : 0;
  logp += shoot ? Math.log(shootProb + EPS) : Math.log(1 - shootProb + EPS);

  const actionVec = Array.from(actionRaw, val => clamp(val, -1, 1));
  const controls = actionVectorToControls(actionVec, shoot);

  return {
    controls,
    rawAction: Array.from(actionRaw),
    action: actionVec,
    shoot,
    logp,
    value,
  };
}

export function logProbFromEval(evalRes, actionRaw, shoot) {
  let logp = 0;
  for (let i = 0; i < evalRes.mean.length; i++) {
    logp += gaussianLogProb(actionRaw[i], evalRes.mean[i], evalRes.logStd[i]);
  }
  logp += shoot
    ? Math.log(evalRes.shootProb + EPS)
    : Math.log(1 - evalRes.shootProb + EPS);
  return logp;
}

export function gaussianEntropy(logStd) {
  let sum = 0;
  for (let i = 0; i < logStd.length; i++) {
    sum += logStd[i] + HALF_LOG_TWO_PI_E;
  }
  return sum;
}
