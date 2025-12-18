import {
  createFeatureExtractor as createBot3FeatureExtractor,
  buildObservation as buildBot3Observation,
  samplePolicyAction as sampleBot3PolicyAction,
  evaluatePolicy as evalBot3Policy,
  logProbFromEval as bot3LogProb,
  gaussianEntropy as bot3GaussianEntropy,
} from "./bots/bot3Policy.js";

export function cloneBrainToFloat(source) {
  const brain = source;
  return {
    version: brain.version,
    obsSize: brain.obsSize,
    hiddenSize: brain.hiddenSize,
    actionSize: brain.actionSize,
    core: {
      w1: Float64Array.from(brain.core.w1),
      b1: Float64Array.from(brain.core.b1),
    },
    actor: {
      wMean: Float64Array.from(brain.actor.wMean),
      bMean: Float64Array.from(brain.actor.bMean),
      logStd: Float64Array.from(brain.actor.logStd),
      wShoot: Float64Array.from(brain.actor.wShoot),
      bShoot: brain.actor.bShoot || 0,
    },
    critic: {
      wValue: Float64Array.from(brain.critic.wValue),
      bValue: brain.critic.bValue || 0,
    },
  };
}

export function floatBrainToPlain(brain) {
  return {
    version: brain.version,
    obsSize: brain.obsSize,
    hiddenSize: brain.hiddenSize,
    actionSize: brain.actionSize,
    core: {
      w1: Array.from(brain.core.w1),
      b1: Array.from(brain.core.b1),
    },
    actor: {
      wMean: Array.from(brain.actor.wMean),
      bMean: Array.from(brain.actor.bMean),
      logStd: Array.from(brain.actor.logStd),
      wShoot: Array.from(brain.actor.wShoot),
      bShoot: brain.actor.bShoot,
    },
    critic: {
      wValue: Array.from(brain.critic.wValue),
      bValue: brain.critic.bValue,
    },
  };
}

export function zeroBrainLike(brain) {
  return {
    core: {
      w1: new Float64Array(brain.core.w1.length),
      b1: new Float64Array(brain.core.b1.length),
    },
    actor: {
      wMean: new Float64Array(brain.actor.wMean.length),
      bMean: new Float64Array(brain.actor.bMean.length),
      logStd: new Float64Array(brain.actor.logStd.length),
      wShoot: new Float64Array(brain.actor.wShoot.length),
      bShoot: 0,
    },
    critic: {
      wValue: new Float64Array(brain.critic.wValue.length),
      bValue: 0,
    },
  };
}

export function zeroGradients(grads) {
  grads.core.w1.fill(0);
  grads.core.b1.fill(0);
  grads.actor.wMean.fill(0);
  grads.actor.bMean.fill(0);
  grads.actor.logStd.fill(0);
  grads.actor.wShoot.fill(0);
  grads.actor.bShoot = 0;
  grads.critic.wValue.fill(0);
  grads.critic.bValue = 0;
}

export function scaleBrainGradients(grads, scale) {
  for (let i = 0; i < grads.core.w1.length; i++) grads.core.w1[i] *= scale;
  for (let i = 0; i < grads.core.b1.length; i++) grads.core.b1[i] *= scale;
  for (let i = 0; i < grads.actor.wMean.length; i++) grads.actor.wMean[i] *= scale;
  for (let i = 0; i < grads.actor.bMean.length; i++) grads.actor.bMean[i] *= scale;
  for (let i = 0; i < grads.actor.logStd.length; i++) grads.actor.logStd[i] *= scale;
  for (let i = 0; i < grads.actor.wShoot.length; i++) grads.actor.wShoot[i] *= scale;
  for (let i = 0; i < grads.critic.wValue.length; i++) grads.critic.wValue[i] *= scale;
  grads.actor.bShoot *= scale;
  grads.critic.bValue *= scale;
}

export function createAdamState(brain) {
  return {
    t: 0,
    m: zeroBrainLike(brain),
    v: zeroBrainLike(brain),
  };
}

export function applyAdam(brain, grads, optState, lr) {
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  optState.t += 1;
  const t = optState.t;
  const biasCorr1 = 1 - Math.pow(beta1, t);
  const biasCorr2 = 1 - Math.pow(beta2, t);

  const updateArray = (param, grad, mArr, vArr) => {
    for (let i = 0; i < param.length; i++) {
      const g = grad[i];
      const mVal = mArr[i] = beta1 * mArr[i] + (1 - beta1) * g;
      const vVal = vArr[i] = beta2 * vArr[i] + (1 - beta2) * g * g;
      const mHat = mVal / biasCorr1;
      const vHat = vVal / biasCorr2;
      param[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
    }
  };

  updateArray(brain.core.w1, grads.core.w1, optState.m.core.w1, optState.v.core.w1);
  updateArray(brain.core.b1, grads.core.b1, optState.m.core.b1, optState.v.core.b1);
  updateArray(brain.actor.wMean, grads.actor.wMean, optState.m.actor.wMean, optState.v.actor.wMean);
  updateArray(brain.actor.bMean, grads.actor.bMean, optState.m.actor.bMean, optState.v.actor.bMean);
  updateArray(brain.actor.logStd, grads.actor.logStd, optState.m.actor.logStd, optState.v.actor.logStd);
  updateArray(brain.actor.wShoot, grads.actor.wShoot, optState.m.actor.wShoot, optState.v.actor.wShoot);
  updateArray(brain.critic.wValue, grads.critic.wValue, optState.m.critic.wValue, optState.v.critic.wValue);

  const updateScalar = (paramRef, gradVal, mRef, vRef) => {
    const mVal = beta1 * mRef + (1 - beta1) * gradVal;
    const vVal = beta2 * vRef + (1 - beta2) * gradVal * gradVal;
    const mHat = mVal / biasCorr1;
    const vHat = vVal / biasCorr2;
    return { nextParam: paramRef - lr * mHat / (Math.sqrt(vHat) + eps), nextM: mVal, nextV: vVal };
  };

  const shootUpdate = updateScalar(brain.actor.bShoot, grads.actor.bShoot, optState.m.actor.bShoot, optState.v.actor.bShoot);
  brain.actor.bShoot = shootUpdate.nextParam;
  optState.m.actor.bShoot = shootUpdate.nextM;
  optState.v.actor.bShoot = shootUpdate.nextV;

  const valueUpdate = updateScalar(brain.critic.bValue, grads.critic.bValue, optState.m.critic.bValue, optState.v.critic.bValue);
  brain.critic.bValue = valueUpdate.nextParam;
  optState.m.critic.bValue = valueUpdate.nextM;
  optState.v.critic.bValue = valueUpdate.nextV;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export class Bot3ExperienceBuffer {
  constructor(config, brain) {
    this.config = config;
    this.brain = brain;
    this.featureStates = [createBot3FeatureExtractor(), createBot3FeatureExtractor()];
    this.pending = [null, null];
    this.trajectories = [[], []];
    this.finishBonusGiven = [false, false];
    this.startPos = [null, null];
    this.bestDistanceFromStart = [0, 0];
    this.lastEnemyHp = [null, null];
    this.lastMyHp = [null, null];
    this.stepCount = 0;
    this.stats = { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 };
  }

  setBrain(brain) {
    this.brain = brain;
  }

  bindGame(game) {
    const center = game.world.finishCenter();
    this.pending[0] = null;
    this.pending[1] = null;
    for (let i = 0; i < 2; i++) {
      const car = game.cars[i];
      const enemy = game.cars[1 - i];
      this.startPos[i] = { x: car.pos.x, y: car.pos.y };
      this.bestDistanceFromStart[i] = 0;
      this.lastEnemyHp[i] = enemy.hp;
      this.lastMyHp[i] = car.hp;
      this.finishBonusGiven[i] = false;
      this.featureStates[i] = createBot3FeatureExtractor();
    }
  }

  decide(carId, input) {
    const obs = buildBot3Observation(this.featureStates[carId], input);
    const sample = sampleBot3PolicyAction(this.brain, obs, Math.random);
    const transition = {
      obs,
      actionRaw: Float64Array.from(sample.rawAction),
      shoot: sample.shoot,
      logp: sample.logp,
      value: sample.value,
      reward: 0,
      done: false,
    };
    this.pending[carId] = transition;
    return sample.controls;
  }

  computeReward(game, carId) {
    const center = game.world.finishCenter();
    const car = game.cars[carId];
    const enemy = game.cars[1 - carId];
    const finishVec = { x: center.x - car.pos.x, y: center.y - car.pos.y };
    const finishDist = Math.hypot(finishVec.x, finishVec.y);
    const start = this.startPos[carId] || { x: car.pos.x, y: car.pos.y };
    const distFromStart = Math.hypot(car.pos.x - start.x, car.pos.y - start.y);
    const prevBest = this.bestDistanceFromStart[carId] ?? 0;
    const progress = Math.max(0, distFromStart - prevBest);
    if (progress > 0) {
      this.bestDistanceFromStart[carId] = distFromStart;
    }

    const prevEnemyHp = this.lastEnemyHp[carId] ?? enemy.hp;
    const enemyHpDelta = Math.max(0, prevEnemyHp - enemy.hp);
    this.lastEnemyHp[carId] = enemy.hp;

    const prevMyHp = this.lastMyHp[carId] ?? car.hp;
    const myHpDelta = Math.max(0, prevMyHp - car.hp);
    this.lastMyHp[carId] = car.hp;

    const velMag = Math.hypot(car.vel.x, car.vel.y);
    const speed = Math.min(1, velMag / 360);

    let reward = progress * this.config.rewards.progress;
    reward += enemyHpDelta * this.config.rewards.damage;
    reward -= myHpDelta * this.config.rewards.damageTaken;
    if (progress > 0) {
      reward += speed * this.config.rewards.speed;
    }
    const forwardBonusCfg = this.config.rewards.forwardBonus ?? 0;
    const backwardPenaltyCfg = this.config.rewards.backwardPenalty ?? 0;
    if (forwardBonusCfg > 0 || backwardPenaltyCfg > 0) {
      const forwardDirLen = Math.hypot(finishVec.x, finishVec.y);
      if (forwardDirLen > 1e-3 && velMag > 1e-3) {
        const dot = (car.vel.x * finishVec.x + car.vel.y * finishVec.y) / (velMag * forwardDirLen);
        const forwardComponent = Math.max(0, dot) * (velMag / 360);
        reward += forwardComponent * forwardBonusCfg;
        if (dot < -0.2) {
          reward -= Math.abs(dot) * backwardPenaltyCfg;
        }
      }
    }
    reward -= this.config.rewards.timePenalty;

    const loiterRadius = this.config.rewards.loiterRadius ?? 260;
    if (finishDist < loiterRadius) {
      const progressForward = Math.max(0, progress);
      const progressNorm = Math.min(1, progressForward / 20);
      const severity = 1 - progressNorm;
      reward -= severity * this.config.rewards.loiterPenalty;
    }

    if (car.reachedFinish && !this.finishBonusGiven[carId]) {
      reward += this.config.rewards.finishBonus;
      this.finishBonusGiven[carId] = true;
    }
    if (enemy.hp <= 0 && prevEnemyHp > 0) reward += this.config.rewards.killBonus;
    if (car.hp <= 0 && prevMyHp > 0) reward -= this.config.rewards.killBonus;

    return reward;
  }

  afterStep(game) {
    for (let carId = 0; carId < 2; carId++) {
      const pending = this.pending[carId];
      if (!pending) continue;
      pending.reward = this.computeReward(game, carId);
      pending.done = false;
      this.stats.totalReward += pending.reward;
      this.trajectories[carId].push(pending);
      this.pending[carId] = null;
      this.stepCount++;
    }
  }

  finalizeEpisode(game) {
    const winner = game.winner;
    if (winner === 0) this.stats.wins++;
    else if (winner === 1) this.stats.losses++;
    else this.stats.draws++;
    this.stats.matches++;

    for (let carId = 0; carId < 2; carId++) {
      const traj = this.trajectories[carId];
      if (!traj.length) continue;
      const last = traj[traj.length - 1];
      let terminalBonus = 0;
      if (winner === carId) {
        terminalBonus = this.config.rewards.winBonus;
      } else if (winner === null || winner < 0) {
        terminalBonus = this.config.rewards.drawBonus;
      } else {
        terminalBonus = -this.config.rewards.winBonus;
      }
      last.reward += terminalBonus;
      this.stats.totalReward += terminalBonus;
      last.done = true;
    }
  }

  buildDataset(gamma, lam) {
    const samples = [];
    for (let carId = 0; carId < 2; carId++) {
      const traj = this.trajectories[carId];
      if (!traj.length) continue;
      let nextAdv = 0;
      let nextValue = 0;
      for (let i = traj.length - 1; i >= 0; i--) {
        const step = traj[i];
        const delta = step.reward + gamma * nextValue * (step.done ? 0 : 1) - step.value;
        const adv = delta + gamma * lam * nextAdv * (step.done ? 0 : 1);
        step.adv = adv;
        step.ret = adv + step.value;
        nextAdv = adv;
        nextValue = step.value;
      }
      samples.push(...traj);
      this.trajectories[carId] = [];
    }
    return { samples, stats: this.stats };
  }
}

export function accumulateGradients(brain, grads, sample, config) {
  const evalRes = evalBot3Policy(brain, sample.obs);
  const logpNew = bot3LogProb(evalRes, sample.actionRaw, sample.shoot);
  const ratio = Math.exp(logpNew - sample.logp);
  const clipHi = 1 + config.clipRatio;
  const clipLo = 1 - config.clipRatio;
  const adv = sample.normAdv;
  const unclipped = ratio * adv;
  const clippedRatio = adv >= 0 ? Math.min(ratio, clipHi) : Math.max(ratio, clipLo);
  const clippedVal = clippedRatio * adv;
  const useClipped = (adv >= 0 && ratio > clipHi) || (adv < 0 && ratio < clipLo);
  const policyCoeff = useClipped ? 0 : -adv * ratio;

  const hidden = evalRes.hidden;
  const hiddenSize = brain.hiddenSize;
  const gradHidden = new Float64Array(hiddenSize);

  const std = evalRes.logStd.map(ls => Math.exp(ls));
  let policyLoss = -Math.min(unclipped, clippedVal);

  for (let i = 0; i < brain.actionSize; i++) {
    const diff = sample.actionRaw[i] - evalRes.mean[i];
    const varTerm = std[i] * std[i];
    const gradMean = policyCoeff * (diff / varTerm);
    const base = i * hiddenSize;
    for (let h = 0; h < hiddenSize; h++) {
      grads.actor.wMean[base + h] += gradMean * hidden[h];
      gradHidden[h] += gradMean * brain.actor.wMean[base + h];
    }
    grads.actor.bMean[i] += gradMean;
    const gradLogStd = policyCoeff * ((diff * diff) / varTerm - 1) - config.entropyCoef;
    grads.actor.logStd[i] += gradLogStd;
  }

  const shootErr = sample.shoot - evalRes.shootProb;
  const gradShoot = policyCoeff * shootErr;
  for (let h = 0; h < hiddenSize; h++) {
    grads.actor.wShoot[h] += gradShoot * hidden[h];
    gradHidden[h] += gradShoot * brain.actor.wShoot[h];
  }
  grads.actor.bShoot += gradShoot;

  const valueErr = evalRes.value - sample.ret;
  const gradValue = valueErr * config.valueCoef;
  for (let h = 0; h < hiddenSize; h++) {
    grads.critic.wValue[h] += gradValue * hidden[h];
    gradHidden[h] += gradValue * brain.critic.wValue[h];
  }
  grads.critic.bValue += gradValue;

  for (let h = 0; h < hiddenSize; h++) {
    const dz = gradHidden[h] * (1 - hidden[h] * hidden[h]);
    const base = h * brain.obsSize;
    for (let j = 0; j < brain.obsSize; j++) {
      grads.core.w1[base + j] += dz * sample.obs[j];
    }
    grads.core.b1[h] += dz;
  }

  const gaussianEnt = bot3GaussianEntropy(evalRes.logStd);
  const shootEntropy = -(evalRes.shootProb * Math.log(evalRes.shootProb + 1e-6) + (1 - evalRes.shootProb) * Math.log(1 - evalRes.shootProb + 1e-6));

  return {
    policyLoss,
    valueLoss: 0.5 * valueErr * valueErr,
    entropy: gaussianEnt + shootEntropy,
  };
}
