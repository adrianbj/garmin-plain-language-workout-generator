import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Garmin Workout Generator",
  version: "1.0.0",
  description: "Turn plain-language descriptions into structured Garmin running workouts using Google's free Gemini API (bring your own key).",
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  action: {
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
    },
    default_title: "Garmin Workout Generator",
  },
  permissions: ["storage", "scripting"],
  host_permissions: [
    "https://connect.garmin.com/*",
    "https://generativelanguage.googleapis.com/*",
  ],
  options_page: "src/options/options.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: [
        "https://connect.garmin.com/app/workout/*",
        "https://connect.garmin.com/modern/workout/*",
      ],
      js: ["src/content-script/index.ts"],
      run_at: "document_idle",
    },
  ],
});
