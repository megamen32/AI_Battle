import { Game } from "./engine/game.js";
import { Renderer } from "./engine/render.js";
import { GAME_STEP_DT } from "./constants.js";
import {
  getBrain as getBot3Brain,
  setBrain as setBot3Brain,
  commitBrain as commitBot3Brain,
  loadBrain as loadBot3Brain,
  resetBrain as resetBot3Brain,
  getLastSavedAt as getBot3LastSaved,
} from "./bots/bot3Brain.js";
import {
  cloneBrainToFloat,
  floatBrainToPlain,
  zeroBrainLike,
  zeroGradients,
  scaleBrainGradients,
  createAdamState,
  applyAdam,
  shuffle,
  accumulateGradients,
} from "./bot3TrainingUtils.js";

const canvas = document.getElementById("c");
const statusEl = document.getElementById("status");

const btnReset = document.getElementById("btnReset");
const btnPause = document.getElementById("btnPause");
const seedEl = document.getElementById("seed");
const botAEl = document.getElementById("botA");
const botBEl = document.getElementById("botB");
const randomizeSidesEl = document.getElementById("randomizeSides");
const proceduralMapsEl = document.getElementById("proceduralMaps");
const mapSelectEl = document.getElementById("mapSelect");
const bot3StepsEl = document.getElementById("bot3Steps");
const bot3LrEl = document.getElementById("bot3Lr");
const bot3MaxTimeEl = document.getElementById("bot3MaxTime");
const bot3EntropyEl = document.getElementById("bot3Entropy");

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
  const getProceduralMaps = () => proceduralMapsEl?.checked ?? false;
  const getSelectedMapId = () => {
    const val = parseInt(mapSelectEl?.value ?? "0", 10);
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(4, val));
  };

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

  const FIXED_DT = GAME_STEP_DT; // детерминированный шаг
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
    const worldOptions = {
      randomPreset: getProceduralMaps(),
      presetId: getSelectedMapId(),
    };

    // recreate game and renderer
    game = new Game({ seed: newSeed, bots: [bot0, bot1], botNames: [name0, name1], worldOptions });
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
      if (renderer.autoFollow && !renderer.isDragging) {
        const factor = delta > 0 ? 1 + Math.abs(delta) : 1 / (1 + Math.abs(delta));
        renderer.adjustAutoZoomBias(factor);
      } else {
        const newZoom = renderer.camera.zoom * (1 + delta);
        renderer.camera.zoom = Math.max(0.5, Math.min(10, newZoom));
      }
    };

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        if (renderer.autoFollow) {
          renderer.autoFollow = false;
          if (camAutoFollow) camAutoFollow.checked = false;
        }
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
    if (simRunning) {
      simRunning = false;
      if (btnSimStart) btnSimStart.disabled = false;
      if (btnSimStop) btnSimStop.disabled = true;
    }
    loadBot3Brain();
    updateBot3Status();
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
  const bot3ChartEl = document.getElementById('bot3Chart');

  loadBot3Brain();

  function formatTimestamp(ts) {
    if (!ts) return "Сохранений пока нет";
    const d = new Date(ts);
    return `Последнее сохранение: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  const bot3RewardHistory = [];
  const BOT3_CHART_HISTORY = 120;
  let bot3StatusMessage = "Мозг загружен и готов к обучению (PPO + self-play).";

  function renderBot3Chart() {
    if (!bot3ChartEl) return;
    const ctx = bot3ChartEl.getContext('2d');
    if (!ctx) return;
    const w = bot3ChartEl.width;
    const h = bot3ChartEl.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,14,20,0.9)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!bot3RewardHistory.length) {
      ctx.fillStyle = "#7f8b99";
      ctx.font = "12px sans-serif";
      ctx.fillText("Нет данных", 10, h / 2);
      return;
    }

    const min = Math.min(...bot3RewardHistory);
    const max = Math.max(...bot3RewardHistory);
    const range = Math.max(1e-3, max - min);
    ctx.strokeStyle = "#8bd5ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    bot3RewardHistory.forEach((val, idx) => {
      const x = (idx / (bot3RewardHistory.length - 1 || 1)) * (w - 10) + 5;
      const norm = (val - min) / range;
      const y = h - norm * (h - 10) - 5;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    const zeroY = h - ((0 - min) / range) * (h - 10) - 5;
    if (zeroY >= 0 && zeroY <= h) {
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function pushBot3Reward(value) {
    bot3RewardHistory.push(value);
    if (bot3RewardHistory.length > BOT3_CHART_HISTORY) bot3RewardHistory.shift();
    renderBot3Chart();
  }

  function updateBot3Status(text) {
    if (!bot3StatusEl) return;
    if (typeof text === "string") bot3StatusMessage = text;
    const savedText = formatTimestamp(getBot3LastSaved());
    const head = bot3StatusMessage ? `${bot3StatusMessage}\n${savedText}` : savedText;
    bot3StatusEl.textContent = head;
  }

  updateBot3Status(bot3StatusMessage);
  renderBot3Chart();

  if (btnBot3Reset) {
    btnBot3Reset.onclick = () => {
      resetBot3Brain();
      bot3RewardHistory.length = 0;
      renderBot3Chart();
      updateBot3Status("Прогресс сброшен. Модель возвращена к значениям по умолчанию.");
    };
  }

  let bot3Training = false;
  let bot3TrainAbort = false;
  let activeBot3Trainer = null;

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
      forwardBonus: 0.000,
      backwardPenalty: 0.00,
      finishBonus: 1.5,
      killBonus: 1.2,
      winBonus: 2.0,
      drawBonus: 0.3,
      timePenalty: 0.001,
      loiterPenalty: 0.08,
      loiterRadius: 260,
    },
  };

  if (bot3StepsEl) bot3StepsEl.value = BOT3_PPO_CONFIG.stepsPerBatch;
  if (bot3LrEl) bot3LrEl.value = BOT3_PPO_CONFIG.lr;
  if (bot3MaxTimeEl) bot3MaxTimeEl.value = Math.round(BOT3_PPO_CONFIG.maxMatchSteps / 60);
  if (bot3EntropyEl) bot3EntropyEl.value = BOT3_PPO_CONFIG.entropyCoef;

  function createTrainerConfig(overrides = {}) {
    const cfg = {
      ...BOT3_PPO_CONFIG,
      rewards: { ...BOT3_PPO_CONFIG.rewards },
    };
    if (typeof overrides.stepsPerBatch === "number") cfg.stepsPerBatch = overrides.stepsPerBatch;
    if (typeof overrides.lr === "number") cfg.lr = overrides.lr;
    if (typeof overrides.maxMatchSteps === "number") cfg.maxMatchSteps = overrides.maxMatchSteps;
    if (typeof overrides.entropyCoef === "number") cfg.entropyCoef = overrides.entropyCoef;
    if (typeof overrides.miniBatch === "number") cfg.miniBatch = overrides.miniBatch;
    if (typeof overrides.epochs === "number") cfg.epochs = overrides.epochs;
    return cfg;
  }

  function readTrainingOverrides() {
    const overrides = {};
    const clampNum = (val, min, max) => Math.min(max, Math.max(min, val));
    if (bot3StepsEl) {
      const v = parseInt(bot3StepsEl.value, 10);
      if (!Number.isNaN(v)) overrides.stepsPerBatch = clampNum(v, 256, 8192);
    }
    if (bot3LrEl) {
      const v = parseFloat(bot3LrEl.value);
      if (!Number.isNaN(v)) overrides.lr = clampNum(v, 1e-5, 0.01);
    }
    if (bot3MaxTimeEl) {
      const v = parseFloat(bot3MaxTimeEl.value);
      if (!Number.isNaN(v)) overrides.maxMatchSteps = clampNum(Math.round(v * 60), 10 * 60, 180 * 60);
    }
    if (bot3EntropyEl) {
      const v = parseFloat(bot3EntropyEl.value);
      if (!Number.isNaN(v)) overrides.entropyCoef = clampNum(v, 0.0001, 0.02);
    }
    return overrides;
  }

  function setTrainingInputsDisabled(disabled) {
    if (bot3StepsEl) bot3StepsEl.disabled = disabled;
    if (bot3LrEl) bot3LrEl.disabled = disabled;
    if (bot3MaxTimeEl) bot3MaxTimeEl.disabled = disabled;
    if (bot3EntropyEl) bot3EntropyEl.disabled = disabled;
  }


  class Bot3WorkerPool {
    constructor({ config, settings }) {
      this.config = config;
      this.settings = settings;
      this.workers = [];
      this.ready = false;
      this.aborting = false;
      this.workerCount = Bot3WorkerPool.computeWorkerCount();
    }

    static isSupported() {
      return typeof Worker !== "undefined";
    }

    static computeWorkerCount() {
      const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 0) : 0;
      const base = cores > 0 ? Math.max(1, cores - 1) : 2;
      return Math.min(6, base);
    }

    async init(initialBrain) {
      if (!Bot3WorkerPool.isSupported()) return false;
      this.workerCount = Math.max(1, this.workerCount || 1);
      const workerUrl = new URL("./bot3Worker.js", import.meta.url);
      const initPromises = [];
      for (let i = 0; i < this.workerCount; i++) {
        const worker = new Worker(workerUrl, { type: "module" });
        const state = {
          id: i,
          worker,
          readyPromise: null,
          resolveReady: null,
          rejectReady: null,
          task: null,
        };
        state.readyPromise = new Promise((resolve, reject) => {
          state.resolveReady = resolve;
          state.rejectReady = reject;
        });
        worker.onmessage = (event) => this.handleMessage(state, event.data);
        worker.onerror = (err) => {
          if (state.task) {
            state.task.reject(err?.error || err?.message || err);
            state.task = null;
          }
        };
        this.workers.push(state);
        worker.postMessage({
          type: "init",
          workerId: i,
          config: this.config,
          settings: this.settings,
          brain: initialBrain,
        });
        initPromises.push(state.readyPromise);
      }
      await Promise.all(initPromises);
      this.ready = true;
      return true;
    }

    handleMessage(state, data) {
      const payload = data || {};
      if (payload.type === "ready") {
        state.resolveReady?.();
        state.resolveReady = null;
        state.rejectReady = null;
      } else if (payload.type === "batch" || payload.type === "error" || payload.type === "aborted") {
        if (state.task) {
          if (payload.type === "error") {
            state.task.reject(new Error(payload.message || "Worker error"));
          } else if (payload.type === "aborted") {
            state.task.resolve({ aborted: true });
          } else {
            state.task.resolve({ dataset: payload.dataset, stepCount: payload.stepCount || 0 });
          }
          state.task = null;
        }
      }
    }

    runCollect(state, targetSteps) {
      if (!state.worker) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        state.task = { resolve, reject };
        state.worker.postMessage({ type: "collect", workerId: state.id, targetSteps });
      });
    }

    async collectBatch(totalSteps) {
      if (!this.ready || !this.workers.length) return null;
      this.aborting = false;
      const workerCount = this.workers.length;
      const baseSteps = Math.max(1, Math.floor(totalSteps / workerCount));
      let remainder = Math.max(0, totalSteps - baseSteps * workerCount);
      const tasks = this.workers.map((state) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        const target = baseSteps + extra;
        return this.runCollect(state, target);
      });
      const results = await Promise.allSettled(tasks);
      if (this.aborting) return { samples: [], stats: { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 } };
      const merged = { samples: [], stats: { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 } };
      for (const res of results) {
        if (res.status !== "fulfilled") continue;
        const value = res.value;
        if (!value || value.aborted || !value.dataset) continue;
        const dataset = value.dataset;
        merged.samples.push(...dataset.samples);
        merged.stats.matches += dataset.stats?.matches || 0;
        merged.stats.wins += dataset.stats?.wins || 0;
        merged.stats.losses += dataset.stats?.losses || 0;
        merged.stats.draws += dataset.stats?.draws || 0;
        merged.stats.totalReward += dataset.stats?.totalReward || 0;
      }
      return merged;
    }

    async updateBrain(brainPlain) {
      if (!this.ready) return;
      await Promise.all(this.workers.map((state) => {
        return new Promise((resolve) => {
          state.worker.postMessage({ type: "updateBrain", workerId: state.id, brain: brainPlain });
          resolve();
        });
      }));
    }

    requestAbort() {
      if (!this.workers.length) return;
      this.aborting = true;
      for (const state of this.workers) {
        state.worker.postMessage({ type: "abort", workerId: state.id });
      }
    }

    async shutdown() {
      if (!this.workers.length) return;
      for (const state of this.workers) {
        state.worker.postMessage({ type: "shutdown", workerId: state.id });
        state.worker.terminate();
      }
      this.workers = [];
      this.ready = false;
    }
  }

  class Bot3PPOTrainer {
    constructor(statusCb, settings, configOverrides) {
      this.config = createTrainerConfig(configOverrides);
      this.brain = cloneBrainToFloat(getBot3Brain());
      this.optimizer = createAdamState(this.brain);
      this.iteration = 0;
      this.statusCb = statusCb;
      this.settings = settings || { randomizeSides: true, proceduralMaps: false };
      this.workerPool = null;
    }

    report(msg) {
      if (this.statusCb) this.statusCb(msg);
    }

    async ensureWorkerPool() {
      if (this.workerPool || bot3TrainAbort) return;
      if (!Bot3WorkerPool.isSupported()) {
        throw new Error("Web Workers недоступны — не могу запустить обучение без них.");
      }
      const pool = new Bot3WorkerPool({ config: this.config, settings: this.settings });
      let ok = false;
      try {
        ok = await pool.init(floatBrainToPlain(this.brain));
      } catch (err) {
        console.warn("Failed to init bot3 worker pool", err);
      }
      if (!ok) {
        await pool.shutdown();
        throw new Error("Не удалось запустить фоновые воркеры для self-play.");
      }
      this.workerPool = pool;
      this.report(`Параллельный self-play: ${pool.workers.length} поток(ов).`);
    }

    requestAbort() {
      this.workerPool?.requestAbort();
    }

    async shutdown() {
      await this.workerPool?.shutdown();
      this.workerPool = null;
    }

    async syncWorkers() {
      if (this.workerPool) {
        await this.workerPool.updateBrain(floatBrainToPlain(this.brain));
      }
    }

    async runMatch(buffer) {
      const seed = Math.random() * 0xFFFFFFFF >>> 0;
      const swapSpawns = this.settings.randomizeSides && ((seed & 1) === 1);
      const modules = [
        { decide: (input) => buffer.decide(0, input) },
        { decide: (input) => buffer.decide(1, input) },
      ];
      const game = new Game({
        seed,
        bots: modules,
        botNames: ["ML-A", "ML-B"],
        worldOptions: {
          randomPreset: this.settings.randomPreset,
          presetId: this.settings.presetId,
          swapSpawns,
        },
      });
      buffer.bindGame(game);
      for (let step = 0; step < this.config.maxMatchSteps && !bot3TrainAbort && game.winner === null; step++) {
        game.step(GAME_STEP_DT);
        buffer.afterStep(game);
      }
      buffer.finalizeEpisode(game);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    async collectBatch() {
      await this.ensureWorkerPool();
      if (!this.workerPool || bot3TrainAbort) return { samples: [], stats: { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 } };
      this.report(`Сбор опыта параллельно (${this.workerPool.workers.length} потоков)...`);
      const dataset = await this.workerPool.collectBatch(this.config.stepsPerBatch);
      return dataset || { samples: [], stats: { matches: 0, wins: 0, losses: 0, draws: 0, totalReward: 0 } };
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
      metrics.totalReward = dataset.stats.totalReward || 0;
      metrics.sampleCount = samples.length;
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
    setTrainingInputsDisabled(true);
    if (simRunning) {
      simRunning = false;
      if (btnSimStart) btnSimStart.disabled = false;
      if (btnSimStop) btnSimStop.disabled = true;
    }

    const trainingSettings = {
      randomizeSides: getRandomizeSides(),
      randomPreset: getProceduralMaps(),
      presetId: getSelectedMapId(),
    };
    const trainingOverrides = readTrainingOverrides();
    const batchSteps = trainingOverrides.stepsPerBatch ?? BOT3_PPO_CONFIG.stepsPerBatch;
    const lrUsed = trainingOverrides.lr ?? BOT3_PPO_CONFIG.lr;
    const maxSec = Math.round((trainingOverrides.maxMatchSteps ?? BOT3_PPO_CONFIG.maxMatchSteps) / 60);
    const mapLabel = trainingSettings.randomPreset ? "случ. из 5" : `№${trainingSettings.presetId + 1}`;
    updateBot3Status(
      `Self-play запущен (стороны: ${trainingSettings.randomizeSides ? "менять" : "фикс"}, карта: ${mapLabel}, ` +
      `steps/batch: ${batchSteps}, lr: ${lrUsed}, T=${maxSec}s)`
    );
    const trainer = new Bot3PPOTrainer(updateBot3Status, trainingSettings, trainingOverrides);
    activeBot3Trainer = trainer;
    try {
      while (!bot3TrainAbort) {
        const dataset = await trainer.collectBatch();
        if (bot3TrainAbort || !dataset || !dataset.samples || !dataset.samples.length) break;
        const stats = trainer.updatePolicy(dataset);
        trainer.iteration++;
        const plainBrain = floatBrainToPlain(trainer.brain);
        setBot3Brain(plainBrain);
        commitBot3Brain(plainBrain);
        await trainer.syncWorkers();
        if (stats) {
          pushBot3Reward(stats.totalReward ?? 0);
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
      await trainer.shutdown();
      activeBot3Trainer = null;
      bot3Training = false;
      bot3TrainAbort = false;
      setTrainingInputsDisabled(false);
      if (btnBot3Train) btnBot3Train.textContent = "Начать обучение";
    }
  }

  if (btnBot3Train) {
    btnBot3Train.onclick = () => {
      if (bot3Training) {
        bot3TrainAbort = true;
        updateBot3Status("Останавливаем обучение, дождитесь завершения итерации...");
        activeBot3Trainer?.requestAbort();
      } else {
        runBot3Training().catch((err) => console.error(err));
      }
    };
  }

  let simRunning = false;
  let simStats = { aWins: 0, bWins: 0, draws: 0, total: 0 };
  const fastSimState = { workers: [] };
  let fastSimAbortRequested = false;

  const FAST_SIM_DT = GAME_STEP_DT;
  const FAST_SIM_MAX_TIME = 120;

  function updateSimResultsDisplay(totalTarget) {
    if (!simResultsEl) return;
    simResultsEl.textContent = `Matches: ${simStats.total}/${totalTarget}\nA wins: ${simStats.aWins}\nB wins: ${simStats.bWins}\nDraws: ${simStats.draws}`;
  }

  function snapshotLocalStorage() {
    if (typeof localStorage === "undefined") return [];
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        entries.push({ key, value: localStorage.getItem(key) });
      } catch (err) {
        console.warn("Failed to snapshot localStorage key", key, err);
      }
    }
    return entries;
  }

  function terminateFastSimWorkers() {
    if (!fastSimState.workers.length) return;
    for (const worker of fastSimState.workers) {
      try { worker.terminate(); } catch (err) { console.warn("Failed to terminate fast sim worker", err); }
    }
    fastSimState.workers = [];
  }

  async function runFastSimSequential(selectedBots, cfg) {
    const maxSteps = cfg.maxTime * 60;
    for (let m = 0; m < cfg.numMatches && simRunning; m++) {
      const seed = Math.random() * 0xFFFFFFFF >>> 0;
      const ordered = orderBots(seed, selectedBots);
      const game = new Game({
        seed,
        bots: ordered.bots,
        botNames: ordered.names,
        worldOptions: {
          randomPreset: cfg.randomPreset,
          presetId: cfg.presetId,
        },
      });

      for (let step = 0; step < maxSteps && !game.winner && simRunning; step++) {
        for (let s = 0; s < cfg.speed && !game.winner && simRunning; s++) {
          game.step(FAST_SIM_DT);
        }
      }

      const botAActualId = ordered.botAIndex;
      simStats.total++;
      if (game.winner === null || game.winner === -1) {
        simStats.draws++;
      } else if (game.winner === botAActualId) {
        simStats.aWins++;
      } else {
        simStats.bWins++;
      }

      if (m % 10 === 0 || m === cfg.numMatches - 1) {
        updateSimResultsDisplay(cfg.numMatches);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  async function runFastSimWorkers(cfg) {
    const workerUrl = new URL("./fastSimWorker.js", import.meta.url);
    const workerCount = Math.min(cfg.workerCount, cfg.numMatches);
    if (workerCount <= 0) return;
    const storageSnapshot = snapshotLocalStorage();
    const botPaths = [botAEl.value, botBEl.value].map(path => new URL(path, window.location.href).href);
    const promises = [];
    fastSimState.workers = [];
    const baseMatches = Math.floor(cfg.numMatches / workerCount);
    let remainder = cfg.numMatches - baseMatches * workerCount;
    const baseSeed = Math.random() * 0xFFFFFFFF >>> 0;

    for (let i = 0; i < workerCount; i++) {
      const matches = baseMatches + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      if (matches <= 0) continue;
      const promise = new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { type: "module" });
        fastSimState.workers.push(worker);
        worker.onmessage = (event) => {
          const data = event.data || {};
          if (data.type === "match") {
            if (!simRunning) return;
            simStats.total++;
            if (data.result === "A") simStats.aWins++;
            else if (data.result === "B") simStats.bWins++;
            else simStats.draws++;
            updateSimResultsDisplay(cfg.numMatches);
          } else if (data.type === "done") {
            worker.terminate();
            resolve();
          } else if (data.type === "error") {
            worker.terminate();
            reject(new Error(data.message || "Worker error"));
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(err?.error || err);
        };
        worker.postMessage({
          type: "run",
          workerId: i,
          matches,
          speed: cfg.speed,
          maxTime: cfg.maxTime,
          randomizeSides: cfg.randomizeSides,
          randomPreset: cfg.randomPreset,
          presetId: cfg.presetId,
          botPaths,
          storageSnapshot,
          randomSeed: (baseSeed + i * 977) >>> 0,
        });
      });
      promises.push(promise);
    }

    await Promise.all(promises);
  }

  async function runFastSim() {
    const numMatches = parseInt(simMatchesEl.value, 10) || 100;
    const speed = Math.max(1, parseInt(simSpeedEl.value, 10) || 10);
    const cfg = {
      numMatches,
      speed,
      maxTime: FAST_SIM_MAX_TIME,
      randomizeSides: getRandomizeSides(),
      randomPreset: getProceduralMaps(),
      presetId: getSelectedMapId(),
    };

    simRunning = true;
    fastSimAbortRequested = false;
    simStats = { aWins: 0, bWins: 0, draws: 0, total: 0 };
    updateSimResultsDisplay(cfg.numMatches);
    btnSimStart.disabled = true;
    btnSimStop.disabled = false;

    const workerSupport = typeof Worker !== "undefined";
    const workerCount = workerSupport ? Math.max(1, Math.min(Bot3WorkerPool.computeWorkerCount() || 1, cfg.numMatches)) : 0;
    let error = null;

    try {
      if (workerSupport && workerCount > 0) {
        statusEl.textContent = `Running fast simulation (${workerCount} потоков)...`;
        await runFastSimWorkers({ ...cfg, workerCount });
      } else {
        statusEl.textContent = "Running fast simulation (основной поток)...";
        const selectedBots = await loadSelectedBots();
        await runFastSimSequential(selectedBots, cfg);
      }
    } catch (err) {
      error = err;
      console.error(err);
    } finally {
      terminateFastSimWorkers();
      simRunning = false;
      btnSimStart.disabled = false;
      btnSimStop.disabled = true;

      if (error) {
        statusEl.textContent = `Fast simulation error: ${error?.message || error}`;
      } else if (fastSimAbortRequested) {
        statusEl.textContent = "Fast simulation остановлен.";
      } else {
        statusEl.textContent = "Fast simulation complete.";
      }

      const total = Math.max(1, simStats.total || 1);
      const aRate = ((simStats.aWins / total) * 100).toFixed(1);
      const bRate = ((simStats.bWins / total) * 100).toFixed(1);
      simResultsEl.textContent = `FINAL RESULTS\n\nMatches: ${simStats.total}\nA wins: ${simStats.aWins} (${aRate}%)\nB wins: ${simStats.bWins} (${bRate}%)\nDraws: ${simStats.draws}`;
    }
  }

  btnSimStart.onclick = async () => {
    stopRun();
    await runFastSim();
  };

  btnSimStop.onclick = () => {
    if (!simRunning) return;
    fastSimAbortRequested = true;
    simRunning = false;
    for (const worker of fastSimState.workers) {
      try { worker.postMessage({ type: "abort" }); } catch (err) { console.warn("Failed to abort worker", err); }
    }
  };

  // initial start
  await startRun();
}

boot().catch((e) => {
  statusEl.textContent = String(e?.stack || e);
});
