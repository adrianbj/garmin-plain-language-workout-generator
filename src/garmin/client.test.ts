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
    // Inject the CSRF meta tag our client reads from the page.
    document.head.innerHTML = '<meta name="csrf-token" content="test-csrf-token-123">';
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
    const call = transport.mock.calls[0];
    expect(call).toBeDefined();
    const req = call?.[0] as PageFetchRequest;
    expect(req.method).toBe("POST");
    expect(req.headers?.["Content-Type"]).toBe("application/json; charset=UTF-8");
    expect(req.headers?.["connect-csrf-token"]).toBe("test-csrf-token-123");
    expect(req.headers?.["x-requested-with"]).toBe("XMLHttpRequest");
    expect(JSON.parse(req.body ?? "")).toEqual(exampleJson);
  });

  it("returns NO_CSRF_TOKEN when meta tag is missing", async () => {
    document.head.innerHTML = "";
    const result = await createWorkout(exampleJson);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_CSRF_TOKEN");
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
