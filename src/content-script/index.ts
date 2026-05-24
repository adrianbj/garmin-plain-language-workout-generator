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
  window.location.assign(`/app/workout/${result.value.workoutId}?workoutType=running`);
}

function onOpenOptions(): void {
  chrome.runtime.sendMessage({ type: "open-options" });
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
    case "NO_CSRF_TOKEN":   return "Couldn't find Garmin's CSRF token — refresh the page and try again.";
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
