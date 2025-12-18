import { Game } from "./engine/game.js";
import { GAME_STEP_DT } from "./constants.js";
import { Bot3ExperienceBuffer, cloneBrainToFloat } from "./bot3TrainingUtils.js";

let workerId = null;
let config = null;
let settings = { randomizeSides: true, randomPreset: false, presetId: 0, presetPool: [0,1,2,3,4] };
let brain = null;
let abortRequested = false;

function randSeed() {
  return Math.random() * 0xFFFFFFFF >>> 0;
}

async function runMatch(buffer) {
  const seed = randSeed();
  const swapSpawns = settings.randomizeSides && ((seed & 1) === 1);
  const bots = [
    { decide: (input) => buffer.decide(0, input) },
    { decide: (input) => buffer.decide(1, input) },
  ];
  const game = new Game({
    seed,
    bots,
    botNames: ["ML-A", "ML-B"],
    worldOptions: {
      randomPreset: settings.randomPreset,
      presetId: settings.presetId,
      presetPool: settings.presetPool,
      swapSpawns,
    },
  });
  buffer.bindGame(game);
  for (let step = 0; step < config.maxMatchSteps && !abortRequested && game.winner === null; step++) {
    game.step(GAME_STEP_DT);
    buffer.afterStep(game);
  }
  buffer.finalizeEpisode(game);
}

async function collectSteps(targetSteps) {
  const buffer = new Bot3ExperienceBuffer(config, brain);
  while (buffer.stepCount < targetSteps && !abortRequested) {
    await runMatch(buffer);
  }
  return { buffer, dataset: buffer.buildDataset(config.gamma, config.lam) };
}

function postMessageSafe(payload) {
  try {
    self.postMessage(payload);
  } catch (err) {
    console.error("bot3 worker failed to post message", err);
  }
}

self.onmessage = async (event) => {
  const data = event.data || {};
  switch (data.type) {
    case "init": {
      workerId = data.workerId;
      config = data.config;
      settings = {
        ...settings,
        ...(data.settings || {}),
      };
      if (!Array.isArray(settings.presetPool) || !settings.presetPool.length) {
        settings.presetPool = [0,1,2,3,4];
      } else {
        settings.presetPool = settings.presetPool.map(v => Math.max(0, Math.min(4, Math.floor(v))));
      }
      if (!settings.presetPool.includes(settings.presetId)) {
        settings.presetId = settings.presetPool[0] ?? 0;
      }
      brain = cloneBrainToFloat(data.brain);
      abortRequested = false;
      postMessageSafe({ type: "ready", workerId });
      break;
    }
    case "updateBrain": {
      if (data.brain) brain = cloneBrainToFloat(data.brain);
      postMessageSafe({ type: "brainUpdated", workerId });
      break;
    }
    case "collect": {
      if (!config || !brain) {
        postMessageSafe({ type: "error", workerId, message: "Worker not initialized" });
        break;
      }
      abortRequested = false;
      try {
        const targetSteps = Math.max(1, data.targetSteps || config.stepsPerBatch || 1024);
        const { buffer, dataset } = await collectSteps(targetSteps);
        if (abortRequested) {
          postMessageSafe({ type: "aborted", workerId });
        } else {
          postMessageSafe({ type: "batch", workerId, dataset, stepCount: buffer.stepCount });
        }
      } catch (err) {
        postMessageSafe({ type: "error", workerId, message: err?.message || String(err) });
      }
      break;
    }
    case "abort": {
      abortRequested = true;
      break;
    }
    case "shutdown": {
      abortRequested = true;
      close();
      break;
    }
    default:
      break;
  }
};
