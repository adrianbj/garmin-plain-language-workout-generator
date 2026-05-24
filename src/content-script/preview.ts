import type { WorkoutPlan, Step, IntervalStep } from "../parser/types";
import { formatDuration } from "../shared/format";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INTENT_LABEL: Record<IntervalStep["intent"], string> = {
  warmup: "Warm up",
  work: "Run",
  rest: "Rest",
  recovery: "Recover",
  cooldown: "Cool down",
};

function describeDuration(step: IntervalStep): string {
  if (step.duration.unit === "time") return formatDuration(step.duration.seconds);
  if (step.duration.unit === "distance") {
    const m = step.duration.meters;
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  }
  return "until lap";
}

function describeTarget(step: IntervalStep): string {
  if (!step.target) return "";
  switch (step.target.kind) {
    case "pace_zone":  return ` @ ${escape(step.target.zoneName)}`;
    case "pace_range": return ` @ ${formatDuration(step.target.minSecPerKm)}–${formatDuration(step.target.maxSecPerKm)}/km`;
    case "hr_range":   return ` @ ${step.target.minBpm}–${step.target.maxBpm} bpm`;
    case "rpe":        return ` @ RPE ${step.target.value}`;
  }
}

function intervalLine(step: IntervalStep, index: number): string {
  const label = INTENT_LABEL[step.intent];
  const dur = describeDuration(step);
  const tgt = describeTarget(step);
  const notes = step.notes ? ` <span class="gwg-notes">(${escape(step.notes)})</span>` : "";
  return `<li class="gwg-step"><span class="gwg-num">${index}.</span> ${escape(label)} ${escape(dur)}${tgt}${notes}</li>`;
}

function renderSteps(steps: Step[], counter: { value: number }): string {
  const parts: string[] = [];
  for (const step of steps) {
    if (step.kind === "interval") {
      counter.value += 1;
      parts.push(intervalLine(step, counter.value));
    } else {
      parts.push(`<li class="gwg-repeat-header">${step.count}× group:</li>`);
      parts.push(`<ol class="gwg-repeat">${renderSteps(step.children, counter)}</ol>`);
    }
  }
  return parts.join("");
}

function countAndDuration(steps: Step[]): { count: number; seconds: number } {
  let count = 0;
  let seconds = 0;
  const walk = (list: Step[], multiplier = 1) => {
    for (const s of list) {
      if (s.kind === "interval") {
        count += multiplier;
        if (s.duration.unit === "time") seconds += s.duration.seconds * multiplier;
        if (s.duration.unit === "distance") seconds += (s.duration.meters / 3) * multiplier;
      } else {
        walk(s.children, multiplier * s.count);
      }
    }
  };
  walk(steps);
  return { count, seconds };
}

export function renderPreview(plan: WorkoutPlan): string {
  const { count, seconds } = countAndDuration(plan.steps);
  const counter = { value: 0 };
  const items = renderSteps(plan.steps, counter);
  return `
    <div class="gwg-preview">
      <div class="gwg-preview-header">${count} steps · ${formatDuration(seconds)} total</div>
      <ol class="gwg-step-list">${items}</ol>
    </div>
  `.trim();
}
