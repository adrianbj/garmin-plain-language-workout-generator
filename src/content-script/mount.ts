import { buildPanel, type PanelCallbacks, type PanelHandle } from "./panel";

// Selectors for where to attach our panel.
// IMPORTANT: Verify and adjust at implementation time by inspecting Garmin's DOM during smoke test (T19).
// Pick a stable container that exists on /modern/workout/create/* and edit pages.
const GARMIN_ANCHOR_SELECTOR = "main .workout-edit-form, main [data-test-name='workout-edit']";

const MOUNTED_FLAG = "data-gwg-mounted";

export type MountOptions = {
  callbacks: PanelCallbacks;
  onMount?: (handle: PanelHandle) => void;
  onUnmount?: () => void;
};

let activeHandle: PanelHandle | undefined;
let observer: MutationObserver | undefined;

function tryMount(opts: MountOptions): void {
  if (activeHandle) return;
  const anchor = document.querySelector(GARMIN_ANCHOR_SELECTOR);
  if (!anchor) return;
  if (anchor.querySelector(`[${MOUNTED_FLAG}]`)) return;
  const handle = buildPanel(opts.callbacks);
  anchor.insertBefore(handle.root, anchor.firstChild);
  activeHandle = handle;
  opts.onMount?.(handle);
}

function tryUnmount(opts: MountOptions): void {
  if (!activeHandle) return;
  if (document.body.contains(activeHandle.root)) return;
  activeHandle = undefined;
  opts.onUnmount?.();
}

export function startMounting(opts: MountOptions): () => void {
  tryMount(opts);
  observer = new MutationObserver(() => {
    tryUnmount(opts);
    tryMount(opts);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    observer = undefined;
    if (activeHandle && document.body.contains(activeHandle.root)) {
      activeHandle.root.remove();
    }
    activeHandle = undefined;
  };
}
