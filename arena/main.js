import { Game } from "./engine/game.js";
import { Renderer } from "./engine/render.js";
import {
  getBrain as getBot3Brain,
  setBrain as setBot3Brain,
  commitBrain as commitBot3Brain,
  loadBrain as loadBot3Brain,
  resetBrain as resetBot3Brain,
  getLastSavedAt as getBot3LastSaved,
} from "./bots/bot3Brain.js";
import {
  createFeatureExtractor as createBot3FeatureExtractor,
  buildObservation as buildBot3Observation,
  samplePolicyAction as sampleBot3PolicyAction,
  evaluatePolicy as evalBot3Policy,
  logProbFromEval as bot3LogProb,
  gaussianEntropy as bot3GaussianEntropy,
} from "./bots/bot3Policy.js";

const canvas = document.getElementById("c");
const statusEl = document.getElementById("status");

const btnReset = document.getElementById("btnReset");
const btnPause = document.getElementById("btnPause");
const seedEl = document.getElementById("seed");
const botAEl = document.getElementById("botA");
const botBEl = document.getElementById("botB");
const randomizeSidesEl = document.getElementById("randomizeSides");

let paused = false;

async function loadBot(path, slot = "") {
  // ВНИМАНИЕ: это НЕ песочница. Бот может делать что угодно в браузере.
  // Следующий шаг — грузить в WebWorker + лимит времени.
  const ts = Date.now();
  const sep = path.includes("?") ? "&" : "?";
  const slotParam = slot ? `&slot=${encodeURIComponent(slot)}` : "";
  const mod = await import(`${path}${sep}v=${ts}${slotParam}`);
  if (typeof mod.decide !== "function") {
    throw new Error(`Bot ${path} must export function decide(input)`);
  }
  return mod;
}

async function boot() {
  const getRandomizeSides = () => randomizeSidesEl?.checked ?? true;

  async function loadSelectedBots() {
    const paths = [botAEl.value, botBEl.value];
    const slotLabels = ["A", "B"];
    return Promise.all(paths.map((path, idx) => loadBot(path, slotLabels[idx] || String(idx))));
  }

  function orderBots(seed, modules) {
    const randomize = getRandomizeSides();
    const shouldSwap = randomize && ((seed % 2) === 1);
    if (shouldSwap) {
      return { bots: [modules[1], modules[0]], names: ["B", "A"], botAIndex: 1 };
    }
    return { bots: [modules[0], modules[1]], names: ["A", "B"], botAIndex: 0 };
  }

  const FIXED_DT = 1 / 60; // детерминированный шаг
  let rafId = null;
  let game = null;
  let renderer = null;

  async function startRun() {
    statusEl.textContent = "Loading bots...";
    let selectedBots;
    try {
      selectedBots = await loadSelectedBots();
    } catch (err) {
      statusEl.textContent = `ERROR loading bots: ${err?.message || err}`;
      return;
    }

    // Generate new seed and update UI
    const newSeed = Math.random() * 0xFFFFFFFF >>> 0;
    seedEl.value = newSeed;

    // Determine bot order based on seed (random swap optional)
    const ordered = orderBots(newSeed, selectedBots);
    const [bot0, bot1] = ordered.bots;
    const [name0, name1] = ordered.names;

    // recreate game and renderer
    game = new Game({ seed: newSeed, bots: [bot0, bot1], botNames: [name0, name1] });
    renderer = new Renderer(canvas);

    // initialize renderer debug flags from UI
    const dbgRays = document.getElementById('dbgRays');
    const dbgHits = document.getElementById('dbgHits');
    const dbgInfo = document.getElementById('dbgInfo');
    const dbgLogInput = document.getElementById('dbgLogInput');
    const camAutoFollow = document.getElementById('camAutoFollow');
    renderer.debug.rays = dbgRays?.checked ?? false;
    renderer.debug.rayHits = dbgHits?.checked ?? false;
    renderer.debug.info = dbgInfo?.checked ?? false;
    renderer.autoFollow = camAutoFollow?.checked ?? true;
    window.DEBUG_LOG_INPUT = !!dbgLogInput?.checked;

    // wire checkboxes to toggle debug rendering live
    if (dbgRays) dbgRays.onchange = () => renderer.debug.rays = dbgRays.checked;
    if (dbgHits) dbgHits.onchange = () => renderer.debug.rayHits = dbgHits.checked;
    if (dbgInfo) dbgInfo.onchange = () => renderer.debug.info = dbgInfo.checked;
    if (dbgLogInput) dbgLogInput.onchange = () => { window.DEBUG_LOG_INPUT = dbgLogInput.checked; };
    if (camAutoFollow) camAutoFollow.onchange = () => renderer.autoFollow = camAutoFollow.checked;

    // Camera/zoom controls
    const handleWheel = (e) => {
      e.preventDefault();
      const zoomSpeed = 0.1;
      const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
      const newZoom = renderer.camera.zoom * (1 + delta);
      renderer.camera.zoom = Math.max(0.5, Math.min(10, newZoom));
    };

    const handleMouseDown = (e) => {
      if (e.button === 0) { // right-click
        renderer.isDragging = true;
        renderer.dragStart = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e) => {
      if (renderer.isDragging) {
        const dx = e.clientX - renderer.dragStart.x;
        const dy = e.clientY - renderer.dragStart.y;
        renderer.camera.x -= dx / renderer.camera.zoom;
        renderer.camera.y -= dy / renderer.camera.zoom;
        renderer.dragStart = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      renderer.isDragging = false;
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    let last = performance.now();
    let acc = 0;

    // ensure not paused at start
    paused = false;
    btnPause.textContent = "Pause";

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!paused) acc += dt;

      // stop advancing the simulation as soon as we have a winner
      while (acc >= FIXED_DT) {
        if (!paused && !game.winner) game.step(FIXED_DT);
        acc -= FIXED_DT;
      }

      renderer.draw(game);
      statusEl.textContent = game.debugText();

      // if a winner appeared, pause the simulation to freeze final state
      if (game.winner !== null) {
        paused = true;
        btnPause.textContent = "Resume";
      }

      rafId = requestAnimationFrame(frame);
    }

    // start the loop
    rafId = requestAnimationFrame(frame);
  }

  function stopRun() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // wire buttons
  btnReset.onclick = async () => {
    stopRun();
    if (simRunning) {
      simRunning = false;
      if (btnSimStart) btnSimStart.disabled = false;
      if (btnSimStop) btnSimStop.disabled = true;
    }
    await startRun();
  };

  const btnZoomReset = document.getElementById('btnZoomReset');
  if (btnZoomReset) {
    btnZoomReset.onclick = () => {
      if (renderer) {
        renderer.camera.x = 0;
        renderer.camera.y = 0;
        renderer.camera.zoom = 1;
      }
    };
  }

  btnPause.onclick = () => {
    paused = !paused;
    btnPause.textContent = paused ? "Resume" : "Pause";
  };

  // Fast simulation mode
  const btnSimStart = document.getElementById('btnSimStart');
  const btnSimStop = document.getElementById('btnSimStop');
  const simMatchesEl = document.getElementById('simMatches');
  const simSpeedEl = document.getElementById('simSpeed');
  const simResultsEl = document.getElementById('simResults');

  const btnBot3Train = document.getElementById('btnBot3Train');
  const btnBot3Reset = document.getElementById('btnBot3Reset');
  const bot3StatusEl = document.getElementById('bot3Status');

  loadBot3Brain();

  function formatTimestamp(ts) {
    if (!ts) return "Сохранений пока нет";
    const d = new Date(ts);
    return `Последнее сохранение: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  function updateBot3Status(text) {
    if (!bot3StatusEl) return;
    const savedText = formatTimestamp(getBot3LastSaved());
    bot3StatusEl.textContent = text ? `${text}\n${savedText}` : savedText;
  }

  updateBot3Status("Мозг загружен и готов к обучению (PPO + self-play).");

  if (btnBot3Reset) {
    btnBot3Reset.onclick = () => {
      resetBot3Brain();
      updateBot3Status("Прогресс сброшен. Модель возвращена к значениям по умолчанию.");
    };
  }

  let bot3Training = false;
  let bot3TrainAbort = false;

  const BOT3_PPO_CONFIG = {
    stepsPerBatch: 2048,
    maxMatchSteps: 60 * 90,
    gamma: 0.995,
    lam: 0.95,
    clipRatio: 0.2,
    lr: 5e-4,
    miniBatch: 256,
    epochs: 4,
    entropyCoef: 0.003,
    valueCoef: 0.5,
    rewards: {
      progress: 0.015,
      damage: 0.04,
      damageTaken: 0.03,
      speed: 0.002,
      finishBonus: 1.5,
      killBonus: 1.2,
      winBonus: 2.0,
      drawBonus: 0.3,
    },
  };

  function cloneBrainToFloat(source) {
    const brain = source || getBot3Brain();
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

  function floatBrainToPlain(brain) {
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

  function zeroBrainLike(brain) {
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

  function zeroGradients(grads) {
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

  function scaleBrainGradients(grads, scale) {
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

  function createAdamState(brain) {
    return {
      t: 0,
      m: zeroBrainLike(brain),
      v: zeroBrainLike(brain),
    };
  }

  function applyAdam(brain, grads, optState, lr) {
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

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  class Bot3ExperienceBuffer {
    constructor(trainer) {
      this.trainer = trainer;
      this.config = trainer.config;
      this.featureStates = [createBot3FeatureExtractor(), createBot3FeatureExtractor()];
      this.pending = [null, null];
      this.trajectories = [[], []];
      this.finishBonusGiven = [false, false];
      this.lastFinishDist = [null, null];
      this.lastEnemyHp = [null, null];
      this.lastMyHp = [null, null];
      this.stepCount = 0;
      this.stats = { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 };
    }

    bindGame(game) {
      const center = game.world.finishCenter();
      this.pending[0] = null;
      this.pending[1] = null;
      for (let i = 0; i < 2; i++) {
        const car = game.cars[i];
        const enemy = game.cars[1 - i];
        this.lastFinishDist[i] = Math.hypot(car.pos.x - center.x, car.pos.y - center.y);
        this.lastEnemyHp[i] = enemy.hp;
        this.lastMyHp[i] = car.hp;
        this.finishBonusGiven[i] = false;
        this.featureStates[i] = createBot3FeatureExtractor();
      }
    }

    decide(carId, input) {
      const obs = buildBot3Observation(this.featureStates[carId], input);
      const sample = sampleBot3PolicyAction(this.trainer.brain, obs, Math.random);
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
      const finishDist = Math.hypot(car.pos.x - center.x, car.pos.y - center.y);
      const prevFinish = this.lastFinishDist[carId] ?? finishDist;
      const progress = prevFinish - finishDist;
      this.lastFinishDist[carId] = finishDist;

      const prevEnemyHp = this.lastEnemyHp[carId] ?? enemy.hp;
      const enemyHpDelta = Math.max(0, prevEnemyHp - enemy.hp);
      this.lastEnemyHp[carId] = enemy.hp;

      const prevMyHp = this.lastMyHp[carId] ?? car.hp;
      const myHpDelta = Math.max(0, prevMyHp - car.hp);
      this.lastMyHp[carId] = car.hp;

      const speed = Math.min(1, Math.hypot(car.vel.x, car.vel.y) / 360);

      let reward = progress * this.config.rewards.progress;
      reward += enemyHpDelta * this.config.rewards.damage;
      reward -= myHpDelta * this.config.rewards.damageTaken;
      reward += speed * this.config.rewards.speed;

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
        if (winner === carId) terminalBonus = this.config.rewards.winBonus;
        else if (winner === null) terminalBonus = this.config.rewards.drawBonus;
        else terminalBonus = -this.config.rewards.winBonus;
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

  function accumulateGradients(brain, grads, sample, config) {
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

  class Bot3PPOTrainer {
    constructor(statusCb) {
      this.config = BOT3_PPO_CONFIG;
      this.brain = cloneBrainToFloat(getBot3Brain());
      this.optimizer = createAdamState(this.brain);
      this.iteration = 0;
      this.statusCb = statusCb;
    }

    report(msg) {
      if (this.statusCb) this.statusCb(msg);
    }

    async runMatch(buffer) {
      const modules = [
        { decide: (input) => buffer.decide(0, input) },
        { decide: (input) => buffer.decide(1, input) },
      ];
      const seed = Math.random() * 0xFFFFFFFF >>> 0;
      const game = new Game({ seed, bots: modules, botNames: ["ML-A", "ML-B"] });
      buffer.bindGame(game);
      for (let step = 0; step < this.config.maxMatchSteps && !bot3TrainAbort && game.winner === null; step++) {
        game.step(1 / 60);
        buffer.afterStep(game);
      }
      buffer.finalizeEpisode(game);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    async collectBatch() {
      const buffer = new Bot3ExperienceBuffer(this);
      while (buffer.stepCount < this.config.stepsPerBatch && !bot3TrainAbort) {
        await this.runMatch(buffer);
        this.report(`Сбор опыта: ${buffer.stepCount}/${this.config.stepsPerBatch}`);
      }
      return buffer.buildDataset(this.config.gamma, this.config.lam);
    }

    updatePolicy(dataset) {
      const samples = dataset.samples;
      if (!samples.length) return null;
      const advMean = samples.reduce((acc, s) => acc + s.adv, 0) / samples.length;
      const advStd = Math.sqrt(samples.reduce((acc, s) => acc + Math.pow(s.adv - advMean, 2), 0) / samples.length) + 1e-8;
      for (const s of samples) s.normAdv = (s.adv - advMean) / advStd;

      const grads = zeroBrainLike(this.brain);
      const metrics = { policyLoss: 0, valueLoss: 0, entropy: 0, batches: 0 };
      const indices = samples.map((_, idx) => idx);

      for (let epoch = 0; epoch < this.config.epochs && !bot3TrainAbort; epoch++) {
        shuffle(indices);
        for (let start = 0; start < indices.length && !bot3TrainAbort; start += this.config.miniBatch) {
          const batchIdx = indices.slice(start, start + this.config.miniBatch);
          zeroGradients(grads);
          let batchPolicy = 0;
          let batchValue = 0;
          let batchEntropy = 0;
          for (const idx of batchIdx) {
            const sample = samples[idx];
            const res = accumulateGradients(this.brain, grads, sample, this.config);
            batchPolicy += res.policyLoss;
            batchValue += res.valueLoss;
            batchEntropy += res.entropy;
          }
          const scale = 1 / batchIdx.length;
          scaleBrainGradients(grads, scale);
          applyAdam(this.brain, grads, this.optimizer, this.config.lr);
          metrics.policyLoss += batchPolicy * scale;
          metrics.valueLoss += batchValue * scale;
          metrics.entropy += batchEntropy * scale;
          metrics.batches++;
        }
      }

      metrics.policyLoss = metrics.batches ? metrics.policyLoss / metrics.batches : 0;
      metrics.valueLoss = metrics.batches ? metrics.valueLoss / metrics.batches : 0;
      metrics.entropy = metrics.batches ? metrics.entropy / metrics.batches : 0;
      metrics.avgReward = samples.length ? dataset.stats.totalReward / samples.length : 0;
      const totalMatches = dataset.stats.matches || 1;
      metrics.winRate = (dataset.stats.wins / totalMatches) * 100;
      metrics.matches = dataset.stats.matches;
      return metrics;
    }
  }

  async function runBot3Training() {
    if (bot3Training) return;
    bot3Training = true;
    bot3TrainAbort = false;
    if (btnBot3Train) {
      btnBot3Train.textContent = "Остановить обучение";
      btnBot3Train.disabled = false;
    }
    stopRun();
    if (simRunning) {
      simRunning = false;
      if (btnSimStart) btnSimStart.disabled = false;
      if (btnSimStop) btnSimStop.disabled = true;
    }

    const trainer = new Bot3PPOTrainer(updateBot3Status);
    try {
      while (!bot3TrainAbort) {
        const dataset = await trainer.collectBatch();
        if (bot3TrainAbort || !dataset.samples.length) break;
        const stats = trainer.updatePolicy(dataset);
        trainer.iteration++;
        const plainBrain = floatBrainToPlain(trainer.brain);
        setBot3Brain(plainBrain);
        commitBot3Brain(plainBrain);
        if (stats) {
          updateBot3Status(`Итерация ${trainer.iteration}: reward ${stats.avgReward.toFixed(3)} | win ${stats.winRate.toFixed(1)}% (${stats.matches} матчей)`);
        }
      }
      if (bot3TrainAbort) {
        updateBot3Status("Обучение остановлено пользователем.");
      } else {
        updateBot3Status("Обучение завершено.");
      }
    } catch (err) {
      console.error(err);
      updateBot3Status(`Ошибка обучения: ${err?.message || err}`);
    } finally {
      bot3Training = false;
      bot3TrainAbort = false;
      if (btnBot3Train) btnBot3Train.textContent = "Начать обучение";
      await startRun();
    }
  }

  if (btnBot3Train) {
    btnBot3Train.onclick = () => {
      if (bot3Training) {
        bot3TrainAbort = true;
        updateBot3Status("Останавливаем обучение, дождитесь завершения итерации...");
      } else {
        runBot3Training().catch((err) => console.error(err));
      }
    };
  }

  let simRunning = false;
  let simStats = { aWins: 0, bWins: 0, draws: 0, total: 0 };

  async function runFastSim() {
    const numMatches = parseInt(simMatchesEl.value) || 100;
    const speed = parseInt(simSpeedEl.value) || 10;

    simRunning = true;
    simStats = { aWins: 0, bWins: 0, draws: 0, total: 0 };
    btnSimStart.disabled = true;
    btnSimStop.disabled = false;

    const FIXED_DT = 1 / 60;
    const MAX_TIME = 120; // max 2 minutes per match

    statusEl.textContent = "Loading bots for simulation...";
    let selectedBots;
    try {
      selectedBots = await loadSelectedBots();
    } catch (err) {
      statusEl.textContent = `ERROR loading bots: ${err?.message || err}`;
      simRunning = false;
      btnSimStart.disabled = false;
      btnSimStop.disabled = true;
      return;
    }

    statusEl.textContent = "Running fast simulation...";

    for (let m = 0; m < numMatches && simRunning; m++) {
      // random seed for each match
      const seed = Math.random() * 0xFFFFFFFF >>> 0;

      // Determine bot order for this simulation
      const ordered = orderBots(seed, selectedBots);
      const g = new Game({ seed, bots: ordered.bots, botNames: ordered.names });

      let t = 0;
      // run match at speed multiplier (skip renders)
      for (let step = 0; step < (MAX_TIME * 60) && !g.winner && simRunning; step++) {
        for (let s = 0; s < speed && !g.winner; s++) {
          g.step(FIXED_DT);
        }
      }

      // record result - track by bot script, not position
      // Position of original botA in game (0 if not swapped, 1 if swapped)
      const botAActualId = ordered.botAIndex;
      
      simStats.total++;
      if (g.winner === null) {
        simStats.draws++;
      } else if (g.winner === botAActualId) {
        simStats.aWins++;  // original botA won
      } else {
        simStats.bWins++;  // original botB won
      }

      // update display every 10 matches
      if (m % 10 === 0 || m === numMatches - 1) {
        simResultsEl.textContent = `Matches: ${simStats.total}/${numMatches}\nA wins: ${simStats.aWins}\nB wins: ${simStats.bWins}\nDraws: ${simStats.draws}`;
        // yield to browser
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    simRunning = false;
    btnSimStart.disabled = false;
    btnSimStop.disabled = true;
    statusEl.textContent = "Fast simulation complete.";
    
    // final stats
    const aRate = ((simStats.aWins / simStats.total) * 100).toFixed(1);
    const bRate = ((simStats.bWins / simStats.total) * 100).toFixed(1);
    simResultsEl.textContent = `FINAL RESULTS\n\nMatches: ${simStats.total}\nA wins: ${simStats.aWins} (${aRate}%)\nB wins: ${simStats.bWins} (${bRate}%)\nDraws: ${simStats.draws}`;
  }

  btnSimStart.onclick = async () => {
    stopRun(); // stop normal rendering
    await runFastSim();
  };

  btnSimStop.onclick = () => {
    simRunning = false;
  };

  // initial start
  await startRun();
}

boot().catch((e) => {
  statusEl.textContent = String(e?.stack || e);
});
