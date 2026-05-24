import { describe, it, expect } from "vitest";
import { generateName } from "./nameGenerator";
import type { WorkoutPlan } from "./types";

describe("generateName", () => {
  it("describes a single easy run", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "time", seconds: 2700 },
        target: { kind: "pace_zone", zoneName: "easy" } }],
    };
    expect(generateName(plan)).toBe("45min easy");
  });

  it("describes a uniform repeat", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 5, children: [
        { kind: "interval", intent: "work", duration: { unit: "distance", meters: 1000 },
          target: { kind: "pace_zone", zoneName: "5k" } },
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 120 } },
      ]}],
    };
    expect(generateName(plan)).toBe("5x1k @ 5k");
  });

  it("describes a varied flat sequence", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 720 },
          target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 120 } },
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 480 },
          target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 120 } },
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 },
          target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
      ],
    };
    expect(generateName(plan)).toBe("12-8-3 @ aerobic threshold");
  });

  it("falls back to 'Workout' when nothing distinctive", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "open" } }],
    };
    expect(generateName(plan)).toBe("Workout");
  });
});
