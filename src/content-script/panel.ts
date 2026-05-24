import type { WorkoutPlan, ParseError } from "../parser/types";
import { renderPreview } from "./preview";

export type PanelCallbacks = {
  onGenerate: (text: string) => Promise<void>;
  onSave: () => Promise<void>;
  onOpenOptions: () => void;
};

export type PanelState =
  | { mode: "needs-config" }
  | { mode: "idle"; text: string }
  | { mode: "loading"; text: string }
  | { mode: "ready"; text: string; plan: WorkoutPlan; errors: ParseError[] }
  | { mode: "saving"; text: string; plan: WorkoutPlan }
  | { mode: "error"; text: string; message: string };

export type PanelHandle = {
  root: HTMLElement;
  setState: (state: PanelState) => void;
};

function el<T extends keyof HTMLElementTagNameMap>(
  tag: T, className?: string, text?: string,
): HTMLElementTagNameMap[T] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function buildPanel(callbacks: PanelCallbacks): PanelHandle {
  const root = el("section", "gwg-root");
  root.setAttribute("data-gwg-mounted", "true");

  const title = el("h2", "gwg-title", "✨ Generate from description");
  root.appendChild(title);

  const textarea = el("textarea", "gwg-textarea");
  textarea.placeholder = "e.g. 15' easy w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d";
  textarea.rows = 3;
  root.appendChild(textarea);

  const actions = el("div", "gwg-actions");
  const clearBtn = el("button", "gwg-btn gwg-btn-secondary", "Clear");
  const generateBtn = el("button", "gwg-btn gwg-btn-primary", "Generate →");
  actions.append(clearBtn, generateBtn);
  root.appendChild(actions);

  const messageBox = el("div", "gwg-message");
  root.appendChild(messageBox);

  const previewBox = el("div", "gwg-preview-container");
  root.appendChild(previewBox);

  const saveActions = el("div", "gwg-save-actions");
  const editBtn = el("button", "gwg-btn gwg-btn-secondary", "Edit text");
  const saveBtn = el("button", "gwg-btn gwg-btn-primary", "Save to Garmin");
  saveActions.append(editBtn, saveBtn);
  root.appendChild(saveActions);

  clearBtn.addEventListener("click", () => { textarea.value = ""; textarea.focus(); });
  generateBtn.addEventListener("click", () => { void callbacks.onGenerate(textarea.value); });
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void callbacks.onGenerate(textarea.value);
    }
  });
  editBtn.addEventListener("click", () => { textarea.focus(); });
  saveBtn.addEventListener("click", () => { void callbacks.onSave(); });

  function renderErrors(errors: ParseError[]): string {
    if (errors.length === 0) return "";
    const items = errors.map((e) => {
      const suggestion = e.suggestion ? ` <em>(did you mean "${e.suggestion}"?)</em>` : "";
      return `<li class="gwg-err gwg-err-${e.severity}">${e.message}${suggestion}</li>`;
    }).join("");
    return `<ul class="gwg-errors">${items}</ul>`;
  }

  function setState(state: PanelState): void {
    textarea.disabled = false;
    generateBtn.disabled = false;
    clearBtn.disabled = false;
    saveActions.style.display = "none";
    previewBox.innerHTML = "";
    messageBox.innerHTML = "";

    switch (state.mode) {
      case "needs-config": {
        textarea.disabled = true;
        generateBtn.disabled = true;
        messageBox.innerHTML = `<p class="gwg-needs-config">Configure pace zones first — <button class="gwg-link" id="gwg-open-options">open options</button>.</p>`;
        messageBox.querySelector<HTMLButtonElement>("#gwg-open-options")?.addEventListener("click", callbacks.onOpenOptions);
        return;
      }
      case "idle":
        if (textarea.value !== state.text) textarea.value = state.text;
        return;
      case "loading":
        if (textarea.value !== state.text) textarea.value = state.text;
        generateBtn.disabled = true;
        messageBox.innerHTML = `<p class="gwg-loading">Parsing…</p>`;
        return;
      case "ready": {
        if (textarea.value !== state.text) textarea.value = state.text;
        previewBox.innerHTML = renderPreview(state.plan) + renderErrors(state.errors);
        const blocking = state.errors.some((e) => e.severity === "error");
        saveActions.style.display = "";
        saveBtn.disabled = blocking;
        saveBtn.title = blocking ? "Resolve errors first." : "";
        return;
      }
      case "saving":
        if (textarea.value !== state.text) textarea.value = state.text;
        previewBox.innerHTML = renderPreview(state.plan);
        saveActions.style.display = "";
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        return;
      case "error":
        if (textarea.value !== state.text) textarea.value = state.text;
        messageBox.innerHTML = `<p class="gwg-error">${state.message}</p>`;
        return;
    }
  }

  setState({ mode: "idle", text: "" });
  return { root, setState };
}
