import type { WorkoutPlan, ParseError } from "./types";
import type { ZoneConfig } from "../storage/types";
import { ok, err, type Result } from "../shared/result";
import { workoutPlanSchema, workoutPlanJsonSchema } from "./schema";
import { buildSystemPrompt } from "./prompt";
import { validate } from "./validate";
import { generateName } from "./nameGenerator";

export type ParseFailureCode = "NOT_AVAILABLE" | "MALFORMED" | "PROMPT_FAILED";

export type ParseFailure = {
  code: ParseFailureCode;
  message: string;
  cause?: unknown;
};

export type ParseSuccess = {
  plan: WorkoutPlan;
  errors: ParseError[];
};

type CachedSession = { key: string; session: LanguageModelSession };
let cached: CachedSession | undefined;

type LanguageModelSession = {
  prompt: (input: string, opts?: { responseConstraint?: unknown }) => Promise<string>;
  destroy: () => void;
};

type LanguageModelExpectation = { type: "text"; languages?: string[] };

type LanguageModelMonitor = {
  addEventListener: (
    type: "downloadprogress",
    listener: (event: { loaded: number; total?: number }) => void,
  ) => void;
};

type LanguageModelCreateOptions = {
  systemPrompt: string;
  expectedInputs?: LanguageModelExpectation[];
  expectedOutputs?: LanguageModelExpectation[];
  monitor?: (m: LanguageModelMonitor) => void;
};

type LanguageModelGlobal = {
  availability: () => Promise<string>;
  create: (opts: LanguageModelCreateOptions) => Promise<LanguageModelSession>;
};

const UNAVAILABLE_STATES = new Set(["no", "unavailable"]);

function getLM(): LanguageModelGlobal | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
}

async function getSession(zones: ZoneConfig): Promise<Result<LanguageModelSession, ParseFailure>> {
  const lm = getLM();
  if (!lm) return err({ code: "NOT_AVAILABLE", message: "Prompt API not available in this browser." });
  const availability = await lm.availability();
  console.log("[gwg] LanguageModel.availability:", availability);
  if (UNAVAILABLE_STATES.has(availability)) {
    return err({ code: "NOT_AVAILABLE", message: "Gemini Nano is not available on this device." });
  }
  const key = JSON.stringify(zones);
  if (cached && cached.key === key) return ok(cached.session);
  if (cached) cached.session.destroy();
  console.log("[gwg] creating LanguageModel session…");
  const t0 = performance.now();
  const session = await lm.create({
    systemPrompt: buildSystemPrompt(zones),
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        const pct = e.total ? Math.round((e.loaded / e.total) * 100) : Math.round(e.loaded * 100);
        console.log(`[gwg] Gemini Nano downloading: ${pct}%`);
      });
    },
  });
  console.log(`[gwg] session ready in ${Math.round(performance.now() - t0)}ms`);
  cached = { key, session };
  return ok(session);
}

export async function parse(
  text: string,
  zones: ZoneConfig,
): Promise<Result<ParseSuccess, ParseFailure>> {
  const sessionResult = await getSession(zones);
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.value;

  let raw: string;
  try {
    console.log("[gwg] prompting model…");
    const t0 = performance.now();
    raw = await session.prompt(text, { responseConstraint: workoutPlanJsonSchema });
    console.log(`[gwg] prompt completed in ${Math.round(performance.now() - t0)}ms`);
  } catch (cause) {
    console.error("[gwg] prompt failed:", cause);
    return err({ code: "PROMPT_FAILED", message: "The on-device model failed to respond.", cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err({ code: "MALFORMED", message: "Model output was not valid JSON.", cause });
  }

  const schemaResult = workoutPlanSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return err({ code: "MALFORMED", message: "Model output didn't match the workout schema.", cause: schemaResult.error });
  }

  const validated = schemaResult.data as unknown as WorkoutPlan;
  const name = validated.name ?? generateName(validated);
  const plan: WorkoutPlan = { ...validated, name };

  const errors = validate(plan, zones);
  return ok({ plan, errors });
}

/** Test-only helper to clear the cached session. */
export function _resetSessionCache(): void {
  if (cached) cached.session.destroy();
  cached = undefined;
}
