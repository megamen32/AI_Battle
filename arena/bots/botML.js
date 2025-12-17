import { getBrain } from "./bot3Brain.js";
import {
  BOT3_CONFIG,
  createFeatureExtractor,
  buildObservation,
  evaluatePolicy,
  actionVectorToControls,
} from "./bot3Policy.js";

const featureState = createFeatureExtractor();

export function decide(input) {
  const brain = getBrain();
  const obs = buildObservation(featureState, input);
  const evalRes = evaluatePolicy(brain, obs);
  const actionVec = Array.from(evalRes.mean, v => Math.max(-1, Math.min(1, v)));
  const shoot = evalRes.shootProb > 0.55;
  return actionVectorToControls(actionVec, shoot);
}

export { BOT3_CONFIG, createFeatureExtractor, buildObservation, evaluatePolicy, actionVectorToControls };
