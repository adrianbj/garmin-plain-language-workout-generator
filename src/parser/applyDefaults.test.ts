import { describe, it, expect } from "vitest";
import { applyWarmupCooldownDefaults } from "./applyDefaults";
import type { WorkoutPlan } from "./types";

describe("applyWarmupCooldownDefaults", () => {
  it("prepends warmup and appends cooldown when neither is present", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 600 } },
      ],
    };
    const result = applyWarmupCooldownDefaults(plan);
    expect(result.steps).toHaveLength(3);
    const [first, , last] = result.steps;
    expect(first).toEqual({
      kind: "interval", intent: "warmup", duration: { unit: "open" },
    });
    expect(last).toEqual({
      kind: "interval", intent: "cooldown", duration: { unit: "open" },
    });
  });

  it("leaves a plan alone when both warmup and cooldown exist", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 900 } },
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 600 } },
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 600 } },
      ],
    };
    const result = applyWarmupCooldownDefaults(plan);
    expect(result.steps).toEqual(plan.steps);
  });

  it("only prepends warmup when cooldown is already present", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 600 } },
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 300 } },
      ],
    };
    const result = applyWarmupCooldownDefaults(plan);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]?.kind === "interval" && result.steps[0].intent).toBe("warmup");
    expect(result.steps[2]?.kind === "interval" && result.steps[2].intent).toBe("cooldown");
  });

  it("only appends cooldown when warmup is already present", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 600 } },
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 600 } },
      ],
    };
    const result = applyWarmupCooldownDefaults(plan);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2]?.kind === "interval" && result.steps[2].intent).toBe("cooldown");
  });
});
