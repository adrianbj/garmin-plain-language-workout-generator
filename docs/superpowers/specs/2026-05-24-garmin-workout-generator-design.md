# Garmin Workout Generator — Design

**Date:** 2026-05-24
**Status:** Draft for review

## Goal

Build a Chrome extension that turns plain-language workout descriptions like

> 12', 8', 3', 8', 12' at aerobic threshold pace w 2' jogging rests throughout

into structured running workouts created directly in Garmin Connect, with a preview step so the user catches parsing mistakes before they hit Garmin.

## Form factor

A Chrome MV3 extension that injects a panel into Garmin Connect's workout builder page (`connect.garmin.com/modern/workout/create/running*` and the edit variant). The panel takes a text description, parses it on-device with Chrome's built-in Prompt API (Gemini Nano), shows a preview, and POSTs the workout to Garmin Connect's web API using the user's existing logged-in session.

No external network, no API keys, no OAuth.

## Scope

**In scope for v1**
- Sport: running only.
- Step types: time intervals, distance intervals, warmups, cooldowns, repeats, ladders, progressions.
- Intensity targets: user-defined pace zones (e.g., "aerobic threshold"), explicit pace ranges, HR ranges, RPE.
- UI inline on Garmin Connect's workout builder page.
- Pace-zone configuration via an options page; stored in `chrome.storage.sync`.

**Out of scope for v1**
- Editing the parsed plan in the UI (user re-runs Generate with edited text).
- Bulk imports / training-week pasting.
- Calendar / schedule integration.
- Sports other than running.
- Firefox / Safari (no Prompt API).

## Architecture

A Chrome MV3 extension with four modules, each isolated behind a clear interface:

```
┌─────────────────────────────────────────────────────────────┐
│ Chrome extension (MV3)                                      │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Content      │   │ Parser       │   │ Garmin       │    │
│  │ script /     │←─▶│ module       │   │ client       │    │
│  │ inline UI    │   │ (LLM-backed) │   │ module       │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
│         ▲                  ▲                  ▲             │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Storage: pace zones, user prefs (chrome.storage)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐                                           │
│  │ Options page │ (configure pace zones, defaults)          │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
   │ Runs at: connect.garmin.com/modern/workout/create/running*
   │          connect.garmin.com/modern/workout/*/edit
   ▼
 Garmin Connect web app (DOM + session cookies)
```

### Modules and their boundaries

- **`content-script/`** — DOM-level concern only: mounts the panel above Garmin's workout builder, wires up text input, handles "Generate" / "Save to Garmin" button clicks. Owns no parsing or API logic.
- **`parser/`** — Pure function `parse(text, zones) → Result<WorkoutPlan, ParseError[]>`. Calls Chrome's `LanguageModel` with our JSON schema. No DOM, no fetch. Testable in isolation with mocked `LanguageModel`.
- **`garmin/`** — Two functions: `translate(plan): GarminWorkoutJson` (pure) and `createWorkout(json): Promise<{ workoutId: number }>` (one fetch). Knows nothing about the LLM or DOM. Testable with mocked fetch.
- **`storage/`** — Thin wrapper around `chrome.storage.sync` for pace zones and preferences. Validates shape on read.
- **`options/`** — Standalone HTML page for editing pace zones.

### Build & tooling

- **Language**: TypeScript.
- **Build**: Vite with `@crxjs/vite-plugin`.
- **Tests**: Vitest for unit/integration; Playwright (manual-only initially) for end-to-end against a logged-in Garmin test account.
- **No runtime dependencies.** All AI is on-device via the Prompt API; all storage is `chrome.storage.sync`; the only network call is to Garmin Connect's own endpoint from a tab already on `connect.garmin.com`.

## Parser

### Pipeline

```
user text + pace zones
         │
         ▼
┌──────────────────────────┐
│ LanguageModel.create({   │   one session, reused across calls
│   systemPrompt: …,       │
│   expectedInputs: ['en'] │
│ })                       │
└──────────────────────────┘
         │
         ▼
┌──────────────────────────┐
│ session.prompt(          │   responseConstraint enforces JSON shape
│   userText,              │
│   { responseConstraint   │
│     : WorkoutPlanSchema} │
│ )                        │
└──────────────────────────┘
         │
         ▼  WorkoutPlan JSON
┌──────────────────────────┐
│ validate(plan, zones)    │   semantic checks the schema can't enforce
└──────────────────────────┘
         │
         ▼  WorkoutPlan or ParseError[]
```

### Intermediate `WorkoutPlan` schema

Deliberately *not* Garmin's JSON shape — Garmin's is verbose and proprietary, and we want the LLM to target the cleanest possible structure. A separate `garmin/translate` step converts to Garmin's wire format.

```ts
type WorkoutPlan = {
  name?: string;                 // auto-generated if absent
  sport: "running";              // v1
  steps: Step[];
};

type Step = IntervalStep | RepeatBlock;

type IntervalStep = {
  kind: "interval";
  intent: "warmup" | "work" | "rest" | "recovery" | "cooldown";
  duration: Duration;
  target?: Target;               // omit when no target ("just run easy")
  notes?: string;                // shown in step notes on the watch
};

type RepeatBlock = {
  kind: "repeat";
  count: number;
  children: Step[];              // nested repeats allowed
};

type Duration =
  | { unit: "time"; seconds: number }
  | { unit: "distance"; meters: number }
  | { unit: "open" };            // "until lap button" — for "easy w/u" with no time

type Target =
  | { kind: "pace_zone"; zoneName: string }
  | { kind: "pace_range"; minSecPerKm: number; maxSecPerKm: number }
  | { kind: "hr_range"; minBpm: number; maxBpm: number }
  | { kind: "rpe"; value: number };             // 1–10
```

Ladders and progressions are flat sequences of `IntervalStep`s with varying durations or targets — no special schema needed. The example in the goal becomes nine alternating work/rest intervals (no trailing rest after the final 12').

### Prompt strategy

A `LanguageModel` session is created once (lazily on first Generate) and reused across calls. The system prompt contains:

1. The role ("You convert running workout descriptions into structured JSON").
2. The user's configured pace zone names, injected at session creation: `"Available pace zones: aerobic threshold, easy, marathon, 10k, 5k, mile, recovery"`.
3. Rules:
   - One `IntervalStep` per discrete segment.
   - "w/u" / "warmup" → `intent: warmup`. Default 15min easy if no duration is given.
   - "c/d" / "cooldown" → `intent: cooldown`. Default 10min easy if no duration.
   - Rests/recoveries: `intent: rest` unless described as a faster "float" → `recovery`.
   - "5x" / "N times" / "N reps" → `RepeatBlock` with `count: N` when the inner pattern is uniform. If inner steps vary (ladder), emit a flat sequence.
   - **Rest placement rules** (the two cases are distinct):
     - *Inside a repeat* ("5x 1k w/ 2' rest"): the rest is part of the repeat unit, so `children: [work, rest]` and the rest appears after every rep including the last. This matches Garmin's own convention; the watch's "lap button to advance" lets the user skip the trailing rest naturally.
     - *Interleaving a flat varied sequence* ("12', 8', 3' w/ 2' rests throughout"): emit rests *between* work intervals but NOT after the final work interval, unless the user explicitly says "with rest after the last one".
   - "@ <zone name>" → `pace_zone` target. Match case-insensitively to the available zones; if no match, use `no_target` and put the literal in `notes`.
   - Unrecognized phrasing → `notes` with `no_target`, never invent.
4. Three few-shot examples:
   - The example in the goal (mixed-duration sequence with interleaved rests) → flat sequence, no `RepeatBlock`.
   - `5x 1k @ 5k pace w/ 2' rest, 15' w/u, 10' c/d` → warmup + RepeatBlock(5, [1k work, 2' rest]) + cooldown.
   - `400-800-1200-800-400 @ mile pace w/ equal time recovery` → ladder as flat sequence.

### JSON Schema for `responseConstraint`

Discriminated unions on `kind` and `unit` so the model can't emit a malformed step. The schema is generated from the TypeScript types via `zod-to-json-schema` (or hand-written if simpler at this size).

### Post-LLM semantic validation

`validate(plan, zones)` checks rules the schema can't:

- Every `pace_zone` target's `zoneName` exists in user's configured zones (case-insensitive). On close-but-not-exact matches ("areobic threshold"), suggest the correction.
- Every duration > 0; every repeat count ≥ 1.
- At least one step.
- Total workout duration is sane (< 8 hours).

Failures return `ParseError[]` with `{ severity, message, suggestion? }`. The UI shows them above the preview. `severity: "error"` blocks Save; `"warning"` doesn't.

### Auto-generated workout name

If the LLM omits `name`, we generate one deterministically from the structure: `"5x1k @ 5k"`, `"12-8-3-8-12 @ aerobic threshold"`, `"Easy 45min"`.

## Pace-zone configuration

```ts
type PaceZone = {
  name: string;              // "aerobic threshold"
  minSecPerKm: number;       // 285 (= 4:45/km)
  maxSecPerKm: number;       // 295 (= 4:55/km)
};

type PaceUnit = "min/km" | "min/mi";
type ZoneConfig = { zones: PaceZone[]; unit: PaceUnit };
```

Stored under one key in `chrome.storage.sync`, syncing across the user's Chrome installs.

**Options page**: a single HTML page with a table editor — name + min pace + max pace per row, "Add zone", "Save". Pace input accepts `4:45`-style strings; parsed to seconds and stored as seconds canonically.

**Seed defaults on first install**: five generic zones (recovery, easy, marathon, threshold, 5k) so the extension is usable immediately. The user overwrites with their own paces.

## Garmin JSON translation + API call

### Knowledge to discover at implementation time

The exact current Garmin workout JSON shape and endpoint URL are not in the spec — they must be discovered during implementation. Sources:

1. Existing community libraries: [mkuthan/garmin-workouts](https://github.com/mkuthan/garmin-workouts) (Python), [Pythe1337N/garmin-connect](https://www.npmjs.com/package/garmin-connect) (Node), [ThomasRondof/GarminWorkoutAItoJSON](https://github.com/ThomasRondof/GarminWorkoutAItoJSON) (closest prior art).
2. The [fulippo/share-your-garmin-workout](https://github.com/fulippo/share-your-garmin-workout) extension's source — its import flow consumes the same JSON Garmin's UI produces.
3. DevTools verification: load Garmin Connect, create a trivial workout manually, observe the actual POST in the Network panel. This is the ground truth.

The implementation plan's first task is this discovery; the rest of `garmin/` is built against the discovered shape.

### Anticipated Garmin JSON shape (to be verified)

```jsonc
{
  "workoutName": "12-8-3-8-12 @ aerobic threshold",
  "sportType": { "sportTypeId": 1, "sportTypeKey": "running" },
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": { "sportTypeId": 1, "sportTypeKey": "running" },
    "workoutSteps": [
      {
        "type": "ExecutableStepDTO",
        "stepOrder": 1,
        "stepType":     { "stepTypeId": 3, "stepTypeKey": "interval" },
        "endCondition": { "conditionTypeId": 2, "conditionTypeKey": "time" },
        "endConditionValue": 720,                   // seconds
        "targetType":   { "workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone" },
        "targetValueOne": 3.448,                    // m/s lower
        "targetValueTwo": 3.509                     // m/s upper
      }
      // …rest step…
    ]
  }]
}
```

Repeats become `"type": "RepeatGroupDTO"` wrappers with `"numberOfIterations"` and a nested `workoutSteps` array.

### Translation

Pure function in `garmin/translate.ts`. All Garmin-specific ID tables live in one place:

```ts
const stepTypeIds = {
  warmup: 1, cooldown: 2, work: 3, rest: 4, recovery: 5,
} as const;

const endConditionIds = {
  time: 2, distance: 3, "lap.button": 1,
} as const;
```

- Pace zones translate to `pace.zone` targets in m/s (Garmin's internal unit), bounds derived from user's `minSecPerKm`/`maxSecPerKm`.
- HR ranges translate to `heart.rate.zone` with `targetValueOne`/`Two` as BPM.
- RPE has no native Garmin target; we drop the target but stash the RPE value in the step's `description` field.

### POSTing the workout

From a content script running on `connect.garmin.com`, executed in **page context** (via injecting a `<script>` tag) so cookies and `Origin` headers attach automatically:

```ts
const res = await fetch("/web-gateway/workout-service/workout", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "NK": "NT",                              // Garmin's standard header
    // CSRF token from page state if discovery shows one is needed
  },
  body: JSON.stringify(garminJson),
});
```

On success Garmin returns the created workout with `workoutId`. We navigate the tab to `/modern/workout/<workoutId>/edit` so the user sees the workout populated in Garmin's UI immediately.

### Isolation

`garmin/` exports exactly `translate` and `createWorkout`. Endpoint URL, ID tables, and headers are private to the module. When Garmin redesigns (and they will), one file changes.

## UI placement and flow

The content script injects a single panel at the top of Garmin's workout builder:

```
┌─────────────────────────────────────────────────────────────┐
│ ╔═════════════════════════════════════════════════════════╗ │
│ ║ ✨ Generate from description                            ║ │  ← our panel
│ ║ ┌─────────────────────────────────────────────────────┐ ║ │
│ ║ │ 12', 8', 3', 8', 12' at aerobic threshold pace      │ ║ │
│ ║ │ w 2' jogging rests throughout                       │ ║ │
│ ║ └─────────────────────────────────────────────────────┘ ║ │
│ ║                              [ Clear ]  [ Generate → ]  ║ │
│ ║                                                         ║ │
│ ║ Preview (9 steps · 56:00 total):                        ║ │
│ ║   1. Run 12:00 @ aerobic threshold                      ║ │
│ ║   2. Recover 2:00 (jog)                                 ║ │
│ ║   3. Run 8:00 @ aerobic threshold                       ║ │
│ ║   …                                                     ║ │
│ ║   9. Run 12:00 @ aerobic threshold                      ║ │
│ ║                                                         ║ │
│ ║              [ Edit text ]  [ Save to Garmin ]          ║ │
│ ╚═════════════════════════════════════════════════════════╝ │
│                                                              │
│   ──── Garmin's existing workout builder UI below ────       │
└─────────────────────────────────────────────────────────────┘
```

**Mount strategy.** Garmin's app is a SPA — the workout builder mounts and unmounts as you navigate. A `MutationObserver` watches `document.body` for a stable selector (e.g., the workout-name form container; exact selector determined at implementation time). When seen, we mount the panel; when removed, we unmount. The selector is the one DOM coupling — isolated in `content-script/mount.ts`.

**Two-stage Save.**
1. `garmin.createWorkout(json) → workoutId`.
2. Navigate the tab to `/modern/workout/<workoutId>/edit` so the user sees the workout populated in Garmin's own UI for final verification.

We deliberately *don't* populate Garmin's React state directly — too brittle. The API call is the source of truth; we let Garmin's own reload display the result.

**Visual style.** Garmin Connect's colors and system font stack so it doesn't look bolted on. Single CSS file, class prefix `gwg-` to avoid collisions.

**Zero state.** If pace zones aren't configured, the panel shows "Configure pace zones first →" linking to the options page instead of the input box.

**Keyboard.** `⌘/Ctrl+Enter` in the textarea triggers Generate.

## Errors

| Surface | Failure | User-visible message | Recovery |
|---|---|---|---|
| Prompt API | Unavailable (Chrome < 138, model not downloaded, hardware) | "On-device AI isn't ready. Check `chrome://on-device-internals`." | Link + retry. |
| Prompt API | Model downloading | Progress bar from download monitor | Wait; retry. |
| Prompt API | Quota / token limit | "Description too long — try splitting it." | Inline. |
| Parser validation | Unknown zone | "'aerobic threshhold' isn't a configured zone. Did you mean 'aerobic threshold'?" | Suggestion button. |
| Parser validation | Empty plan | "Couldn't find any workout steps. Try rephrasing." | Inline. |
| Garmin client | 401/403 | "Garmin session expired — refresh the page." | Reload button. |
| Garmin client | 400 with body | Garmin's message verbatim + "Report a bug" link | Inline. |
| Garmin client | 5xx / network | Auto-retry once; then "Garmin unreachable." | Manual retry. |
| Content script | Mount selector missed | (Caught at mount.) Panel never mounts; `console.warn`. | Fix the selector. |

## Testing

- **Parser**: Vitest with a mocked `LanguageModel` returning scripted JSON for ~30 example descriptions (the goal example, 5x1k, ladders, progressions, w/u-c/d, RPE, named zones with typos, gibberish). Tests assert the `WorkoutPlan` shape. The mock isolates us from Gemini Nano's variance.
- **Live LLM smoke test**: separate, not in CI. Real Chrome with the Prompt API, same corpus. Pass criterion: ≥90% of descriptions parse identically to mocked expectations. Catches prompt drift.
- **Garmin translation**: table-driven Vitest tests, `WorkoutPlan → expected Garmin JSON` byte-for-byte against fixtures captured from Garmin's own UI.
- **Garmin client**: mocked `fetch` with recorded Garmin response shapes.
- **End-to-end**: one Playwright test against a logged-in Garmin test account — type description → click Save → assert workout appears in `/modern/workouts`. Manual-only initially (automating Garmin login in CI is fragile and risks the account).

## Open risks and mitigations

1. **Garmin endpoint / JSON shape changes.** All Garmin-specific knowledge in `garmin/`. Two files change. End-to-end Playwright test catches regressions.
2. **Chrome Prompt API behavior changes.** Parser is the only consumer. Schema-constrained output is stable in Chrome 138+; surface area for change is small.
3. **Gemini Nano produces a structurally valid but semantically wrong plan.** Mitigated by the preview UI — user catches before save. Editing the parsed plan is explicit v2 scope.
4. **Garmin redesigns the workout builder page.** Mount selector is one line in `content-script/mount.ts`. Worst case, the panel doesn't appear and we ship a selector fix.
5. **Garmin TOS / unofficial endpoints.** We use endpoints the official web app uses, from a browser session, the same way fulippo's extension and several community libraries do. Not different in kind from what a user does manually. We document this clearly in the extension's README.
