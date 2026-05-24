# Privacy Policy — Garmin Plain-Language Workout Generator

**Last updated:** 2026-05-24

This Chrome extension ("the extension") helps you create Garmin Connect running workouts from plain-language descriptions. This page explains what data the extension handles and where it goes.

## Data the extension stores

The extension stores the following in Chrome's `chrome.storage.sync` (which Google syncs across the Chromes you're signed into):

1. **Pace zone configuration** — the names and pace ranges you configure in the options page (e.g., "easy = 5:15–5:45 /km"). This is used to translate zone names in your workout descriptions.
2. **Gemini API key (optional)** — if you paste a Google AI Studio API key into the options page, it is stored locally to be used for cloud-based parsing. The key never leaves your devices except as part of a request to Google's Gemini API (see below).

Neither value is transmitted to the extension's authors. We do not operate any server.

## Data the extension transmits

The extension makes network requests to two domains, only when you interact with it on Garmin Connect:

1. **`connect.garmin.com`** — when you click "Save to Garmin", the extension POSTs your structured workout to Garmin Connect's web API using your existing logged-in session. This is the same endpoint Garmin's own web app uses. We do not see this traffic.
2. **`generativelanguage.googleapis.com` (only if you provided a Gemini API key)** — the text of your workout description plus your configured pace zone names is sent to Google's Gemini API to parse it into structure. Google handles this under [Google's API terms](https://ai.google.dev/gemini-api/terms). If you have not set an API key, parsing happens on-device via Chrome's built-in AI and no data leaves your computer for the parsing step.

We do not transmit data anywhere else. We do not have analytics, telemetry, or error reporting.

## Data the extension reads from the page

When the extension's panel is mounted on a Garmin Connect workout page, it reads the page's CSRF token from a `<meta>` tag in order to authenticate the workout-creation POST. It does not read other Garmin Connect content (your workouts, your activity history, your account details).

## Sale or sharing of data

We do not sell, share, or transfer any user data to third parties. The extension's source code is open at https://github.com/adrianbj/garmin-plain-language-workout-generator and can be audited.

## Contact

Open an issue at https://github.com/adrianbj/garmin-plain-language-workout-generator/issues for questions about this policy.
