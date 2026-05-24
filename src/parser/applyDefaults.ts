import type { WorkoutPlan, Step } from "./types";

export function applyWarmupCooldownDefaults(plan: WorkoutPlan): WorkoutPlan {
  const hasWarmup = plan.steps.some(
    (s) => s.kind === "interval" && s.intent === "warmup",
  );
  const hasCooldown = plan.steps.some(
    (s) => s.kind === "interval" && s.intent === "cooldown",
  );
  if (hasWarmup && hasCooldown) return plan;

  const steps: Step[] = [];
  if (!hasWarmup) {
    steps.push({ kind: "interval", intent: "warmup", duration: { unit: "open" } });
  }
  steps.push(...plan.steps);
  if (!hasCooldown) {
    steps.push({ kind: "interval", intent: "cooldown", duration: { unit: "open" } });
  }
  return { ...plan, steps };
}
