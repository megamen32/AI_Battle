import { Game } from "./engine/game.js";
import { Renderer } from "./engine/render.js";

const canvas = document.getElementById("c");
const statusEl = document.getElementById("status");

const btnReset = document.getElementById("btnReset");
const btnPause = document.getElementById("btnPause");
const seedEl = document.getElementById("seed");
const botAEl = document.getElementById("botA");
const botBEl = document.getElementById("botB");

let paused = false;

async function loadBot(path) {
  // ВНИМАНИЕ: это НЕ песочница. Бот может делать что угодно в браузере.
  // Следующий шаг — грузить в WebWorker + лимит времени.
  const mod = await import(path + `?v=${Date.now()}`);
  if (typeof mod.decide !== "function") {
    throw new Error(`Bot ${path} must export function decide(input)`);
  }
  return mod;
}

async function boot() {
  const botAPath = botAEl.value;
  const botBPath = botBEl.value;

  const [botA, botB] = await Promise.all([loadBot(botAPath), loadBot(botBPath)]);

  const FIXED_DT = 1 / 60; // детерминированный шаг
  let rafId = null;
  let game = null;
  let renderer = null;

  function startRun() {
    // preserve seed value from the input field (do not reset it)
    const seed = Math.random() * 0xFFFFFFFF >>> 0;

    // recreate game and renderer
    game = new Game({ seed, bots: [botA, botB], botNames: ["A", "B"] });
    renderer = new Renderer(canvas);

    // initialize renderer debug flags from UI
    const dbgRays = document.getElementById('dbgRays');
    const dbgHits = document.getElementById('dbgHits');
    const dbgInfo = document.getElementById('dbgInfo');
    const dbgLogInput = document.getElementById('dbgLogInput');
    renderer.debug.rays = dbgRays?.checked ?? false;
    renderer.debug.rayHits = dbgHits?.checked ?? false;
    renderer.debug.info = dbgInfo?.checked ?? false;
    window.DEBUG_LOG_INPUT = !!dbgLogInput?.checked;

    // wire checkboxes to toggle debug rendering live
    if (dbgRays) dbgRays.onchange = () => renderer.debug.rays = dbgRays.checked;
    if (dbgHits) dbgHits.onchange = () => renderer.debug.rayHits = dbgHits.checked;
    if (dbgInfo) dbgInfo.onchange = () => renderer.debug.info = dbgInfo.checked;
    if (dbgLogInput) dbgLogInput.onchange = () => { window.DEBUG_LOG_INPUT = dbgLogInput.checked; };

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
  btnReset.onclick = () => {
    // restart simulation without reloading the page so seed input stays as the user set it
    stopRun();
    startRun();
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

    for (let m = 0; m < numMatches && simRunning; m++) {
      // random seed for each match
      const seed = Math.random() * 0xFFFFFFFF >>> 0;
      const g = new Game({ seed, bots: [botA, botB], botNames: ["A", "B"] });

      let t = 0;
      // run match at speed multiplier (skip renders)
      for (let step = 0; step < (MAX_TIME * 60) && !g.winner && simRunning; step++) {
        for (let s = 0; s < speed && !g.winner; s++) {
          g.step(FIXED_DT);
        }
      }

      // record result
      simStats.total++;
      if (g.winner === null) {
        simStats.draws++;
      } else if (g.winner === 0) {
        simStats.aWins++;
      } else {
        simStats.bWins++;
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
    
    // final stats
    const aRate = ((simStats.aWins / simStats.total) * 100).toFixed(1);
    const bRate = ((simStats.bWins / simStats.total) * 100).toFixed(1);
    simResultsEl.textContent = `FINAL RESULTS\n\nMatches: ${simStats.total}\nA wins: ${simStats.aWins} (${aRate}%)\nB wins: ${simStats.bWins} (${bRate}%)\nDraws: ${simStats.draws}`;
  }

  btnSimStart.onclick = () => {
    stopRun(); // stop normal rendering
    runFastSim();
  };

  btnSimStop.onclick = () => {
    simRunning = false;
  };

  // initial start
  startRun();
}

boot().catch((e) => {
  statusEl.textContent = String(e?.stack || e);
});
