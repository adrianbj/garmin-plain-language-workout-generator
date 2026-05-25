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
    expect(generateName(plan)).toBe("45' easy");
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
    expect(generateName(plan)).toBe(`5x1k/2' @ 5k`);
  });

  it("describes a uniform repeat with no rest as just Nx<dur>", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 8, children: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 20 }, notes: "stride" },
      ]}],
    };
    expect(generateName(plan)).toBe(`8x20"`);
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
    expect(generateName(plan)).toBe(`12'-8'-3' @ aerobic threshold`);
  });

  it("ignores warmup and cooldown when naming a sandwiched workout", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 900 } },
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 1800 },
          target: { kind: "pace_zone", zoneName: "easy" } },
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 900 } },
      ],
    };
    // 15min warmup + 30min easy + 15min cooldown — must describe the WORK, not "15-15"
    expect(generateName(plan)).toBe("30' easy");
  });

  it("describes a repeat with varied inner steps as Nx(d1-d2-...)", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 900 } },
        { kind: "repeat", count: 3, children: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 120 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 120 } },
        ]},
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 900 } },
      ],
    };
    expect(generateName(plan)).toBe(`3x(3'-3'-2'-2')`);
  });

  it("joins multiple main work groups with +", () => {
    // The user's actual problem case:
    // 15' warmup, 4x20" strides + 3 sets of 3', 3', 2', 2' w 45" rests, 15' c/d
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 900 } },
        { kind: "repeat", count: 4, children: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 20 }, notes: "stride" },
        ]},
        { kind: "repeat", count: 3, children: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 120 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 45 } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 120 } },
        ]},
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 900 } },
      ],
    };
    expect(generateName(plan)).toBe(`4x20" + 3x(3'-3'-2'-2')`);
  });

  it("propagates a shared zone across a varied repeat", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "repeat", count: 3, children: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 180 },
            target: { kind: "pace_zone", zoneName: "threshold" } },
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 120 },
            target: { kind: "pace_zone", zoneName: "threshold" } },
        ]},
      ],
    };
    expect(generateName(plan)).toBe(`3x(3'-2') @ threshold`);
  });

  it("falls back to 'Workout' when nothing distinctive", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "open" } }],
    };
    expect(generateName(plan)).toBe("Workout");
  });
});
