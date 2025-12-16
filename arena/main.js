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

  function cloneBrain(brain) {
    return JSON.parse(JSON.stringify(brain));
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function mutateBrain(baseBrain, magnitude = 0.25) {
    const mutated = cloneBrain(baseBrain);
    const mutateArray = (arr) => arr.map(w => clamp(w + (Math.random() - 0.5) * magnitude, -2.5, 2.5));
    mutated.steer = mutateArray(mutated.steer);
    mutated.throttle = mutateArray(mutated.throttle);
    mutated.shoot = mutateArray(mutated.shoot);
    mutated.shootBias = clamp(mutated.shootBias + (Math.random() - 0.5) * (magnitude * 0.6), -1, 1);
    return mutated;
  }

  function updateBot3Status(text) {
    if (!bot3StatusEl) return;
    const savedText = formatTimestamp(getBot3LastSaved());
    bot3StatusEl.textContent = text ? `${text}\n${savedText}` : savedText;
  }

  updateBot3Status("Мозг загружен и готов к обучению.");

  if (btnBot3Reset) {
    btnBot3Reset.onclick = () => {
      resetBot3Brain();
      updateBot3Status("Прогресс сброшен.");
    };
  }

  let bot3Training = false;
  let bot3TrainAbort = false;

  async function evaluateBrain(brain, bot3Module, opponentModule, matches = 3) {
    setBot3Brain(brain);
    const FIXED_DT = 1 / 60;
    const MAX_TIME = 90; // seconds
    let total = 0;
    let played = 0;
    for (let m = 0; m < matches; m++) {
      if (bot3TrainAbort) break;
      const seed = Math.random() * 0xFFFFFFFF >>> 0;
      const game = new Game({ seed, bots: [bot3Module, opponentModule], botNames: ["ML", "Opponent"] });
      const maxSteps = MAX_TIME * 60;
      for (let step = 0; step < maxSteps && game.winner === null; step++) {
        game.step(FIXED_DT);
      }
      played++;
      if (game.winner === 0) total += 1;
      else if (game.winner === null) total += 0.3;
      await new Promise(res => setTimeout(res, 0));
    }
    return played ? (total / played) : 0;
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
    updateBot3Status("Загрузка ботов для обучения...");
    try {
      const opponentPath = botBEl?.value || "./bots/botA.js";
      const [bot3Module, opponentModule] = await Promise.all([
        loadBot("./bots/botML.js", "TrainML"),
        loadBot(opponentPath, "TrainOpponent")
      ]);
      updateBot3Status("Оценка текущей версии...");
      let bestBrain = cloneBrain(getBot3Brain());
      let bestScore = await evaluateBrain(bestBrain, bot3Module, opponentModule);
      updateBot3Status(`Базовый рейтинг: ${bestScore.toFixed(2)}`);

      let iteration = 0;
      while (!bot3TrainAbort) {
        iteration++;
        const candidate = mutateBrain(bestBrain);
        const score = await evaluateBrain(candidate, bot3Module, opponentModule);
        if (bot3TrainAbort) break;
        if (score > bestScore) {
          bestScore = score;
          bestBrain = candidate;
          commitBot3Brain(bestBrain);
          updateBot3Status(`Итерация ${iteration}: улучшение -> ${score.toFixed(2)} (автосохранение)`);
        } else if (iteration % 4 === 0) {
          updateBot3Status(`Итерация ${iteration}: лучший скор ${bestScore.toFixed(2)}`);
        }
      }
      setBot3Brain(bestBrain);
      if (bot3TrainAbort) {
        updateBot3Status(`Обучение остановлено. Лучший скор: ${bestScore.toFixed(2)}`);
      } else {
        updateBot3Status(`Обучение завершено. Лучший скор: ${bestScore.toFixed(2)}`);
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
        updateBot3Status("Завершаем текущую итерацию...");
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
