import type { GarminWorkoutJson } from "./types";
import { pageContextFetch, type PageFetchRequest, type PageFetchResponse } from "./pageContextFetch";
import { ok, err, type Result } from "../shared/result";

// Endpoint per discovery doc (Task 2). Verify in live capture before Task 19 smoke test.
export const WORKOUT_ENDPOINT = "/gc-api/workout-service/workout";

export type GarminFailureCode =
  | "SESSION_EXPIRED"
  | "BAD_REQUEST"
  | "UNREACHABLE"
  | "NO_CSRF_TOKEN";

export type GarminFailure = {
  code: GarminFailureCode;
  message: string;
  status?: number;
  body?: string;
};

export type GarminSuccess = { workoutId: number };

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

function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return meta?.content?.trim() || null;
}

async function attempt(json: GarminWorkoutJson, csrfToken: string): Promise<PageFetchResponse | { thrown: unknown }> {
  try {
    return await transport({
      url: WORKOUT_ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "connect-csrf-token": csrfToken,
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify(json),
    });
  } catch (thrown) {
    return { thrown };
  }
}

export async function createWorkout(json: GarminWorkoutJson): Promise<Result<GarminSuccess, GarminFailure>> {
  const csrfToken = readCsrfToken();
  if (!csrfToken) {
    return err({
      code: "NO_CSRF_TOKEN",
      message: "Couldn't find Garmin's CSRF token — refresh the page and try again.",
    });
  }
  let last: PageFetchResponse | { thrown: unknown } | undefined;
  for (let i = 0; i < 2; i++) {
    const result = await attempt(json, csrfToken);
    last = result;
    if ("thrown" in result) break;
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
  }
  if (last && "thrown" in last) {
    return err({ code: "UNREACHABLE", message: "Garmin unreachable (network error)." });
  }
  return err({
    code: "UNREACHABLE",
    message: "Garmin returned a server error twice.",
    ...(last && "status" in last ? { status: last.status } : {}),
  });
}
