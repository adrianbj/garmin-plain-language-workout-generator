// Self-contained — runs in the page's MAIN world via chrome.scripting.executeScript.
// Cannot reference any module-level identifiers; everything must be in `args`.
async function pageFetchInMainWorld(req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(req.url, {
      method: req.method,
      credentials: "include",
      headers: req.headers,
      body: req.body,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "page-fetch") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "No tab context for fetch." });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: pageFetchInMainWorld,
        args: [msg.request],
      })
      .then((results) => {
        const result = results[0]?.result;
        if (result) sendResponse({ ok: true, response: result });
        else sendResponse({ ok: false, error: "executeScript returned no result." });
      })
      .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
