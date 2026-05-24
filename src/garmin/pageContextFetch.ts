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

type BackgroundReply =
  | { ok: true; response: PageFetchResponse }
  | { ok: false; error: string };

// Routes the fetch through the background service worker, which uses
// chrome.scripting.executeScript to run it in the page's MAIN world.
// This bypasses the page's CSP (since the API isn't an inline script)
// and uses the page's own Origin (since the function runs same-origin).
export async function pageContextFetch(req: PageFetchRequest): Promise<PageFetchResponse> {
  const reply = (await chrome.runtime.sendMessage({
    type: "page-fetch",
    request: {
      url: req.url,
      method: req.method,
      headers: req.headers ?? {},
      body: req.body ?? "",
    },
  })) as BackgroundReply | undefined;

  if (!reply) throw new Error("Background did not respond.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.response;
}
