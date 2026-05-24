import { describe, it, expect, afterEach } from "vitest";
import { parse, _resetSessionCache } from "./parse";
import { installLanguageModelMock, uninstallLanguageModelMock } from "../../tests/setup/languageModelMocks";
import type { ZoneConfig } from "../storage/types";

const zones: ZoneConfig = {
  unit: "min/km",
  zones: [
    { name: "easy", minSecPerKm: 315, maxSecPerKm: 345 },
    { name: "aerobic threshold", minSecPerKm: 270, maxSecPerKm: 285 },
  ],
};

afterEach(() => {
  _resetSessionCache();
  uninstallLanguageModelMock();
});

describe("parse", () => {
  it("returns the parsed plan when the LLM returns valid JSON", async () => {
    installLanguageModelMock({
      promptResponse: JSON.stringify({
        sport: "running",
        steps: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 720 },
            target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
        ],
      }),
    });
    const result = await parse("12' at aerobic threshold", zones);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3 steps because parse() now auto-adds an open warmup and cooldown
      // around the user's work interval.
      expect(result.value.plan.steps).toHaveLength(3);
      expect(result.value.plan.steps[0]?.kind === "interval" && result.value.plan.steps[0].intent).toBe("warmup");
      expect(result.value.plan.steps[2]?.kind === "interval" && result.value.plan.steps[2].intent).toBe("cooldown");
      expect(result.value.errors).toEqual([]);
    }
  });

  it("returns errors when LLM output references an unknown zone", async () => {
    installLanguageModelMock({
      promptResponse: JSON.stringify({
        sport: "running",
        steps: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
            target: { kind: "pace_zone", zoneName: "ghost zone" } },
        ],
      }),
    });
    const result = await parse("1min at ghost zone", zones);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.errors.some((e) => /ghost zone/.test(e.message))).toBe(true);
    }
  });

  it("fails with NOT_AVAILABLE when the Prompt API is unavailable", async () => {
    installLanguageModelMock({ available: false });
    const result = await parse("anything", zones);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_AVAILABLE");
  });

  it("fails with MALFORMED when LLM returns non-JSON", async () => {
    installLanguageModelMock({ promptResponse: "not json at all" });
    const result = await parse("anything", zones);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MALFORMED");
  });

  it("fails with MALFORMED when LLM returns JSON failing the schema", async () => {
    installLanguageModelMock({ promptResponse: JSON.stringify({ sport: "swimming", steps: [] }) });
    const result = await parse("anything", zones);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MALFORMED");
  });
});
