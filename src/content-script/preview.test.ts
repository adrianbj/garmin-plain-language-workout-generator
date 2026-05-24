import { describe, it, expect } from "vitest";
import { renderPreview } from "./preview";
import type { WorkoutPlan } from "../parser/types";

describe("renderPreview", () => {
  it("shows a single interval with target", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "time", seconds: 720 },
        target: { kind: "pace_zone", zoneName: "aerobic threshold" } }],
    };
    const html = renderPreview(plan);
    expect(html).toContain("12:00");
    expect(html).toContain("aerobic threshold");
    expect(html).toContain("Run");
  });

  it("labels rests and recoveries", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 120 } },
        { kind: "interval", intent: "recovery", duration: { unit: "time", seconds: 60 } },
      ],
    };
    const html = renderPreview(plan);
    expect(html).toContain("Rest");
    expect(html).toContain("Recover");
  });

  it("flattens repeats into bracketed rep groups", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 5, children: [
        { kind: "interval", intent: "work", duration: { unit: "distance", meters: 1000 } },
      ]}],
    };
    const html = renderPreview(plan);
    expect(html).toMatch(/5×/);
    expect(html).toContain("1.0 km");
  });

  it("shows a total step count and duration estimate", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 600 } },
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 60 } },
      ],
    };
    const html = renderPreview(plan);
    expect(html).toMatch(/2 steps/);
    expect(html).toMatch(/11:00/);
  });

  it("escapes user-provided notes", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
        notes: "<script>alert(1)</script>" }],
    };
    const html = renderPreview(plan);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
