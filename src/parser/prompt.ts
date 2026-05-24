import type { ZoneConfig } from "../storage/types";

export function buildSystemPrompt(zoneConfig: ZoneConfig): string {
  const zoneList = zoneConfig.zones.map((z) => z.name).join(", ");
  return `You convert running workout descriptions into structured JSON.

Available pace zones: ${zoneList}

Output a JSON object matching this shape:
- sport is always "running"
- steps is a flat list; each step is either an "interval" or a "repeat"
- intervals have: kind:"interval", intent (warmup|work|rest|recovery|cooldown), duration, target (optional), notes (optional)
- repeats have: kind:"repeat", count, children (array of steps)
- duration units: "time" (seconds), "distance" (meters), or "open" (lap-button to advance)
- target kinds: "pace_zone" (zoneName from the list above), "pace_range", "hr_range", "rpe" (1–10). Omit target if none.

Rules:
- One interval per discrete segment of running.
- "w/u" / "warmup" / "warm up" → intent:"warmup". If no duration given, default 900 seconds (15 min).
- "c/d" / "cooldown" → intent:"cooldown". If no duration given, default 600 seconds (10 min).
- Recoveries described as a faster "float" → intent:"recovery". Otherwise rests → intent:"rest".
- "5x" / "N times" / "N reps" → use a "repeat" with count:N when the inner pattern is uniform across all reps.
  Inside a repeat ("5x 1k w/ 2' rest"): the rest is part of the repeat unit; children is [work, rest] for every rep including the last.
- If the inner pattern varies between reps (a ladder like 400-800-1200), emit a flat sequence instead of a repeat.
- For a varied flat sequence with interleaved rests ("12', 8', 3' w/ 2' rests throughout"), emit rests BETWEEN work intervals but NOT after the final work interval, unless the user explicitly says "with rest after the last one".
- "@ <zone name>" → target:{kind:"pace_zone", zoneName:"<matched name>"}. Match case-insensitively to the available zones. If no match, omit target and put the literal in notes.
- Unrecognized phrasing → put the segment in notes with no target. Never invent paces or zones.

Examples:

Input: "12', 8', 3', 8', 12' at aerobic threshold pace w 2' jogging rests throughout"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":720},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":480},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":180},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":480},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}},
    {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120},"notes":"jog"},
    {"kind":"interval","intent":"work","duration":{"unit":"time","seconds":720},"target":{"kind":"pace_zone","zoneName":"aerobic threshold"}}
  ]
}

Input: "15' easy w/u, 5x 1k @ 5k pace w/ 2' rest, 10' c/d"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"warmup","duration":{"unit":"time","seconds":900},"target":{"kind":"pace_zone","zoneName":"easy"}},
    {"kind":"repeat","count":5,"children":[
      {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":1000},"target":{"kind":"pace_zone","zoneName":"5k"}},
      {"kind":"interval","intent":"rest","duration":{"unit":"time","seconds":120}}
    ]},
    {"kind":"interval","intent":"cooldown","duration":{"unit":"time","seconds":600},"target":{"kind":"pace_zone","zoneName":"easy"}}
  ]
}

Input: "400-800-1200-800-400 @ mile pace w/ equal time recovery"
Output:
{
  "sport":"running",
  "steps":[
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":400},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":80}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":800},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":160}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":1200},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":240}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":800},"notes":"@ mile pace"},
    {"kind":"interval","intent":"recovery","duration":{"unit":"time","seconds":160}},
    {"kind":"interval","intent":"work","duration":{"unit":"distance","meters":400},"notes":"@ mile pace"}
  ]
}
`;
}
