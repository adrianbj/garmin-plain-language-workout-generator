import type { WorkoutPlan, ParseError } from "./types";
import type { ZoneConfig } from "../storage/types";
import { ok, err, type Result } from "../shared/result";
import { workoutPlanSchema, workoutPlanJsonSchema } from "./schema";
import { buildSystemPrompt } from "./prompt";
import { validate } from "./validate";
import { generateName } from "./nameGenerator";
import { getSettings } from "../storage/storage";
import { generateWithGeminiApi } from "./geminiApi";
import { applyWarmupCooldownDefaults } from "./applyDefaults";

export type ParseFailureCode =
  | "NOT_AVAILABLE"
  | "MALFORMED"
  | "PROMPT_FAILED"
  | "BAD_API_KEY"
  | "RATE_LIMITED"
  | "UNREACHABLE";

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

async function runGeminiNano(text: string, zones: ZoneConfig): Promise<Result<string, ParseFailure>> {
  const sessionResult = await getSession(zones);
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.value;
  try {
    console.log("[gwg] prompting Gemini Nano…");
    const t0 = performance.now();
    const raw = await session.prompt(text, { responseConstraint: workoutPlanJsonSchema });
    console.log(`[gwg] Nano prompt completed in ${Math.round(performance.now() - t0)}ms`);
    return ok(raw);
  } catch (cause) {
    console.error("[gwg] Nano prompt failed:", cause);
    return err({ code: "PROMPT_FAILED", message: "The on-device model failed to respond.", cause });
  }
}

async function runGeminiApi(text: string, zones: ZoneConfig, apiKey: string): Promise<Result<string, ParseFailure>> {
  console.log("[gwg] prompting Gemini API (Flash)…");
  const t0 = performance.now();
  const result = await generateWithGeminiApi(buildSystemPrompt(zones), text, apiKey);
  console.log(`[gwg] Gemini API completed in ${Math.round(performance.now() - t0)}ms`);
  if (!result.ok) {
    return err({ code: result.error.code, message: result.error.message });
  }
  return ok(result.text);
}

export async function parse(
  text: string,
  zones: ZoneConfig,
): Promise<Result<ParseSuccess, ParseFailure>> {
  const settings = await getSettings();
  const backend = settings.geminiApiKey ? "gemini-api" : "gemini-nano";
  console.log(`[gwg] using backend: ${backend}`);

  const rawResult = settings.geminiApiKey
    ? await runGeminiApi(text, zones, settings.geminiApiKey)
    : await runGeminiNano(text, zones);

  if (!rawResult.ok) return rawResult;
  const raw = rawResult.value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    console.error("[gwg] model output was not valid JSON. Raw output:", raw);
    return err({ code: "MALFORMED", message: "Model output was not valid JSON.", cause });
  }

  const schemaResult = workoutPlanSchema.safeParse(parsed);
  if (!schemaResult.success) {
    console.error("[gwg] model output failed schema validation.");
    console.error("[gwg] raw output:", raw);
    console.error("[gwg] parsed JSON:", parsed);
    console.error("[gwg] Zod issues:", schemaResult.error.issues);
    return err({ code: "MALFORMED", message: "Model output didn't match the workout schema.", cause: schemaResult.error });
  }

  const validated = schemaResult.data as unknown as WorkoutPlan;
  const name = validated.name ?? generateName(validated);
  const withDefaults = applyWarmupCooldownDefaults(validated);
  const plan: WorkoutPlan = { ...withDefaults, name };

  const errors = validate(plan, zones);
  return ok({ plan, errors });
}

/** Test-only helper to clear the cached session. */
export function _resetSessionCache(): void {
  if (cached) cached.session.destroy();
  cached = undefined;
}
