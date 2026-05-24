import { getZoneConfig, setZoneConfig } from "../storage/storage";
import type { ZoneConfig, PaceZone } from "../storage/types";
import { parsePaceField } from "../storage/paceParser";
import { formatDuration } from "../shared/format";

const tbody = document.querySelector<HTMLTableSectionElement>("#zones tbody")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const addBtn = document.querySelector<HTMLButtonElement>("#add")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;

function row(zone?: PaceZone): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="name" value="${zone ? escapeAttr(zone.name) : ""}" placeholder="e.g. easy" /></td>
    <td><input type="text" class="minPace" value="${zone ? formatDuration(zone.minSecPerKm) : ""}" placeholder="4:30" /></td>
    <td><input type="text" class="maxPace" value="${zone ? formatDuration(zone.maxSecPerKm) : ""}" placeholder="4:45" /></td>
    <td><button class="remove">×</button></td>
  `;
  tr.querySelector<HTMLButtonElement>(".remove")?.addEventListener("click", () => tr.remove());
  return tr;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readForm(): { config: ZoneConfig | null; errors: string[] } {
  const errors: string[] = [];
  const zones: PaceZone[] = [];
  for (const tr of Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr"))) {
    const name = tr.querySelector<HTMLInputElement>(".name")!.value.trim();
    const minStr = tr.querySelector<HTMLInputElement>(".minPace")!.value;
    const maxStr = tr.querySelector<HTMLInputElement>(".maxPace")!.value;
    if (!name && !minStr && !maxStr) continue;
    if (!name) { errors.push("Each row needs a zone name."); continue; }
    const min = parsePaceField(minStr);
    const max = parsePaceField(maxStr);
    if (!min.ok) { errors.push(`${name}: min pace ${min.error}`); continue; }
    if (!max.ok) { errors.push(`${name}: max pace ${max.error}`); continue; }
    if (min.value > max.value) { errors.push(`${name}: min pace must be faster than max pace.`); continue; }
    zones.push({ name, minSecPerKm: min.value, maxSecPerKm: max.value });
  }
  if (errors.length) return { config: null, errors };
  return { config: { zones, unit: "min/km" }, errors: [] };
}

async function load(): Promise<void> {
  const config = await getZoneConfig();
  tbody.innerHTML = "";
  for (const z of config.zones) tbody.appendChild(row(z));
}

addBtn.addEventListener("click", () => tbody.appendChild(row()));

saveBtn.addEventListener("click", async () => {
  const { config, errors } = readForm();
  if (!config) {
    status.textContent = errors.join("  ·  ");
    status.style.color = "#c62828";
    return;
  }
  await setZoneConfig(config);
  status.textContent = `Saved ${config.zones.length} zone${config.zones.length === 1 ? "" : "s"}.`;
  status.style.color = "#2e7d32";
});

void load();
