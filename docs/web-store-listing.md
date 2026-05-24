# Chrome Web Store Listing Copy

Paste these strings into the Developer Console submission form.

---

## Item name (max 75 chars)

```
Garmin Workout Generator
```

## Item summary (max 132 chars, shown in search results and store cards)

```
Turn plain-language descriptions into structured Garmin running workouts using Gemini's free API (bring your own key).
```

## Category

Productivity

## Language

English (United States)

---

## Detailed description (max 16,000 chars, supports plain text + basic markdown)

```
Garmin Workout Generator adds a panel to Garmin Connect's workout builder where you can type running workouts in plain language and have them created in Garmin with one click.

Type a description like:

  12', 8', 3', 8', 12' at aerobic threshold pace w 2' jogging rests throughout

Click Generate, review the parsed steps, click Save to Garmin, and the workout appears in your Garmin Connect account ready to push to your watch.

== HOW IT WORKS ==

The extension parses your description using Google's Gemini 2.5 Flash via the official Gemini API. Paste a free Google AI Studio API key into the options page once, and every workout you type is parsed in about a second with reliable handling of shorthand notation (12' = 12 minutes, 20" = 20 seconds), nested repeats, ladders, and named pace zones. Google's free tier covers roughly 1,500 parses per day — far more than personal use requires.

Parsed workouts are validated, previewed in a clean step list, and posted to Garmin Connect via your existing logged-in session.

== GET A GEMINI API KEY (FREE) ==

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account and click "Create API key"
3. Copy the key (starts with AIza...)
4. Paste it into the extension's Options page

There's no charge for the free tier. The key stays on your devices (synced via Chrome only if you're signed into Chrome).

== FEATURES ==

- Plain-language input: time intervals (12', 8'), distance intervals (5x 1k), warmups, cooldowns, ladders, progressions, nested sets
- User-defined pace zones: configure your own zone names ("aerobic threshold", "5k pace", "easy") in the options page, then reference them by name in workout descriptions
- Auto-generated workout names based on the structure
- Optional warmup/cooldown defaults if you don't specify them

== ON-DEVICE FALLBACK (NOT RECOMMENDED) ==

If no API key is configured, the extension falls back to Chrome's built-in on-device model (Gemini Nano). This fallback exists for users who can't use a cloud API but its parsing quality is greatly inferior — it routinely mishandles standard running shorthand and structure on anything more complex than a single interval. Use the Gemini API key path unless you have a specific reason not to.

== REQUIREMENTS ==

- Logged-in Garmin Connect account
- A free Google AI Studio API key from aistudio.google.com/apikey (strongly recommended)
- Chrome 138+ if you want the on-device fallback to be available

== PRIVACY ==

The extension does not transmit your data to any server we operate. It only talks to:
- connect.garmin.com (to save your workout to your Garmin account)
- generativelanguage.googleapis.com (to parse your description via your own Gemini API key)

Source code is open at https://github.com/adrianjones/garmin-workout-generator. See the privacy policy for details.

== LIMITATIONS ==

- Running workouts only (no cycling, swimming, strength)
- Uses Garmin Connect's internal web API, which is not an officially supported integration. Garmin may change the endpoint or shape at any time.
- On-device fallback is greatly inferior to the Gemini API path — use a key.
```

---

## Permission justifications (single-purpose policy)

### `storage` permission

```
Stores user-configured pace zones and an optional Gemini API key in chrome.storage.sync so the extension can resolve named pace zones (e.g., "aerobic threshold") to numeric paces, and so the user does not need to re-enter the API key.
```

### `scripting` permission

```
Required to execute a small fetch in the page's main world via chrome.scripting.executeScript when the user clicks "Save to Garmin". The fetch posts the structured workout JSON to Garmin Connect's workout-service endpoint using the user's existing logged-in session. The page's MAIN-world context is required so the request shares the page's Origin and the user's authentication cookies; this is not possible from the content script's isolated world due to CORS.
```

### Host permission: `https://connect.garmin.com/*`

```
The extension's panel UI is injected into Garmin Connect's workout builder page (connect.garmin.com/app/workout/* and the legacy /modern/workout/*). The Save-to-Garmin action also POSTs to connect.garmin.com/gc-api/workout-service/workout to create the workout in the user's Garmin Connect account.
```

### Host permission: `https://generativelanguage.googleapis.com/*`

```
Only used if the user has provided their own Google AI Studio API key in the options page. The extension POSTs the workout description and the user's configured pace zones to the Gemini API to parse them into a structured workout. If no API key is set, this host is never contacted and parsing happens entirely on-device via Chrome's built-in AI.
```

### Single-purpose description (for the "Single Purpose" submission field)

```
This extension generates structured Garmin running workouts from plain-language descriptions typed by the user, and saves them to the user's Garmin Connect account.
```

---

## Privacy policy URL

Host `PRIVACY.md` somewhere public. Easiest options:

1. **GitHub Pages**: enable Pages on the repo (Settings → Pages → main branch, root). Then the URL is `https://<your-username>.github.io/garmin-workout-generator/PRIVACY.html` after committing a converted .html, or just link to `PRIVACY.md` rendered on github.com.
2. **Gist**: paste the contents at https://gist.github.com and use that URL.
3. **Direct GitHub blob**: `https://github.com/<your-username>/garmin-workout-generator/blob/main/PRIVACY.md` — accepted by Chrome Web Store review.

---

## Screenshots needed

Required: at least 1 screenshot at 1280×800 or 640×400. Recommended: 3–5.

Suggested shots:
1. Panel mounted on Garmin Connect with the example description filled in, preview showing parsed steps (Gemini API result).
2. Options page with the Gemini API key field and pace zones table.
3. A saved workout in Garmin's own UI (proving end-to-end works).
4. Optional: a complex workout with nested sets parsed correctly (showcases the Gemini API path).

Capture at 1280×800 in a Chrome window. Save as PNG.

---

## Promotional images (optional but recommended)

- **Small promo tile**: 440×280 PNG. Used in store search.
- **Marquee promo tile**: 1400×560 PNG. Used in featured placements.

These should match the icon's visual style. Skip on first submission if you don't have them; they can be added later.

---

## Submission checklist

- [ ] Chrome Web Store developer account ($5 one-time, https://chrome.google.com/webstore/devconsole)
- [ ] Identity verified (passport/license + selfie)
- [ ] `npm run pack` produces fresh `garmin-workout-generator-1.0.0.zip`
- [ ] Privacy policy hosted at a public URL
- [ ] Screenshots captured at 1280×800
- [ ] Item name, summary, detailed description ready to paste
- [ ] Permission justifications ready to paste
- [ ] Submit; expect 1–3 day review for new extensions
