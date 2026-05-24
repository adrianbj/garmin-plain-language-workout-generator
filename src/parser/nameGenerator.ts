import type { WorkoutPlan, Step, IntervalStep } from "./types";

function isWork(s: Step): s is IntervalStep {
  return s.kind === "interval" && (s.intent === "work" || s.intent === "warmup" || s.intent === "cooldown");
}

function describeDuration(step: IntervalStep): string {
  if (step.duration.unit === "time") {
    const sec = step.duration.seconds;
    if (sec >= 60 && sec % 60 === 0) return `${sec / 60}min`;
    return `${Math.round(sec)}s`;
  }
  if (step.duration.unit === "distance") {
    const m = step.duration.meters;
    if (m >= 1000 && m % 1000 === 0) return `${m / 1000}k`;
    return `${m}m`;
  }
  return "";
}

function intervalToken(step: IntervalStep): string {
  if (step.duration.unit === "time" && step.duration.seconds % 60 === 0) {
    return String(step.duration.seconds / 60);
  }
  if (step.duration.unit === "distance" && step.duration.meters % 100 === 0) {
    const m = step.duration.meters;
    return m >= 1000 && m % 1000 === 0 ? `${m / 1000}k` : `${m}`;
  }
  return describeDuration(step);
}

function targetLabel(step: IntervalStep): string | undefined {
  if (step.target?.kind === "pace_zone") return step.target.zoneName;
  return undefined;
}

export function generateName(plan: WorkoutPlan): string {
  const workSteps = plan.steps.filter(isWork);

  if (plan.steps.length === 1 && workSteps.length === 1) {
    const [only] = workSteps;
    if (!only) return "Workout";
    const dur = describeDuration(only);
    const tgt = targetLabel(only);
    if (dur && tgt) return `${dur} ${tgt}`;
    if (dur) return dur;
    return "Workout";
  }

  if (plan.steps.length === 1 && plan.steps[0]?.kind === "repeat") {
    const repeat = plan.steps[0];
    const workChild = repeat.children.find(isWork);
    if (workChild) {
      const dur = describeDuration(workChild);
      const tgt = targetLabel(workChild);
      const prefix = `${repeat.count}x${dur}`;
      return tgt ? `${prefix} @ ${tgt}` : prefix;
    }
  }

  if (workSteps.length >= 2) {
    const tokens = workSteps.map(intervalToken);
    const tgts = new Set(workSteps.map(targetLabel).filter((t): t is string => !!t));
    const joined = tokens.join("-");
    if (tgts.size === 1) {
      const [only] = [...tgts];
      return `${joined} @ ${only}`;
    }
    if (joined) return joined;
  }

  return "Workout";
}
