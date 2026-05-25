import type { WorkoutPlan, Step, IntervalStep, Duration } from "./types";

function isWorkInterval(s: Step): s is IntervalStep {
  return s.kind === "interval" && s.intent === "work";
}

function isFraming(s: Step): boolean {
  return s.kind === "interval" && (s.intent === "warmup" || s.intent === "cooldown");
}

// Running shorthand: ' for minutes, " for seconds, k for km, m for meters.
// Used in both single-step descriptions ("45' easy") and joined tokens ("3'-3'-2'-2'")
// so the unit is never ambiguous and matches how runners write workouts.
function describeDuration(step: IntervalStep): string {
  if (step.duration.unit === "time") {
    const sec = step.duration.seconds;
    if (sec >= 60 && sec % 60 === 0) return `${sec / 60}'`;
    return `${Math.round(sec)}"`;
  }
  if (step.duration.unit === "distance") {
    const m = step.duration.meters;
    if (m >= 1000 && m % 1000 === 0) return `${m / 1000}k`;
    return `${m}m`;
  }
  return "";
}

const intervalToken = describeDuration;

function targetLabel(step: IntervalStep): string | undefined {
  if (step.target?.kind === "pace_zone") return step.target.zoneName;
  return undefined;
}

function durationsEqual(a: Duration, b: Duration): boolean {
  if (a.unit === "time" && b.unit === "time") return a.seconds === b.seconds;
  if (a.unit === "distance" && b.unit === "distance") return a.meters === b.meters;
  if (a.unit === "open" && b.unit === "open") return true;
  return false;
}

// Describe a single top-level "main" step (already excludes warmup/cooldown framing).
function describeMainStep(step: Step): string | undefined {
  if (step.kind === "interval") {
    if (step.intent !== "work") return undefined; // rest/recovery — naming-irrelevant
    const dur = describeDuration(step);
    const zone = targetLabel(step);
    if (!dur) return undefined;
    return zone ? `${dur} ${zone}` : dur;
  }

  // Repeat block — describe by its work children
  const workChildren = step.children.filter(isWorkInterval);
  if (workChildren.length === 0) return undefined;

  const [first, ...rest] = workChildren;
  if (!first) return undefined;
  const allSameDuration = rest.every((c) => durationsEqual(c.duration, first.duration));

  const zones = new Set(workChildren.map(targetLabel).filter((t): t is string => !!t));
  const oneZone = zones.size === 1 ? [...zones][0] : undefined;

  if (allSameDuration && workChildren.length === 1) {
    // Canonical uniform repeat: "5x1k @ 5k", or "5x1k/2' @ 5k" when the rep
    // unit pairs a work step with one rest/recovery step.
    const dur = describeDuration(first);
    const restChildren = step.children.filter(
      (c): c is IntervalStep =>
        c.kind === "interval" && (c.intent === "rest" || c.intent === "recovery"),
    );
    let workToken = dur;
    if (restChildren.length === 1) {
      const restDur = describeDuration(restChildren[0]!);
      if (restDur) workToken = `${dur}/${restDur}`;
    }
    const base = `${step.count}x${workToken}`;
    return oneZone ? `${base} @ ${oneZone}` : base;
  }

  if (allSameDuration) {
    // Multiple identical work intervals per rep — unusual but handle it.
    // e.g., 3x (1k + 1k @ 5k pace) → "3x2x1k @ 5k"
    const dur = describeDuration(first);
    const base = `${step.count}x${workChildren.length}x${dur}`;
    return oneZone ? `${base} @ ${oneZone}` : base;
  }

  // Varied inner pattern (ladder/progression nested in a repeat): "3x(3-3-2-2) @ zone"
  const inner = workChildren.map(intervalToken).join("-");
  const base = `${step.count}x(${inner})`;
  return oneZone ? `${base} @ ${oneZone}` : base;
}

export function generateName(plan: WorkoutPlan): string {
  // Warmup and cooldown are framing, not content — they shouldn't appear in the name.
  const mainSteps = plan.steps.filter((s) => !isFraming(s));
  if (mainSteps.length === 0) return "Workout";

  // Detect flat sequence of work intervals (possibly interleaved with rests): "12-8-3 @ zone"
  const topLevelWorks = mainSteps.filter(isWorkInterval);
  const onlyIntervalsAtTop = mainSteps.every(
    (s) => s.kind === "interval" && (s.intent === "work" || s.intent === "rest" || s.intent === "recovery"),
  );

  if (onlyIntervalsAtTop && topLevelWorks.length >= 2) {
    const tokens = topLevelWorks.map(intervalToken);
    const zones = new Set(topLevelWorks.map(targetLabel).filter((t): t is string => !!t));
    const joined = tokens.join("-");
    if (joined) {
      if (zones.size === 1) {
        const [zone] = [...zones];
        return `${joined} @ ${zone}`;
      }
      return joined;
    }
  }

  // One or more independent main steps (intervals or repeats) — join descriptions with " + ".
  const parts = mainSteps
    .map(describeMainStep)
    .filter((p): p is string => !!p);

  if (parts.length === 0) return "Workout";
  return parts.join(" + ");
}
