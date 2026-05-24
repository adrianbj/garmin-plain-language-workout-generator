# Garmin Workout Generator

Chrome extension that adds a panel to Garmin Connect's workout builder where you type running workouts in plain language and have them created in Garmin with one click.

![Panel mounted on Garmin Connect's workout builder](./screenshots/panel-empty.png)

## Example

Type:

> `15' easy w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d`

Click Generate. Review the parsed steps. Click Save to Garmin. The workout shows up in your Garmin Connect account, ready to sync to your watch.

## Install

The extension is not yet on the Chrome Web Store. To install the current build:

1. Download the latest `garmin-workout-generator-*.zip` from the [Releases](https://github.com/adrianbj/garmin-workout-generator/releases) page.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Drag the zip file onto the page.
5. Confirm any permission prompts.

## Setup

Open the extension's Options page (via `chrome://extensions` → Garmin Workout Generator → Details → Extension options).

### 1. Gemini API key (strongly recommended)

The extension parses your descriptions using Google's Gemini 2.5 Flash. Without a key it falls back to Chrome's on-device Gemini Nano, which is significantly less reliable on real workouts.

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**.
3. Copy the value (starts with `AIza…`).
4. Paste it into the Options page and click Save.

Google's free tier covers about 1,500 parses per day — plenty for personal use.

### 2. Pace zones

Configure your own zone names (e.g., `aerobic threshold`, `5k`, `easy`) with their pace ranges in m:ss per km. The parser uses these to resolve named zones in your workout descriptions to actual Garmin pace targets.

## Usage

1. Navigate to https://connect.garmin.com/app/workout/create/running.
2. The "Generate from description" panel appears above Garmin's workout builder.
3. Type a description. Examples:
   - `30 min easy`
   - `15' w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d`
   - `12', 8', 3', 8', 12' @ aerobic threshold w/ 2' jog between`
   - `4x20" strides + 3 sets of 3', 3', 2', 2' w/ 45" jogs and 2' between sets`
4. Click **Generate**. The preview lists the parsed steps.
5. Click **Save to Garmin**. The workout is created in your account.

The extension auto-adds an open-ended warmup and cooldown to every workout if you don't specify them.

## Privacy

See [PRIVACY.md](./PRIVACY.md). Briefly:

- The extension only talks to `connect.garmin.com` (to save workouts using your existing logged-in session) and `generativelanguage.googleapis.com` (to parse descriptions via your own API key).
- No analytics, no telemetry, no third-party servers.
- Source code is the source of truth.

## Limitations

- **Running only.** Cycling, swimming, and strength are not supported.
- **Uses Garmin Connect's internal web API** (`/gc-api/workout-service/workout`), which is not an officially supported integration. Garmin could change the endpoint or shape at any time and break the extension.
- **Chrome only.** The on-device fallback uses Chrome's built-in AI; Firefox/Safari have no equivalent. A Gemini API key sidesteps the on-device dependency, but the build is still Chrome-specific.

## Development

```bash
npm install
npm test            # 63 unit tests
npm run typecheck   # strict TypeScript
npm run build       # produces dist/ for Load unpacked
npm run pack        # builds + produces signed .crx and .zip artifacts
```

Architecture overview:

- `src/parser/` — converts plain-language text to a structured `WorkoutPlan` using Gemini (API or on-device Nano), then validates against a Zod schema.
- `src/garmin/` — translates `WorkoutPlan` to Garmin's wire JSON shape and POSTs to Garmin Connect.
- `src/content-script/` — the inline panel UI on Garmin Connect.
- `src/options/` — the options page (pace zones + API key).
- `src/background/` — service worker that relays the Garmin fetch into the page's main world via `chrome.scripting.executeScript` (necessary to bypass page CSP and share the user's session origin).
- `src/storage/` — chrome.storage.sync wrappers.

## License

MIT. See [LICENSE](./LICENSE).
