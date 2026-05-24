import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Garmin Workout Generator",
  version: "0.1.0",
  description: "Generate Garmin running workouts from plain-language descriptions, on-device.",
  permissions: ["storage", "scripting"],
  host_permissions: ["https://connect.garmin.com/*"],
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
