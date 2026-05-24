# Garmin Workout Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that turns plain-language running workout descriptions into structured Garmin Connect workouts, parsed on-device with Chrome's built-in Prompt API and posted directly to Garmin's web API from an injected panel on the workout builder page.

**Architecture:** Five isolated modules — `parser/` (LLM-backed text→`WorkoutPlan`), `garmin/` (translate→Garmin JSON, POST), `storage/` (pace zones), `content-script/` (inline panel UI on connect.garmin.com), `options/` (zone config). Each module has one responsibility and a small public surface. No external network outside Garmin; no API keys.

**Tech Stack:** TypeScript (strict), Vite + `@crxjs/vite-plugin` (MV3 build), Vitest + happy-dom (tests), Zod (schema + JSON-schema generation), vanilla DOM (no UI framework — panel is small).

**Spec:** `docs/superpowers/specs/2026-05-24-garmin-workout-generator-design.md`

---

## File Structure

Files created across all tasks:

```
garmin-workout-generator/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── manifest.config.ts                  # MV3 manifest (TS for type safety)
├── docs/superpowers/discoveries/
│   └── garmin-api-shape.md             # filled by Task 2 (manual research)
├── src/
│   ├── shared/
│   │   ├── result.ts                   # Result<T, E> + helpers
│   │   ├── format.ts                   # seconds⇄"m:ss"
│   │   └── format.test.ts
│   ├── storage/
│   │   ├── types.ts                    # PaceZone, ZoneConfig
│   │   ├── defaults.ts                 # seed pace zones
│   │   ├── paceParser.ts               # "4:45" → 285
│   │   ├── paceParser.test.ts
│   │   ├── storage.ts                  # chrome.storage wrapper
│   │   └── storage.test.ts
│   ├── parser/
│   │   ├── types.ts                    # WorkoutPlan, Step, Target, Duration
│   │   ├── schema.ts                   # Zod schema + responseConstraint
│   │   ├── prompt.ts                   # system prompt builder + examples
│   │   ├── validate.ts                 # semantic validation
│   │   ├── validate.test.ts
│   │   ├── nameGenerator.ts            # auto-name from plan structure
│   │   ├── nameGenerator.test.ts
│   │   ├── parse.ts                    # orchestrator: LanguageModel + validate
│   │   └── parse.test.ts
│   ├── garmin/
│   │   ├── types.ts                    # GarminWorkoutJson etc.
│   │   ├── ids.ts                      # stepType/endCondition/target ID tables
│   │   ├── translate.ts                # WorkoutPlan → GarminWorkoutJson
│   │   ├── translate.test.ts
│   │   ├── pageContextFetch.ts         # inject <script> to fetch in page context
│   │   ├── client.ts                   # createWorkout()
│   │   └── client.test.ts
│   ├── content-script/
│   │   ├── index.ts                    # entrypoint registered in manifest
│   │   ├── mount.ts                    # MutationObserver mount/unmount
│   │   ├── panel.ts                    # panel DOM builder
│   │   ├── preview.ts                  # WorkoutPlan → preview HTML
│   │   ├── preview.test.ts
│   │   └── panel.css
│   └── options/
│       ├── options.html
│       ├── options.ts                  # zone editor UI
│       └── options.css
└── tests/setup/
    ├── chromeMocks.ts                  # chrome.storage mock factory
    └── languageModelMocks.ts           # LanguageModel mock factory
```

The split is by responsibility, not technical layer. `parser/`, `garmin/`, and `storage/` each export a tiny public surface (`parse`, `translate`+`createWorkout`, `getZoneConfig`+`setZoneConfig`) and can be replaced or rewritten independently.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `manifest.config.ts`
- Create: `.gitignore`
- Create: `src/content-script/index.ts` (stub)
- Create: `src/options/options.html` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "garmin-workout-generator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0",
    "@types/chrome": "^0.0.270",
    "@types/node": "^22.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome", "node", "vitest/globals"]
  },
  "include": ["src", "tests", "manifest.config.ts", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `manifest.config.ts`**

```ts
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Garmin Workout Generator",
  version: "0.1.0",
  description: "Generate Garmin running workouts from plain-language descriptions, on-device.",
  permissions: ["storage"],
  host_permissions: ["https://connect.garmin.com/*"],
  options_page: "src/options/options.html",
  content_scripts: [
    {
      matches: ["https://connect.garmin.com/modern/workout/*"],
      js: ["src/content-script/index.ts"],
      run_at: "document_idle",
    },
  ],
});
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup/chromeMocks.ts"],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.vite/
*.log
.DS_Store
.env*
```

- [ ] **Step 6: Create stub `src/content-script/index.ts`**

```ts
console.debug("[gwg] content script loaded");
```

- [ ] **Step 7: Create stub `src/options/options.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Garmin Workout Generator — Options</title>
  </head>
  <body>
    <h1>Pace zones</h1>
    <div id="root"></div>
    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Create stub `src/options/options.ts`**

```ts
console.debug("[gwg] options loaded");
```

- [ ] **Step 9: Create stub `tests/setup/chromeMocks.ts`**

```ts
// Filled in Task 5. For now, empty so Vitest setupFiles loads cleanly.
export {};
```

- [ ] **Step 10: Install dependencies**

Run: `npm install`
Expected: no errors; `node_modules/` populated.

- [ ] **Step 11: Verify build + tests run**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck passes; Vite produces `dist/manifest.json`; Vitest reports "no tests found" (exit 0).

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json vite.config.ts manifest.config.ts .gitignore src tests
git commit -m "Scaffold MV3 extension project with Vite + Vitest"
```

---

## Task 2: Garmin endpoint and JSON shape discovery

This is a manual research task. No code, but the deliverable (a markdown file) unblocks every Garmin task that follows. Do this BEFORE the parser/garmin tasks so we know exactly what shape we're targeting.

**Files:**
- Create: `docs/superpowers/discoveries/garmin-api-shape.md`

- [ ] **Step 1: Reconnaissance via existing libraries**

Open these in a browser and skim the workout-creation code paths:

- https://github.com/mkuthan/garmin-workouts — Python; see `garmin_workouts/workout.py` for the JSON shape it POSTs.
- https://github.com/Pythe1337N/garmin-connect — Node; search for `addWorkout` / `workouts` endpoints.
- https://github.com/ThomasRondof/GarminWorkoutAItoJSON — generates Garmin workout JSON; closest prior art.
- https://github.com/fulippo/share-your-garmin-workout — import path consumes Garmin's own JSON.

Record in `docs/superpowers/discoveries/garmin-api-shape.md`:

- The exact endpoint URL the library uses (e.g., `/web-gateway/workout-service/workout` vs `/proxy/workout-service/workout`).
- The HTTP method and required headers (especially `NK: NT`, `Content-Type`, any CSRF/`X-NK` headers).
- The top-level JSON shape: keys, nesting.
- The `stepType` ID mapping (`warmup=1`, `cooldown=2`, `interval=3`, `recovery=4`, `rest=5` — verify).
- The `endCondition` ID mapping (`lap.button`, `time`, `distance`).
- The `targetType` ID mapping (`no.target=1`, `pace.zone=6`, `heart.rate.zone=4` — verify).
- How repeats are nested (`RepeatGroupDTO`).
- Whether the request needs an `userProfilePk` or similar account-scoped field.

- [ ] **Step 2: Live verification in DevTools**

Log into https://connect.garmin.com. Open DevTools → Network. Create a tiny manual workout (e.g., `Run 5min easy` + `Run 1km @ pace` + cooldown). Hit Save.

Capture the POST request:

- **Request URL** (verbatim).
- **Request headers** (especially `NK`, `X-NK`, `X-Lang`, `Authorization`, any CSRF).
- **Request body** (the JSON payload — save it).
- **Response body** (note the `workoutId` field).

Save the request body to the discovery doc under a "Verified shape (captured YYYY-MM-DD)" heading. This is ground truth — the parser and translator target this shape.

- [ ] **Step 3: Identify the headers our client must send**

Compare the headers your browser sent against what a content script could send via `fetch` from page context. List which ones come "for free" from credentials/cookies vs which ones the page injects from JS state.

Record explicitly in the discovery doc:

```
Headers we must add explicitly when fetching from page context:
  - Content-Type: application/json
  - NK: NT
  - (any others discovered)

Headers that come automatically with credentials: 'include':
  - Cookie
  - Origin
  - (anything else)
```

- [ ] **Step 4: Capture a fixture for tests**

Save the verified request body as `tests/fixtures/garmin-workout-canonical.json`. This is the byte-for-byte expected shape that `translate.test.ts` will assert against.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/discoveries/garmin-api-shape.md tests/fixtures/garmin-workout-canonical.json
git commit -m "Document Garmin Connect workout API shape from live capture"
```

---

## Task 3: Shared utilities — Result type and time formatting

**Files:**
- Create: `src/shared/result.ts`
- Create: `src/shared/format.ts`
- Create: `src/shared/format.test.ts`

- [ ] **Step 1: Write `Result<T, E>` type**

`src/shared/result.ts`:

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

- [ ] **Step 2: Write failing tests for time formatting**

`src/shared/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDuration, parsePaceString, secondsPerKmToMps, mpsToSecondsPerKm } from "./format";

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(45)).toBe("0:45");
  });
  it("formats m:ss", () => {
    expect(formatDuration(285)).toBe("4:45");
  });
  it("formats h:mm:ss when over one hour", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });
  it("returns 0:00 for zero", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("parsePaceString", () => {
  it("parses m:ss", () => {
    expect(parsePaceString("4:45")).toBe(285);
  });
  it("parses with single-digit seconds", () => {
    expect(parsePaceString("4:5")).toBe(245);
  });
  it("returns null on invalid input", () => {
    expect(parsePaceString("xyz")).toBeNull();
    expect(parsePaceString("4:60")).toBeNull();
    expect(parsePaceString("")).toBeNull();
  });
});

describe("secondsPerKmToMps", () => {
  it("converts 4:00/km (240 s/km) to 4.167 m/s", () => {
    expect(secondsPerKmToMps(240)).toBeCloseTo(4.167, 3);
  });
});

describe("mpsToSecondsPerKm", () => {
  it("round-trips with secondsPerKmToMps", () => {
    expect(mpsToSecondsPerKm(secondsPerKmToMps(285))).toBeCloseTo(285, 0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- format.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/shared/format.ts`**

```ts
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parsePaceString(input: string): number | null {
  const match = /^(\d+):(\d{1,2})$/.exec(input.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  return minutes * 60 + seconds;
}

export function secondsPerKmToMps(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}

export function mpsToSecondsPerKm(mps: number): number {
  return 1000 / mps;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- format.test`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/
git commit -m "Add shared Result type and time/pace formatting helpers"
```

---

## Task 4: Storage — types, defaults, get/set

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/defaults.ts`
- Create: `src/storage/storage.ts`
- Create: `src/storage/storage.test.ts`
- Modify: `tests/setup/chromeMocks.ts`

- [ ] **Step 1: Define storage types**

`src/storage/types.ts`:

```ts
export type PaceUnit = "min/km" | "min/mi";

export type PaceZone = {
  name: string;
  minSecPerKm: number;
  maxSecPerKm: number;
};

export type ZoneConfig = {
  zones: PaceZone[];
  unit: PaceUnit;
};

export const STORAGE_KEY = "gwg.zoneConfig.v1" as const;
```

- [ ] **Step 2: Define defaults**

`src/storage/defaults.ts`:

```ts
import type { ZoneConfig } from "./types";

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  unit: "min/km",
  zones: [
    { name: "recovery",           minSecPerKm: 360, maxSecPerKm: 420 }, // 6:00–7:00
    { name: "easy",               minSecPerKm: 315, maxSecPerKm: 345 }, // 5:15–5:45
    { name: "marathon",           minSecPerKm: 285, maxSecPerKm: 300 }, // 4:45–5:00
    { name: "aerobic threshold",  minSecPerKm: 270, maxSecPerKm: 285 }, // 4:30–4:45
    { name: "5k",                 minSecPerKm: 240, maxSecPerKm: 255 }, // 4:00–4:15
  ],
};
```

- [ ] **Step 3: Write the chrome.storage mock**

`tests/setup/chromeMocks.ts`:

```ts
import { vi, beforeEach } from "vitest";

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

function makeStorageArea() {
  const data = new Map<string, unknown>();
  const listeners: Listener[] = [];

  const area = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) {
        return Object.fromEntries(data);
      }
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = data.get(k);
      return out;
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data.get(k), newValue: v };
        data.set(k, v);
      }
      for (const l of listeners) l(changes, "sync");
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    }),
    clear: vi.fn(async () => data.clear()),
  };
  return { area, listeners };
}

const sync = makeStorageArea();

globalThis.chrome = {
  storage: {
    sync: sync.area as unknown as chrome.storage.SyncStorageArea,
    onChanged: {
      addListener: (l: Listener) => sync.listeners.push(l),
      removeListener: (l: Listener) => {
        const i = sync.listeners.indexOf(l);
        if (i >= 0) sync.listeners.splice(i, 1);
      },
    } as unknown as chrome.storage.StorageChangedEvent,
  },
} as unknown as typeof chrome;

beforeEach(async () => {
  await chrome.storage.sync.clear();
});
```

- [ ] **Step 4: Write failing storage tests**

`src/storage/storage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getZoneConfig, setZoneConfig } from "./storage";
import { DEFAULT_ZONE_CONFIG } from "./defaults";

describe("storage", () => {
  it("returns defaults on first read", async () => {
    const config = await getZoneConfig();
    expect(config).toEqual(DEFAULT_ZONE_CONFIG);
  });

  it("round-trips a written config", async () => {
    const custom = {
      unit: "min/mi" as const,
      zones: [{ name: "tempo", minSecPerKm: 250, maxSecPerKm: 260 }],
    };
    await setZoneConfig(custom);
    expect(await getZoneConfig()).toEqual(custom);
  });

  it("falls back to defaults if stored value is malformed", async () => {
    await chrome.storage.sync.set({ "gwg.zoneConfig.v1": { junk: true } });
    expect(await getZoneConfig()).toEqual(DEFAULT_ZONE_CONFIG);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test -- storage.test`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `src/storage/storage.ts`**

```ts
import type { ZoneConfig, PaceZone } from "./types";
import { STORAGE_KEY } from "./types";
import { DEFAULT_ZONE_CONFIG } from "./defaults";

function isValidZone(z: unknown): z is PaceZone {
  return (
    typeof z === "object" && z !== null &&
    typeof (z as PaceZone).name === "string" &&
    typeof (z as PaceZone).minSecPerKm === "number" &&
    typeof (z as PaceZone).maxSecPerKm === "number" &&
    (z as PaceZone).minSecPerKm > 0 &&
    (z as PaceZone).maxSecPerKm >= (z as PaceZone).minSecPerKm
  );
}

function isValidConfig(c: unknown): c is ZoneConfig {
  if (typeof c !== "object" || c === null) return false;
  const cc = c as Partial<ZoneConfig>;
  if (cc.unit !== "min/km" && cc.unit !== "min/mi") return false;
  if (!Array.isArray(cc.zones)) return false;
  return cc.zones.every(isValidZone);
}

export async function getZoneConfig(): Promise<ZoneConfig> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (isValidConfig(raw)) return raw;
  return DEFAULT_ZONE_CONFIG;
}

export async function setZoneConfig(config: ZoneConfig): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: config });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- storage.test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/storage/ tests/setup/chromeMocks.ts
git commit -m "Add pace zone storage with chrome.storage.sync and defaults"
```

---

## Task 5: Pace-string parser ("4:45" → 285) for the options UI

`parsePaceString` already exists from Task 3. This task adds a wrapper that returns `Result` with a human-readable error for the options page.

**Files:**
- Create: `src/storage/paceParser.ts`
- Create: `src/storage/paceParser.test.ts`

- [ ] **Step 1: Write failing tests**

`src/storage/paceParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePaceField } from "./paceParser";

describe("parsePaceField", () => {
  it("parses valid m:ss", () => {
    const r = parsePaceField("4:45");
    expect(r).toEqual({ ok: true, value: 285 });
  });

  it("rejects empty string with a friendly error", () => {
    const r = parsePaceField("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pace required/i);
  });

  it("rejects 4:60 with a friendly error", () => {
    const r = parsePaceField("4:60");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format/i);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePaceField("  4:45  ")).toEqual({ ok: true, value: 285 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- paceParser.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/storage/paceParser.ts`:

```ts
import { ok, err, type Result } from "../shared/result";
import { parsePaceString } from "../shared/format";

export function parsePaceField(input: string): Result<number, string> {
  const trimmed = input.trim();
  if (trimmed === "") return err("Pace required (e.g. 4:45)");
  const seconds = parsePaceString(trimmed);
  if (seconds === null) return err("Bad format — use m:ss (e.g. 4:45)");
  return ok(seconds);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- paceParser.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/paceParser.ts src/storage/paceParser.test.ts
git commit -m "Add user-facing pace field parser returning Result"
```

---

## Task 6: Parser types and Zod schema

**Files:**
- Create: `src/parser/types.ts`
- Create: `src/parser/schema.ts`

- [ ] **Step 1: Create `src/parser/types.ts`**

```ts
export type WorkoutPlan = {
  name?: string;
  sport: "running";
  steps: Step[];
};

export type Step = IntervalStep | RepeatBlock;

export type IntervalStep = {
  kind: "interval";
  intent: "warmup" | "work" | "rest" | "recovery" | "cooldown";
  duration: Duration;
  target?: Target;
  notes?: string;
};

export type RepeatBlock = {
  kind: "repeat";
  count: number;
  children: Step[];
};

export type Duration =
  | { unit: "time"; seconds: number }
  | { unit: "distance"; meters: number }
  | { unit: "open" };

export type Target =
  | { kind: "pace_zone"; zoneName: string }
  | { kind: "pace_range"; minSecPerKm: number; maxSecPerKm: number }
  | { kind: "hr_range"; minBpm: number; maxBpm: number }
  | { kind: "rpe"; value: number };

export type ParseError = {
  severity: "error" | "warning";
  message: string;
  suggestion?: string;
};
```

- [ ] **Step 2: Create `src/parser/schema.ts`** — Zod schema with same shape, plus JSON-schema export for `responseConstraint`

```ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const durationSchema = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("time"), seconds: z.number().positive() }),
  z.object({ unit: z.literal("distance"), meters: z.number().positive() }),
  z.object({ unit: z.literal("open") }),
]);

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pace_zone"), zoneName: z.string().min(1) }),
  z.object({
    kind: z.literal("pace_range"),
    minSecPerKm: z.number().positive(),
    maxSecPerKm: z.number().positive(),
  }),
  z.object({
    kind: z.literal("hr_range"),
    minBpm: z.number().positive(),
    maxBpm: z.number().positive(),
  }),
  z.object({ kind: z.literal("rpe"), value: z.number().min(1).max(10) }),
]);

const intervalStepSchema = z.object({
  kind: z.literal("interval"),
  intent: z.enum(["warmup", "work", "rest", "recovery", "cooldown"]),
  duration: durationSchema,
  target: targetSchema.optional(),
  notes: z.string().optional(),
});

// Recursive — must be defined with z.lazy.
type StepIn = z.infer<typeof intervalStepSchema> | { kind: "repeat"; count: number; children: StepIn[] };

const stepSchema: z.ZodType<StepIn> = z.lazy(() =>
  z.union([
    intervalStepSchema,
    z.object({
      kind: z.literal("repeat"),
      count: z.number().int().positive(),
      children: z.array(stepSchema).min(1),
    }),
  ]),
);

export const workoutPlanSchema = z.object({
  name: z.string().optional(),
  sport: z.literal("running"),
  steps: z.array(stepSchema).min(1),
});

export type WorkoutPlanParsed = z.infer<typeof workoutPlanSchema>;

export const workoutPlanJsonSchema = zodToJsonSchema(workoutPlanSchema, {
  name: "WorkoutPlan",
  $refStrategy: "none",
});
```

- [ ] **Step 3: Typecheck to verify no errors**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/parser/types.ts src/parser/schema.ts
git commit -m "Define WorkoutPlan TypeScript types and Zod schema"
```

---

## Task 7: Parser system prompt builder

**Files:**
- Create: `src/parser/prompt.ts`

- [ ] **Step 1: Implement the prompt builder**

`src/parser/prompt.ts`:

```ts
import type { ZoneConfig } from "../storage/types";

export function buildSystemPrompt(zoneConfig: ZoneConfig): string {
  const zoneList = zoneConfig.zones.map((z) => z.name).join(", ");
  return `You convert running workout descriptions into structured JSON.

Available pace zones: ${zoneList}

Output a JSON object matching this shape:
- sport is always "running"
- steps is a flat list; each step is either an "interval" or a "repeat"
- intervals have: kind:"interval", intent (warmup|work|rest|recovery|cooldown), duration, target (optional), notes (optional)
- repeats have: kind:"repeat", count, children (array of steps)
- duration units: "time" (seconds), "distance" (meters), or "open" (lap-button to advance)
- target kinds: "pace_zone" (zoneName from the list above), "pace_range", "hr_range", "rpe" (1–10). Omit target if none.

Rules:
- One interval per discrete segment of running.
- "w/u" / "warmup" / "warm up" → intent:"warmup". If no duration given, default 900 seconds (15 min).
- "c/d" / "cooldown" → intent:"cooldown". If no duration given, default 600 seconds (10 min).
- Recoveries described as a faster "float" → intent:"recovery". Otherwise rests → intent:"rest".
- "5x" / "N times" / "N reps" → use a "repeat" with count:N when the inner pattern is uniform across all reps.
  Inside a repeat ("5x 1k w/ 2' rest"): the rest is part of the repeat unit; children is [work, rest] for every rep including the last.
- If the inner pattern varies between reps (a ladder like 400-800-1200), emit a flat sequence instead of a repeat.
- For a varied flat sequence with interleaved rests ("12', 8', 3' w/ 2' rests throughout"), emit rests BETWEEN work intervals but NOT after the final work interval, unless the user explicitly says "with rest after the last one".
- "@ <zone name>" → target:{kind:"pace_zone", zoneName:"<matched name>"}. Match case-insensitively to the available zones. If no match, omit target and put the literal in notes.
- Unrecognized phrasing → put the segment in notes with no target. Never invent paces or zones.

Examples:

Input: "12', 8', 3', 8', 12' at aerobic threshold pace w 2' jogging rests throughout"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":720},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":480},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":180},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":480},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":720},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}}
  ]
}

Input: "15' easy w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"warmup","duration":{"unit":"time","seconds":900},"target":{"kind":"pace_zone","zoneName":"easy"}},
    {"kind":"repeat","count":5,"children":[
      {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":1000},"target":{"kind":"pace_zone","zoneName":"5k"}},
      {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120}}
    ]},
    {"kind":"interval","intent":"cooldown","duration":{"unit":"time","seconds":600},"target":{"kind":"pace_zone","zoneName":"easy"}}
  ]
}

Input: "400-800-1200-800-400 @ mile pace w/ equal time recovery"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":400},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":80}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":800},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":160}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":1200},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":240}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":800},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":160}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":400},"notes":"@ mile pace"}
  ]
}
`;
}
```

Note: the third example deliberately uses `notes:"@ mile pace"` (no target) because "mile pace" is not in the seed-default zones. The model should reproduce this behavior when a zone isn't in the configured list.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/parser/prompt.ts
git commit -m "Add parser system prompt with three few-shot examples"
```

---

## Task 8: Parser validate() — semantic checks

**Files:**
- Create: `src/parser/validate.ts`
- Create: `src/parser/validate.test.ts`

- [ ] **Step 1: Write failing tests**

`src/parser/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validate } from "./validate";
import type { WorkoutPlan } from "./types";
import type { ZoneConfig } from "../storage/types";

const zones: ZoneConfig = {
  unit: "min/km",
  zones: [
    { name: "easy", minSecPerKm: 315, maxSecPerKm: 345 },
    { name: "aerobic threshold", minSecPerKm: 270, maxSecPerKm: 285 },
  ],
};

const valid: WorkoutPlan = {
  sport: "running",
  steps: [
    { kind: "interval", intent: "work", duration: { unit: "time", seconds: 720 },
      target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
  ],
};

describe("validate", () => {
  it("accepts a valid plan", () => {
    expect(validate(valid, zones)).toEqual([]);
  });

  it("errors when a pace_zone references an unknown name", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
          target: { kind: "pace_zone", zoneName: "lactate threshold" } },
      ],
    };
    const errors = validate(plan, zones);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe("error");
    expect(errors[0].message).toMatch(/lactate threshold/);
  });

  it("suggests a close match for misspellings", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
          target: { kind: "pace_zone", zoneName: "aerobic threshhold" } },
      ],
    };
    const errors = validate(plan, zones);
    expect(errors[0].suggestion).toBe("aerobic threshold");
  });

  it("matches zone names case-insensitively without error", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
          target: { kind: "pace_zone", zoneName: "EASY" } },
      ],
    };
    expect(validate(plan, zones)).toEqual([]);
  });

  it("errors on empty step list", () => {
    const plan: WorkoutPlan = { sport: "running", steps: [] };
    const errors = validate(plan, zones);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no steps/i);
  });

  it("errors on a repeat with count < 1", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 0, children: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 } },
      ] }],
    };
    expect(validate(plan, zones).some(e => /repeat count/i.test(e.message))).toBe(true);
  });

  it("warns when total duration exceeds 8 hours", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "time", seconds: 9 * 3600 } }],
    };
    const errors = validate(plan, zones);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe("warning");
  });

  it("recurses into repeats to validate inner pace zones", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 3, children: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 },
          target: { kind: "pace_zone", zoneName: "nonsense" } },
      ] }],
    };
    expect(validate(plan, zones).some(e => /nonsense/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- validate.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/parser/validate.ts`:

```ts
import type { WorkoutPlan, Step, ParseError, IntervalStep } from "./types";
import type { ZoneConfig } from "../storage/types";

const MAX_WORKOUT_SECONDS = 8 * 3600;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

function closestZoneName(input: string, zoneNames: string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const name of zoneNames) {
    const d = levenshtein(input.toLowerCase(), name.toLowerCase());
    if (!best || d < best.distance) best = { name, distance: d };
  }
  if (best && best.distance <= 3 && best.distance > 0) return best.name;
  return undefined;
}

function estimateDurationSeconds(step: Step): number {
  if (step.kind === "interval") {
    if (step.duration.unit === "time") return step.duration.seconds;
    if (step.duration.unit === "distance") return step.duration.meters / 3; // ~3 m/s rough est
    return 0; // open
  }
  const inner = step.children.reduce((sum, c) => sum + estimateDurationSeconds(c), 0);
  return inner * step.count;
}

function walkIntervals(steps: Step[], visit: (s: IntervalStep) => void): void {
  for (const s of steps) {
    if (s.kind === "interval") visit(s);
    else walkIntervals(s.children, visit);
  }
}

function walkRepeats(steps: Step[], visit: (count: number) => void): void {
  for (const s of steps) {
    if (s.kind === "repeat") {
      visit(s.count);
      walkRepeats(s.children, visit);
    }
  }
}

export function validate(plan: WorkoutPlan, zones: ZoneConfig): ParseError[] {
  const errors: ParseError[] = [];

  if (plan.steps.length === 0) {
    errors.push({ severity: "error", message: "Plan has no steps." });
    return errors;
  }

  const zoneNames = zones.zones.map((z) => z.name);
  const zoneNamesLower = new Set(zoneNames.map((n) => n.toLowerCase()));

  walkIntervals(plan.steps, (s) => {
    if (s.target?.kind === "pace_zone") {
      const lower = s.target.zoneName.toLowerCase();
      if (!zoneNamesLower.has(lower)) {
        const suggestion = closestZoneName(s.target.zoneName, zoneNames);
        errors.push({
          severity: "error",
          message: `Pace zone "${s.target.zoneName}" is not configured.`,
          ...(suggestion ? { suggestion } : {}),
        });
      }
    }
    if (s.duration.unit === "time" && s.duration.seconds <= 0) {
      errors.push({ severity: "error", message: "Step duration must be positive." });
    }
    if (s.duration.unit === "distance" && s.duration.meters <= 0) {
      errors.push({ severity: "error", message: "Step distance must be positive." });
    }
  });

  walkRepeats(plan.steps, (count) => {
    if (count < 1) {
      errors.push({ severity: "error", message: `Repeat count must be ≥ 1 (got ${count}).` });
    }
  });

  const totalSec = plan.steps.reduce((sum, s) => sum + estimateDurationSeconds(s), 0);
  if (totalSec > MAX_WORKOUT_SECONDS) {
    errors.push({
      severity: "warning",
      message: `Total workout duration is ~${Math.round(totalSec / 60)} min — unusually long.`,
    });
  }

  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- validate.test`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parser/validate.ts src/parser/validate.test.ts
git commit -m "Add parser semantic validation with zone-name fuzzy suggestions"
```

---

## Task 9: Auto-generated workout name

**Files:**
- Create: `src/parser/nameGenerator.ts`
- Create: `src/parser/nameGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

`src/parser/nameGenerator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- nameGenerator.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/parser/nameGenerator.ts`:

```ts
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
  // Single work interval: "45min easy"
  const workSteps = plan.steps.filter(isWork);
  if (plan.steps.length === 1 && workSteps.length === 1) {
    const only = workSteps[0];
    const dur = describeDuration(only);
    const tgt = targetLabel(only);
    if (dur && tgt) return `${dur} ${tgt}`;
    if (dur) return dur;
    return "Workout";
  }

  // Single uniform repeat: "5x1k @ 5k"
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

  // Varied sequence of work intervals: "12-8-3 @ aerobic threshold"
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- nameGenerator.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parser/nameGenerator.ts src/parser/nameGenerator.test.ts
git commit -m "Auto-generate workout names from plan structure"
```

---

## Task 10: Parser orchestrator — `parse()`

**Files:**
- Create: `tests/setup/languageModelMocks.ts`
- Create: `src/parser/parse.ts`
- Create: `src/parser/parse.test.ts`

- [ ] **Step 1: Define the LanguageModel test mock**

`tests/setup/languageModelMocks.ts`:

```ts
import { vi } from "vitest";

export type LanguageModelMockOptions = {
  available?: boolean;
  promptResponse?: string;
  promptError?: Error;
};

export function installLanguageModelMock(opts: LanguageModelMockOptions = {}) {
  const session = {
    prompt: vi.fn(async (_input: string, _o?: unknown) => {
      if (opts.promptError) throw opts.promptError;
      return opts.promptResponse ?? "{}";
    }),
    destroy: vi.fn(),
  };
  const LanguageModel = {
    availability: vi.fn(async () => (opts.available === false ? "no" : "readily")),
    create: vi.fn(async () => session),
  };
  (globalThis as any).LanguageModel = LanguageModel;
  return { session, LanguageModel };
}

export function uninstallLanguageModelMock() {
  delete (globalThis as any).LanguageModel;
}
```

- [ ] **Step 2: Write failing parse tests**

`src/parser/parse.test.ts`:

```ts
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
      expect(result.value.plan.steps).toHaveLength(1);
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- parse.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/parser/parse.ts`**

```ts
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

// Cached session, keyed by serialized zone config.
type CachedSession = { key: string; session: LanguageModelSession };
let cached: CachedSession | undefined;

type LanguageModelSession = {
  prompt: (input: string, opts?: { responseConstraint?: unknown }) => Promise<string>;
  destroy: () => void;
};

type LanguageModelGlobal = {
  availability: () => Promise<"no" | "readily" | "after-download" | "downloadable">;
  create: (opts: { systemPrompt: string }) => Promise<LanguageModelSession>;
};

function getLM(): LanguageModelGlobal | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
}

async function getSession(zones: ZoneConfig): Promise<Result<LanguageModelSession, ParseFailure>> {
  const lm = getLM();
  if (!lm) return err({ code: "NOT_AVAILABLE", message: "Prompt API not available in this browser." });
  const availability = await lm.availability();
  if (availability === "no") return err({ code: "NOT_AVAILABLE", message: "Gemini Nano is not available on this device." });
  const key = JSON.stringify(zones);
  if (cached && cached.key === key) return ok(cached.session);
  if (cached) cached.session.destroy();
  const session = await lm.create({ systemPrompt: buildSystemPrompt(zones) });
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
    raw = await session.prompt(text, { responseConstraint: workoutPlanJsonSchema });
  } catch (cause) {
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

  const plan: WorkoutPlan = {
    ...schemaResult.data,
    name: schemaResult.data.name ?? generateName(schemaResult.data as WorkoutPlan),
  };

  const errors = validate(plan, zones);
  return ok({ plan, errors });
}

/** Test-only helper to clear the cached session. */
export function _resetSessionCache(): void {
  if (cached) cached.session.destroy();
  cached = undefined;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- parse.test`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/parser/parse.ts src/parser/parse.test.ts tests/setup/languageModelMocks.ts
git commit -m "Add parse() orchestrator with LanguageModel session caching"
```

---

## Task 11: Garmin types and ID tables

**Files:**
- Create: `src/garmin/types.ts`
- Create: `src/garmin/ids.ts`

- [ ] **Step 1: Define Garmin JSON types**

`src/garmin/types.ts` — names and shape follow what Task 2 discovered. The shape below matches the community libraries' consensus; **the engineer MUST cross-check against the discovery doc and adjust if Garmin's actual shape differs**.

```ts
export type GarminSportType = { sportTypeId: number; sportTypeKey: string };
export type GarminStepType = { stepTypeId: number; stepTypeKey: string };
export type GarminEndCondition = { conditionTypeId: number; conditionTypeKey: string };
export type GarminTargetType = { workoutTargetTypeId: number; workoutTargetTypeKey: string };

export type GarminExecutableStep = {
  type: "ExecutableStepDTO";
  stepOrder: number;
  stepType: GarminStepType;
  endCondition: GarminEndCondition;
  endConditionValue?: number;
  targetType: GarminTargetType;
  targetValueOne?: number;
  targetValueTwo?: number;
  description?: string;
};

export type GarminRepeatStep = {
  type: "RepeatGroupDTO";
  stepOrder: number;
  stepType: GarminStepType; // { stepTypeId: 6, stepTypeKey: "repeat" } per discovery
  numberOfIterations: number;
  endCondition: GarminEndCondition; // { conditionTypeId: 7, conditionTypeKey: "iterations" }
  workoutSteps: GarminWorkoutStep[];
};

export type GarminWorkoutStep = GarminExecutableStep | GarminRepeatStep;

export type GarminWorkoutSegment = {
  segmentOrder: number;
  sportType: GarminSportType;
  workoutSteps: GarminWorkoutStep[];
};

export type GarminWorkoutJson = {
  workoutName: string;
  sportType: GarminSportType;
  workoutSegments: [GarminWorkoutSegment];
};
```

- [ ] **Step 2: Define ID tables**

`src/garmin/ids.ts` — values from the discovery doc. If discovery shows different IDs, update here.

```ts
import type { GarminSportType, GarminStepType, GarminEndCondition, GarminTargetType } from "./types";

export const RUNNING_SPORT: GarminSportType = { sportTypeId: 1, sportTypeKey: "running" };

export const STEP_TYPE: Record<"warmup" | "cooldown" | "work" | "rest" | "recovery" | "repeat", GarminStepType> = {
  warmup:   { stepTypeId: 1, stepTypeKey: "warmup" },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown" },
  work:     { stepTypeId: 3, stepTypeKey: "interval" },
  rest:     { stepTypeId: 5, stepTypeKey: "rest" },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery" },
  repeat:   { stepTypeId: 6, stepTypeKey: "repeat" },
};

export const END_CONDITION: Record<"lap_button" | "time" | "distance" | "iterations", GarminEndCondition> = {
  lap_button: { conditionTypeId: 1, conditionTypeKey: "lap.button" },
  time:       { conditionTypeId: 2, conditionTypeKey: "time" },
  distance:   { conditionTypeId: 3, conditionTypeKey: "distance" },
  iterations: { conditionTypeId: 7, conditionTypeKey: "iterations" },
};

export const TARGET_TYPE: Record<"no_target" | "pace_zone" | "hr_zone", GarminTargetType> = {
  no_target: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
  pace_zone: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone" },
  hr_zone:   { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" },
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/garmin/types.ts src/garmin/ids.ts
git commit -m "Define Garmin Connect workout JSON types and ID tables"
```

---

## Task 12: Garmin translate() — `WorkoutPlan → GarminWorkoutJson`

**Files:**
- Create: `src/garmin/translate.ts`
- Create: `src/garmin/translate.test.ts`

- [ ] **Step 1: Write failing tests**

`src/garmin/translate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { translate } from "./translate";
import type { WorkoutPlan } from "../parser/types";
import type { ZoneConfig } from "../storage/types";

const zones: ZoneConfig = {
  unit: "min/km",
  zones: [
    { name: "aerobic threshold", minSecPerKm: 270, maxSecPerKm: 285 },
    { name: "easy", minSecPerKm: 315, maxSecPerKm: 345 },
  ],
};

describe("translate", () => {
  it("translates a single time-based work interval with a pace zone", () => {
    const plan: WorkoutPlan = {
      name: "Test",
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "time", seconds: 720 },
          target: { kind: "pace_zone", zoneName: "aerobic threshold" } },
      ],
    };
    const out = translate(plan, zones);
    expect(out.workoutName).toBe("Test");
    expect(out.sportType.sportTypeKey).toBe("running");
    expect(out.workoutSegments).toHaveLength(1);
    expect(out.workoutSegments[0].workoutSteps).toHaveLength(1);
    const step = out.workoutSegments[0].workoutSteps[0];
    expect(step.type).toBe("ExecutableStepDTO");
    if (step.type === "ExecutableStepDTO") {
      expect(step.stepType.stepTypeKey).toBe("interval");
      expect(step.endCondition.conditionTypeKey).toBe("time");
      expect(step.endConditionValue).toBe(720);
      expect(step.targetType.workoutTargetTypeKey).toBe("pace.zone");
      // pace 270 s/km = 3.704 m/s (faster bound); 285 s/km = 3.509 m/s (slower bound)
      // Garmin: targetValueOne = slower m/s, targetValueTwo = faster m/s
      expect(step.targetValueOne).toBeCloseTo(3.509, 3);
      expect(step.targetValueTwo).toBeCloseTo(3.704, 3);
    }
  });

  it("translates a distance-based step", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "work", duration: { unit: "distance", meters: 1000 } },
      ],
    };
    const out = translate(plan, zones);
    const step = out.workoutSegments[0].workoutSteps[0];
    if (step.type === "ExecutableStepDTO") {
      expect(step.endCondition.conditionTypeKey).toBe("distance");
      expect(step.endConditionValue).toBe(1000);
      expect(step.targetType.workoutTargetTypeKey).toBe("no.target");
    }
  });

  it("translates an open-ended step to lap.button", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "warmup", duration: { unit: "open" } }],
    };
    const step = translate(plan, zones).workoutSegments[0].workoutSteps[0];
    if (step.type === "ExecutableStepDTO") {
      expect(step.endCondition.conditionTypeKey).toBe("lap.button");
      expect(step.endConditionValue).toBeUndefined();
    }
  });

  it("wraps repeats in a RepeatGroupDTO with iterations end condition", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "repeat", count: 5, children: [
        { kind: "interval", intent: "work", duration: { unit: "distance", meters: 1000 } },
        { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 120 } },
      ]}],
    };
    const out = translate(plan, zones);
    const repeat = out.workoutSegments[0].workoutSteps[0];
    expect(repeat.type).toBe("RepeatGroupDTO");
    if (repeat.type === "RepeatGroupDTO") {
      expect(repeat.numberOfIterations).toBe(5);
      expect(repeat.endCondition.conditionTypeKey).toBe("iterations");
      expect(repeat.workoutSteps).toHaveLength(2);
    }
  });

  it("preserves notes in the description field", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "rest",
        duration: { unit: "time", seconds: 60 }, notes: "jog" }],
    };
    const step = translate(plan, zones).workoutSegments[0].workoutSteps[0];
    if (step.type === "ExecutableStepDTO") {
      expect(step.description).toBe("jog");
    }
  });

  it("encodes RPE in the description since Garmin has no native RPE target", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work",
        duration: { unit: "time", seconds: 60 }, target: { kind: "rpe", value: 8 } }],
    };
    const step = translate(plan, zones).workoutSegments[0].workoutSteps[0];
    if (step.type === "ExecutableStepDTO") {
      expect(step.targetType.workoutTargetTypeKey).toBe("no.target");
      expect(step.description).toMatch(/RPE 8/);
    }
  });

  it("uses the auto-generated name when none provided", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [{ kind: "interval", intent: "work", duration: { unit: "time", seconds: 1800 },
        target: { kind: "pace_zone", zoneName: "easy" } }],
    };
    expect(translate(plan, zones).workoutName).toBe("30min easy");
  });

  it("assigns stepOrder sequentially across nested steps", () => {
    const plan: WorkoutPlan = {
      sport: "running",
      steps: [
        { kind: "interval", intent: "warmup", duration: { unit: "time", seconds: 300 } },
        { kind: "repeat", count: 2, children: [
          { kind: "interval", intent: "work", duration: { unit: "time", seconds: 60 } },
          { kind: "interval", intent: "rest", duration: { unit: "time", seconds: 30 } },
        ]},
        { kind: "interval", intent: "cooldown", duration: { unit: "time", seconds: 300 } },
      ],
    };
    const steps = translate(plan, zones).workoutSegments[0].workoutSteps;
    expect(steps[0].stepOrder).toBe(1);  // warmup
    expect(steps[1].stepOrder).toBe(2);  // repeat group
    if (steps[1].type === "RepeatGroupDTO") {
      expect(steps[1].workoutSteps[0].stepOrder).toBe(3);  // inner work
      expect(steps[1].workoutSteps[1].stepOrder).toBe(4);  // inner rest
    }
    expect(steps[2].stepOrder).toBe(5);  // cooldown
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- translate.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/garmin/translate.ts`:

```ts
import type {
  GarminWorkoutJson,
  GarminWorkoutStep,
  GarminExecutableStep,
  GarminRepeatStep,
} from "./types";
import { RUNNING_SPORT, STEP_TYPE, END_CONDITION, TARGET_TYPE } from "./ids";
import type { WorkoutPlan, Step, IntervalStep, Target } from "../parser/types";
import type { ZoneConfig } from "../storage/types";
import { secondsPerKmToMps } from "../shared/format";
import { generateName } from "../parser/nameGenerator";

function findZone(zones: ZoneConfig, name: string) {
  const lower = name.toLowerCase();
  return zones.zones.find((z) => z.name.toLowerCase() === lower);
}

type TargetEncoding = {
  targetType: GarminExecutableStep["targetType"];
  targetValueOne?: number;
  targetValueTwo?: number;
  descriptionAddition?: string;
};

function encodeTarget(target: Target | undefined, zones: ZoneConfig): TargetEncoding {
  if (!target) return { targetType: TARGET_TYPE.no_target };

  if (target.kind === "pace_zone") {
    const zone = findZone(zones, target.zoneName);
    if (!zone) return { targetType: TARGET_TYPE.no_target, descriptionAddition: `@ ${target.zoneName}` };
    // Garmin convention: targetValueOne = slower bound m/s (smaller m/s), targetValueTwo = faster
    const slowMps = secondsPerKmToMps(zone.maxSecPerKm);
    const fastMps = secondsPerKmToMps(zone.minSecPerKm);
    return {
      targetType: TARGET_TYPE.pace_zone,
      targetValueOne: slowMps,
      targetValueTwo: fastMps,
    };
  }

  if (target.kind === "pace_range") {
    return {
      targetType: TARGET_TYPE.pace_zone,
      targetValueOne: secondsPerKmToMps(target.maxSecPerKm),
      targetValueTwo: secondsPerKmToMps(target.minSecPerKm),
    };
  }

  if (target.kind === "hr_range") {
    return {
      targetType: TARGET_TYPE.hr_zone,
      targetValueOne: target.minBpm,
      targetValueTwo: target.maxBpm,
    };
  }

  // RPE — no native Garmin equivalent; encode in description.
  return { targetType: TARGET_TYPE.no_target, descriptionAddition: `RPE ${target.value}` };
}

function encodeDuration(step: IntervalStep): Pick<GarminExecutableStep, "endCondition" | "endConditionValue"> {
  if (step.duration.unit === "time") {
    return { endCondition: END_CONDITION.time, endConditionValue: step.duration.seconds };
  }
  if (step.duration.unit === "distance") {
    return { endCondition: END_CONDITION.distance, endConditionValue: step.duration.meters };
  }
  return { endCondition: END_CONDITION.lap_button };
}

function combineDescription(notes: string | undefined, addition: string | undefined): string | undefined {
  if (notes && addition) return `${notes} (${addition})`;
  return notes ?? addition;
}

type Counter = { value: number };

function encodeStep(step: Step, zones: ZoneConfig, counter: Counter): GarminWorkoutStep {
  counter.value += 1;
  const stepOrder = counter.value;

  if (step.kind === "interval") {
    const target = encodeTarget(step.target, zones);
    const duration = encodeDuration(step);
    const description = combineDescription(step.notes, target.descriptionAddition);
    const exec: GarminExecutableStep = {
      type: "ExecutableStepDTO",
      stepOrder,
      stepType: STEP_TYPE[step.intent],
      ...duration,
      targetType: target.targetType,
      ...(target.targetValueOne !== undefined ? { targetValueOne: target.targetValueOne } : {}),
      ...(target.targetValueTwo !== undefined ? { targetValueTwo: target.targetValueTwo } : {}),
      ...(description !== undefined ? { description } : {}),
    };
    return exec;
  }

  const repeat: GarminRepeatStep = {
    type: "RepeatGroupDTO",
    stepOrder,
    stepType: STEP_TYPE.repeat,
    numberOfIterations: step.count,
    endCondition: END_CONDITION.iterations,
    workoutSteps: step.children.map((c) => encodeStep(c, zones, counter)),
  };
  return repeat;
}

export function translate(plan: WorkoutPlan, zones: ZoneConfig): GarminWorkoutJson {
  const name = plan.name ?? generateName(plan);
  const counter: Counter = { value: 0 };
  const workoutSteps = plan.steps.map((s) => encodeStep(s, zones, counter));
  return {
    workoutName: name,
    sportType: RUNNING_SPORT,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: RUNNING_SPORT,
        workoutSteps,
      },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- translate.test`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/garmin/translate.ts src/garmin/translate.test.ts
git commit -m "Translate WorkoutPlan into Garmin Connect workout JSON"
```

---

## Task 13: Garmin client — `createWorkout()` via page-context fetch

**Files:**
- Create: `src/garmin/pageContextFetch.ts`
- Create: `src/garmin/client.ts`
- Create: `src/garmin/client.test.ts`

- [ ] **Step 1: Implement `pageContextFetch.ts`** — injects a `<script>` so the fetch runs in the page's world (and inherits its cookies, Origin, and any CSRF tokens the SPA exposes on `window`)

```ts
// Runs a fetch in the page's main world by injecting a one-shot <script>.
// Communicates the result back via a MessageChannel.

export type PageFetchRequest = {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
};

export type PageFetchResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export async function pageContextFetch(req: PageFetchRequest): Promise<PageFetchResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const data = event.data as { ok: true; response: PageFetchResponse } | { ok: false; error: string };
      channel.port1.close();
      script.remove();
      if (data.ok) resolve(data.response);
      else reject(new Error(data.error));
    };

    const script = document.createElement("script");
    script.textContent = `
      (async () => {
        const port = (await new Promise(r => {
          window.addEventListener("message", function onMsg(e) {
            if (e.data === "gwg-port") {
              window.removeEventListener("message", onMsg);
              r(e.ports[0]);
            }
          });
        }));
        try {
          const req = ${JSON.stringify(req)};
          const res = await fetch(req.url, {
            method: req.method,
            credentials: "include",
            headers: req.headers,
            body: req.body,
          });
          const body = await res.text();
          port.postMessage({ ok: true, response: { ok: res.ok, status: res.status, body } });
        } catch (e) {
          port.postMessage({ ok: false, error: String(e) });
        }
      })();
    `;
    document.documentElement.appendChild(script);
    window.postMessage("gwg-port", "*", [channel.port2]);
  });
}
```

- [ ] **Step 2: Write failing client tests**

`src/garmin/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkout, _setFetchTransportForTesting } from "./client";
import type { GarminWorkoutJson } from "./types";
import type { PageFetchResponse, PageFetchRequest } from "./pageContextFetch";

const exampleJson: GarminWorkoutJson = {
  workoutName: "Test",
  sportType: { sportTypeId: 1, sportTypeKey: "running" },
  workoutSegments: [{
    segmentOrder: 1,
    sportType: { sportTypeId: 1, sportTypeKey: "running" },
    workoutSteps: [],
  }],
};

describe("createWorkout", () => {
  let transport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = vi.fn();
    _setFetchTransportForTesting(transport as unknown as (r: PageFetchRequest) => Promise<PageFetchResponse>);
  });

  it("returns the workoutId on success", async () => {
    transport.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ workoutId: 12345 }) });
    const result = await createWorkout(exampleJson);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.workoutId).toBe(12345);
  });

  it("includes required headers and JSON body", async () => {
    transport.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ workoutId: 1 }) });
    await createWorkout(exampleJson);
    const req = transport.mock.calls[0][0] as PageFetchRequest;
    expect(req.method).toBe("POST");
    expect(req.headers?.["Content-Type"]).toBe("application/json");
    expect(req.headers?.["NK"]).toBe("NT");
    expect(JSON.parse(req.body ?? "")).toEqual(exampleJson);
  });

  it("returns SESSION_EXPIRED on 401", async () => {
    transport.mockResolvedValueOnce({ ok: false, status: 401, body: "" });
    const result = await createWorkout(exampleJson);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_EXPIRED");
  });

  it("returns SESSION_EXPIRED on 403", async () => {
    transport.mockResolvedValueOnce({ ok: false, status: 403, body: "" });
    const result = await createWorkout(exampleJson);
    if (!result.ok) expect(result.error.code).toBe("SESSION_EXPIRED");
  });

  it("returns BAD_REQUEST with Garmin's message on 400", async () => {
    transport.mockResolvedValueOnce({ ok: false, status: 400, body: JSON.stringify({ message: "Bad shape" }) });
    const result = await createWorkout(exampleJson);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_REQUEST");
      expect(result.error.message).toMatch(/Bad shape/);
    }
  });

  it("retries once on 5xx and succeeds", async () => {
    transport
      .mockResolvedValueOnce({ ok: false, status: 503, body: "" })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ workoutId: 99 }) });
    const result = await createWorkout(exampleJson);
    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("returns UNREACHABLE after two 5xx", async () => {
    transport
      .mockResolvedValueOnce({ ok: false, status: 503, body: "" })
      .mockResolvedValueOnce({ ok: false, status: 503, body: "" });
    const result = await createWorkout(exampleJson);
    if (!result.ok) expect(result.error.code).toBe("UNREACHABLE");
  });

  it("returns UNREACHABLE on transport throw", async () => {
    transport.mockRejectedValueOnce(new Error("network down"));
    const result = await createWorkout(exampleJson);
    if (!result.ok) expect(result.error.code).toBe("UNREACHABLE");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- client.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/garmin/client.ts`**

```ts
import type { GarminWorkoutJson } from "./types";
import { pageContextFetch, type PageFetchRequest, type PageFetchResponse } from "./pageContextFetch";
import { ok, err, type Result } from "../shared/result";

// IMPORTANT: Update this URL from the discovery doc (Task 2) before shipping.
// As-of community libraries: "/web-gateway/workout-service/workout".
export const WORKOUT_ENDPOINT = "/web-gateway/workout-service/workout";

export type GarminFailureCode =
  | "SESSION_EXPIRED"
  | "BAD_REQUEST"
  | "UNREACHABLE";

export type GarminFailure = {
  code: GarminFailureCode;
  message: string;
  status?: number;
  body?: string;
};

export type GarminSuccess = { workoutId: number };

// Test seam: allow tests to inject a fake transport.
type Transport = (req: PageFetchRequest) => Promise<PageFetchResponse>;
let transport: Transport = pageContextFetch;

export function _setFetchTransportForTesting(t: Transport): void {
  transport = t;
}

function extractGarminMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* fallthrough */
  }
  return body.slice(0, 200);
}

async function attempt(json: GarminWorkoutJson): Promise<PageFetchResponse | { thrown: unknown }> {
  try {
    return await transport({
      url: WORKOUT_ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "NK": "NT",
      },
      body: JSON.stringify(json),
    });
  } catch (thrown) {
    return { thrown };
  }
}

export async function createWorkout(json: GarminWorkoutJson): Promise<Result<GarminSuccess, GarminFailure>> {
  let last: PageFetchResponse | { thrown: unknown } | undefined;
  for (let i = 0; i < 2; i++) {
    const result = await attempt(json);
    last = result;
    if ("thrown" in result) continue;
    if (result.ok) {
      try {
        const parsed = JSON.parse(result.body) as { workoutId?: number };
        if (typeof parsed.workoutId === "number") {
          return ok({ workoutId: parsed.workoutId });
        }
      } catch {
        /* fallthrough */
      }
      return err({ code: "BAD_REQUEST", message: "Garmin response missing workoutId.", body: result.body });
    }
    if (result.status === 401 || result.status === 403) {
      return err({ code: "SESSION_EXPIRED", message: "Garmin session expired — refresh the page.", status: result.status });
    }
    if (result.status >= 400 && result.status < 500) {
      return err({ code: "BAD_REQUEST", message: extractGarminMessage(result.body), status: result.status, body: result.body });
    }
    // 5xx: fall through and retry
  }
  if (last && "thrown" in last) {
    return err({ code: "UNREACHABLE", message: "Garmin unreachable (network error)." });
  }
  return err({
    code: "UNREACHABLE",
    message: "Garmin returned a server error twice.",
    status: last && "status" in last ? last.status : undefined,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- client.test`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/garmin/pageContextFetch.ts src/garmin/client.ts src/garmin/client.test.ts
git commit -m "Add Garmin createWorkout client with retry and page-context fetch"
```

---

## Task 14: Preview HTML renderer

**Files:**
- Create: `src/content-script/preview.ts`
- Create: `src/content-script/preview.test.ts`

- [ ] **Step 1: Write failing tests**

`src/content-script/preview.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- preview.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/content-script/preview.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- preview.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content-script/preview.ts src/content-script/preview.test.ts
git commit -m "Render WorkoutPlan to escaped preview HTML"
```

---

## Task 15: Panel DOM + CSS

**Files:**
- Create: `src/content-script/panel.ts`
- Create: `src/content-script/panel.css`

- [ ] **Step 1: Define the panel callbacks contract**

`src/content-script/panel.ts`:

```ts
import type { WorkoutPlan, ParseError } from "../parser/types";
import { renderPreview } from "./preview";

export type PanelCallbacks = {
  onGenerate: (text: string) => Promise<void>;
  onSave: () => Promise<void>;
  onOpenOptions: () => void;
};

export type PanelState =
  | { mode: "needs-config" }
  | { mode: "idle"; text: string }
  | { mode: "loading"; text: string }
  | { mode: "ready"; text: string; plan: WorkoutPlan; errors: ParseError[] }
  | { mode: "saving"; text: string; plan: WorkoutPlan }
  | { mode: "error"; text: string; message: string };

export type PanelHandle = {
  root: HTMLElement;
  setState: (state: PanelState) => void;
};

function el<T extends keyof HTMLElementTagNameMap>(
  tag: T, className?: string, text?: string,
): HTMLElementTagNameMap[T] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function buildPanel(callbacks: PanelCallbacks): PanelHandle {
  const root = el("section", "gwg-root");
  root.setAttribute("data-gwg-mounted", "true");

  const title = el("h2", "gwg-title", "✨ Generate from description");
  root.appendChild(title);

  const textarea = el("textarea", "gwg-textarea");
  textarea.placeholder = "e.g. 15' easy w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d";
  textarea.rows = 3;
  root.appendChild(textarea);

  const actions = el("div", "gwg-actions");
  const clearBtn = el("button", "gwg-btn gwg-btn-secondary", "Clear");
  const generateBtn = el("button", "gwg-btn gwg-btn-primary", "Generate →");
  actions.append(clearBtn, generateBtn);
  root.appendChild(actions);

  const messageBox = el("div", "gwg-message");
  root.appendChild(messageBox);

  const previewBox = el("div", "gwg-preview-container");
  root.appendChild(previewBox);

  const saveActions = el("div", "gwg-save-actions");
  const editBtn = el("button", "gwg-btn gwg-btn-secondary", "Edit text");
  const saveBtn = el("button", "gwg-btn gwg-btn-primary", "Save to Garmin");
  saveActions.append(editBtn, saveBtn);
  root.appendChild(saveActions);

  // Event wiring
  clearBtn.addEventListener("click", () => { textarea.value = ""; textarea.focus(); });
  generateBtn.addEventListener("click", () => { void callbacks.onGenerate(textarea.value); });
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void callbacks.onGenerate(textarea.value);
    }
  });
  editBtn.addEventListener("click", () => { textarea.focus(); });
  saveBtn.addEventListener("click", () => { void callbacks.onSave(); });

  function renderErrors(errors: ParseError[]): string {
    if (errors.length === 0) return "";
    const items = errors.map((e) => {
      const suggestion = e.suggestion ? ` <em>(did you mean "${e.suggestion}"?)</em>` : "";
      return `<li class="gwg-err gwg-err-${e.severity}">${e.message}${suggestion}</li>`;
    }).join("");
    return `<ul class="gwg-errors">${items}</ul>`;
  }

  function setState(state: PanelState): void {
    // Default visibility
    textarea.disabled = false;
    generateBtn.disabled = false;
    clearBtn.disabled = false;
    saveActions.style.display = "none";
    previewBox.innerHTML = "";
    messageBox.innerHTML = "";

    switch (state.mode) {
      case "needs-config": {
        textarea.disabled = true;
        generateBtn.disabled = true;
        messageBox.innerHTML = `<p class="gwg-needs-config">Configure pace zones first — <button class="gwg-link" id="gwg-open-options">open options</button>.</p>`;
        messageBox.querySelector<HTMLButtonElement>("#gwg-open-options")?.addEventListener("click", callbacks.onOpenOptions);
        return;
      }
      case "idle":
        if (textarea.value !== state.text) textarea.value = state.text;
        return;
      case "loading":
        if (textarea.value !== state.text) textarea.value = state.text;
        generateBtn.disabled = true;
        messageBox.innerHTML = `<p class="gwg-loading">Parsing…</p>`;
        return;
      case "ready":
        if (textarea.value !== state.text) textarea.value = state.text;
        previewBox.innerHTML = renderPreview(state.plan) + renderErrors(state.errors);
        const blocking = state.errors.some((e) => e.severity === "error");
        saveActions.style.display = "";
        saveBtn.disabled = blocking;
        saveBtn.title = blocking ? "Resolve errors first." : "";
        return;
      case "saving":
        if (textarea.value !== state.text) textarea.value = state.text;
        previewBox.innerHTML = renderPreview(state.plan);
        saveActions.style.display = "";
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        return;
      case "error":
        if (textarea.value !== state.text) textarea.value = state.text;
        messageBox.innerHTML = `<p class="gwg-error">${state.message}</p>`;
        return;
    }
  }

  setState({ mode: "idle", text: "" });
  return { root, setState };
}
```

- [ ] **Step 2: Write `panel.css`**

`src/content-script/panel.css`:

```css
.gwg-root {
  border: 1px solid #cfd8dc;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;
  background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #263238;
}
.gwg-title { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.gwg-textarea {
  width: 100%; box-sizing: border-box; padding: 8px;
  border: 1px solid #cfd8dc; border-radius: 4px;
  font-family: inherit; font-size: 14px;
}
.gwg-actions, .gwg-save-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.gwg-btn {
  padding: 6px 14px; border-radius: 4px; font-size: 14px; cursor: pointer;
  border: 1px solid #cfd8dc; background: #f5f7f8;
}
.gwg-btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.gwg-btn-primary:disabled { background: #b0bec5; border-color: #b0bec5; cursor: not-allowed; }
.gwg-btn-secondary:hover { background: #eceff1; }
.gwg-preview { margin-top: 12px; padding: 12px; background: #f5f7f8; border-radius: 4px; }
.gwg-preview-header { font-weight: 600; margin-bottom: 6px; }
.gwg-step-list, .gwg-repeat { list-style: none; padding-left: 0; margin: 0; }
.gwg-step, .gwg-repeat-header { padding: 2px 0; }
.gwg-num { display: inline-block; min-width: 24px; color: #607d8b; }
.gwg-repeat { margin-left: 16px; }
.gwg-notes { color: #607d8b; }
.gwg-errors { margin-top: 8px; padding-left: 16px; }
.gwg-err-error { color: #c62828; }
.gwg-err-warning { color: #ef6c00; }
.gwg-message { margin-top: 8px; }
.gwg-error { color: #c62828; }
.gwg-loading { color: #607d8b; font-style: italic; }
.gwg-needs-config { color: #607d8b; }
.gwg-link { background: none; border: none; padding: 0; color: #1976d2; cursor: pointer; text-decoration: underline; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/content-script/panel.ts src/content-script/panel.css
git commit -m "Build inline panel DOM with state machine and styles"
```

---

## Task 16: Mount/unmount strategy

**Files:**
- Create: `src/content-script/mount.ts`

- [ ] **Step 1: Implement mount logic**

`src/content-script/mount.ts`:

```ts
import { buildPanel, type PanelCallbacks, type PanelHandle } from "./panel";

// Selectors for where to attach our panel.
// IMPORTANT: Verify and adjust at implementation time by inspecting Garmin's DOM.
// Pick a stable container that exists on /modern/workout/create/* and edit pages.
const GARMIN_ANCHOR_SELECTOR = "main .workout-edit-form, main [data-test-name='workout-edit']";

const MOUNTED_FLAG = "data-gwg-mounted";

export type MountOptions = {
  callbacks: PanelCallbacks;
  onMount?: (handle: PanelHandle) => void;
  onUnmount?: () => void;
};

let activeHandle: PanelHandle | undefined;
let observer: MutationObserver | undefined;

function tryMount(opts: MountOptions): void {
  if (activeHandle) return;
  const anchor = document.querySelector(GARMIN_ANCHOR_SELECTOR);
  if (!anchor) return;
  if (anchor.querySelector(`[${MOUNTED_FLAG}]`)) return;
  const handle = buildPanel(opts.callbacks);
  anchor.insertBefore(handle.root, anchor.firstChild);
  activeHandle = handle;
  opts.onMount?.(handle);
}

function tryUnmount(opts: MountOptions): void {
  if (!activeHandle) return;
  if (document.body.contains(activeHandle.root)) return;
  activeHandle = undefined;
  opts.onUnmount?.();
}

export function startMounting(opts: MountOptions): () => void {
  tryMount(opts);
  observer = new MutationObserver(() => {
    tryUnmount(opts);
    tryMount(opts);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    observer = undefined;
    if (activeHandle && document.body.contains(activeHandle.root)) {
      activeHandle.root.remove();
    }
    activeHandle = undefined;
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/content-script/mount.ts
git commit -m "Add MutationObserver-based panel mount strategy"
```

---

## Task 17: Content script entrypoint — wire it all together

**Files:**
- Modify: `src/content-script/index.ts`

- [ ] **Step 1: Replace the stub with the wired entrypoint**

`src/content-script/index.ts`:

```ts
import "./panel.css";
import { startMounting } from "./mount";
import type { PanelHandle, PanelState } from "./panel";
import { parse } from "../parser/parse";
import { translate } from "../garmin/translate";
import { createWorkout } from "../garmin/client";
import { getZoneConfig } from "../storage/storage";
import type { WorkoutPlan, ParseError } from "../parser/types";

type AppState =
  | { mode: "needs-config" }
  | { mode: "idle"; text: string }
  | { mode: "loading"; text: string }
  | { mode: "ready"; text: string; plan: WorkoutPlan; errors: ParseError[] }
  | { mode: "saving"; text: string; plan: WorkoutPlan }
  | { mode: "error"; text: string; message: string };

let state: AppState = { mode: "idle", text: "" };
let handle: PanelHandle | undefined;

function render() {
  if (!handle) return;
  handle.setState(state as PanelState);
}

async function bootstrap() {
  const zones = await getZoneConfig();
  if (zones.zones.length === 0) {
    state = { mode: "needs-config" };
    render();
    return;
  }
}

async function onGenerate(text: string): Promise<void> {
  if (text.trim() === "") return;
  state = { mode: "loading", text };
  render();
  const zones = await getZoneConfig();
  const result = await parse(text, zones);
  if (!result.ok) {
    state = { mode: "error", text, message: friendlyParseError(result.error.code, result.error.message) };
    render();
    return;
  }
  state = { mode: "ready", text, plan: result.value.plan, errors: result.value.errors };
  render();
}

async function onSave(): Promise<void> {
  if (state.mode !== "ready") return;
  const { text, plan } = state;
  state = { mode: "saving", text, plan };
  render();
  const zones = await getZoneConfig();
  const garminJson = translate(plan, zones);
  const result = await createWorkout(garminJson);
  if (!result.ok) {
    state = { mode: "error", text, message: friendlyGarminError(result.error.code, result.error.message) };
    render();
    return;
  }
  window.location.assign(`/modern/workout/${result.value.workoutId}/edit`);
}

function onOpenOptions(): void {
  chrome.runtime.sendMessage({ type: "open-options" });
  // Fallback if the background isn't wired: direct link.
  // chrome.runtime.openOptionsPage is only available in background; from content scripts we ask.
}

function friendlyParseError(code: string, message: string): string {
  switch (code) {
    case "NOT_AVAILABLE":
      return "On-device AI isn't ready. Open chrome://on-device-internals to check Gemini Nano status.";
    case "MALFORMED":
      return "The model returned an unexpected format. Try rephrasing the description.";
    case "PROMPT_FAILED":
      return `The model failed to respond (${message}). Try again.`;
    default:
      return message;
  }
}

function friendlyGarminError(code: string, message: string): string {
  switch (code) {
    case "SESSION_EXPIRED": return "Garmin session expired — refresh the page and try again.";
    case "BAD_REQUEST":     return `Garmin rejected the workout: ${message}`;
    case "UNREACHABLE":     return "Garmin is unreachable. Check your connection and try again.";
    default:                return message;
  }
}

startMounting({
  callbacks: {
    onGenerate,
    onSave,
    onOpenOptions,
  },
  onMount: (h) => {
    handle = h;
    render();
    void bootstrap();
  },
  onUnmount: () => {
    handle = undefined;
  },
});
```

- [ ] **Step 2: Add a tiny background service worker to handle "open-options"**

Create `src/background/index.ts`:

```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
```

Modify `manifest.config.ts` — add to the manifest object:

```ts
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `dist/` populated.

- [ ] **Step 4: Commit**

```bash
git add src/content-script/index.ts src/background/index.ts manifest.config.ts
git commit -m "Wire content script and background worker for end-to-end flow"
```

---

## Task 18: Options page — pace zone editor

**Files:**
- Modify: `src/options/options.html`
- Modify: `src/options/options.ts`
- Create: `src/options/options.css`

- [ ] **Step 1: Update HTML**

`src/options/options.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Garmin Workout Generator — Pace Zones</title>
    <link rel="stylesheet" href="./options.css" />
  </head>
  <body>
    <main>
      <h1>Pace zones</h1>
      <p>Used by the parser to resolve names like "aerobic threshold" to actual paces. Pace is m:ss per km.</p>
      <table id="zones">
        <thead>
          <tr><th>Name</th><th>Min (faster)</th><th>Max (slower)</th><th></th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="actions">
        <button id="add">+ Add zone</button>
        <button id="save" class="primary">Save</button>
      </div>
      <p id="status" aria-live="polite"></p>
    </main>
    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement options.ts**

`src/options/options.ts`:

```ts
import { getZoneConfig, setZoneConfig } from "../storage/storage";
import type { ZoneConfig, PaceZone } from "../storage/types";
import { parsePaceField } from "../storage/paceParser";
import { formatDuration } from "../shared/format";

const tbody = document.querySelector<HTMLTableSectionElement>("#zones tbody")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const addBtn = document.querySelector<HTMLButtonElement>("#add")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;

function row(zone?: PaceZone): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="name" value="${zone ? escapeAttr(zone.name) : ""}" placeholder="e.g. easy" /></td>
    <td><input type="text" class="minPace" value="${zone ? formatDuration(zone.minSecPerKm) : ""}" placeholder="4:30" /></td>
    <td><input type="text" class="maxPace" value="${zone ? formatDuration(zone.maxSecPerKm) : ""}" placeholder="4:45" /></td>
    <td><button class="remove">×</button></td>
  `;
  tr.querySelector<HTMLButtonElement>(".remove")?.addEventListener("click", () => tr.remove());
  return tr;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readForm(): { config: ZoneConfig | null; errors: string[] } {
  const errors: string[] = [];
  const zones: PaceZone[] = [];
  for (const tr of Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr"))) {
    const name = tr.querySelector<HTMLInputElement>(".name")!.value.trim();
    const minStr = tr.querySelector<HTMLInputElement>(".minPace")!.value;
    const maxStr = tr.querySelector<HTMLInputElement>(".maxPace")!.value;
    if (!name && !minStr && !maxStr) continue;
    if (!name) { errors.push("Each row needs a zone name."); continue; }
    const min = parsePaceField(minStr);
    const max = parsePaceField(maxStr);
    if (!min.ok) { errors.push(`${name}: min pace ${min.error}`); continue; }
    if (!max.ok) { errors.push(`${name}: max pace ${max.error}`); continue; }
    if (min.value > max.value) { errors.push(`${name}: min pace must be faster than max pace.`); continue; }
    zones.push({ name, minSecPerKm: min.value, maxSecPerKm: max.value });
  }
  if (errors.length) return { config: null, errors };
  return { config: { zones, unit: "min/km" }, errors: [] };
}

async function load(): Promise<void> {
  const config = await getZoneConfig();
  tbody.innerHTML = "";
  for (const z of config.zones) tbody.appendChild(row(z));
}

addBtn.addEventListener("click", () => tbody.appendChild(row()));

saveBtn.addEventListener("click", async () => {
  const { config, errors } = readForm();
  if (!config) {
    status.textContent = errors.join("  ·  ");
    status.style.color = "#c62828";
    return;
  }
  await setZoneConfig(config);
  status.textContent = `Saved ${config.zones.length} zone${config.zones.length === 1 ? "" : "s"}.`;
  status.style.color = "#2e7d32";
});

void load();
```

- [ ] **Step 3: Add options.css**

`src/options/options.css`:

```css
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #263238; max-width: 720px; }
h1 { margin-top: 0; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceff1; }
th { font-weight: 600; color: #607d8b; }
input[type=text] { width: 100%; padding: 4px 6px; box-sizing: border-box; }
button { padding: 6px 12px; border: 1px solid #cfd8dc; border-radius: 4px; background: #f5f7f8; cursor: pointer; }
button.primary { background: #1976d2; color: #fff; border-color: #1976d2; }
button.remove { background: none; border: none; color: #c62828; font-size: 18px; cursor: pointer; }
.actions { margin-top: 16px; display: flex; gap: 8px; }
#status { margin-top: 8px; font-size: 14px; }
```

- [ ] **Step 4: Build to confirm asset paths**

Run: `npm run build`
Expected: PASS; `dist/src/options/options.html` produced and references `options.ts` + `options.css` correctly.

- [ ] **Step 5: Commit**

```bash
git add src/options/
git commit -m "Implement pace zone editor in options page"
```

---

## Task 19: Load and smoke-test the unpacked extension

**Files:** none (manual verification step)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: `dist/` contains `manifest.json`, content script, background, options bundle.

- [ ] **Step 2: Load unpacked in Chrome**

Open `chrome://extensions`. Enable Developer mode. Click "Load unpacked" and select the `dist/` directory. Confirm:
- The extension appears with name "Garmin Workout Generator".
- No errors in the extension's "Errors" panel.
- The options page opens and shows the seed pace zones.

- [ ] **Step 3: Verify the Prompt API is available**

Open `chrome://on-device-internals` (Chrome 138+). Confirm Gemini Nano is downloaded or downloading. If not available, the extension will surface the `NOT_AVAILABLE` error and a link.

- [ ] **Step 4: Smoke-test mount**

Navigate to `https://connect.garmin.com/modern/workout/create/running`. Confirm:
- The "✨ Generate from description" panel appears above Garmin's workout builder.
- If the anchor selector doesn't match, fix `GARMIN_ANCHOR_SELECTOR` in `src/content-script/mount.ts` based on what you see in the page DOM, and rebuild.

- [ ] **Step 5: Smoke-test parse**

In the panel, type: `12', 8', 3', 8', 12' at aerobic threshold pace w 2' jogging rests throughout`

Click Generate. Confirm:
- Preview shows 9 alternating steps.
- The auto-name is "12-8-3-8-12 @ aerobic threshold" (or similar).
- No validation errors (assuming "aerobic threshold" is in your configured zones).

- [ ] **Step 6: Smoke-test save**

Click "Save to Garmin". Confirm:
- The tab navigates to `/modern/workout/<id>/edit`.
- Garmin's UI shows the imported workout with the right steps and targets.

- [ ] **Step 7: Capture any selector or shape adjustments needed**

If anything broke at steps 4–6, log the fix in `docs/superpowers/discoveries/garmin-api-shape.md` and adjust the relevant module. Re-run the smoke tests.

- [ ] **Step 8: Commit smoke-test fixes if any**

```bash
git add -A
git commit -m "Adjust selectors/shape from live smoke test"
```

---

## Self-review notes

Run through this after finishing all tasks:

- **Spec coverage**: every section of the spec is covered — architecture (Tasks 1, 17), parser pipeline (6–10), Garmin translation (11–13), storage (4–5), UI placement and zero-state (14–17), options (18), errors table (10, 13, 17), testing (3, 4, 5, 8–10, 12–14).
- **Out-of-scope items honored**: no plan editing UI, no calendar, no other sports, no Firefox.
- **Type consistency**: `WorkoutPlan`, `Step`, `IntervalStep`, `RepeatBlock`, `Target`, `Duration`, `ParseError`, `PaceZone`, `ZoneConfig`, `GarminWorkoutJson` are all used identically across modules.
- **No placeholders**: every code step includes the full code; no "TBD" or "fill in error handling". Garmin endpoint URL is provided with explicit instruction to verify against discovery in Task 2.
- **Frequent commits**: every task ends with a commit.
- **TDD**: parser, validation, name generator, translation, client, preview — all written test-first.
