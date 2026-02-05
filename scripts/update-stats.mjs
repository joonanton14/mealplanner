import fs from "node:fs";
import path from "node:path";

const clubId = process.env.CLUB_ID;
const platform = process.env.PLATFORM;

if (!clubId) throw new Error("Missing CLUB_ID");
if (!platform) throw new Error("Missing PLATFORM");

const url = `https://proclubs.ea.com/api/fc/members/stats?platform=${encodeURIComponent(
  platform
)}&clubId=${encodeURIComponent(clubId)}`;

async function fetchJson(u) {
  const res = await fetch(u, {
    headers: {
      // These headers help some CDNs treat it like a normal browser request
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://proclubs.ea.com/",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    // show a short snippet to debug 403s etc.
    const snippet = text.slice(0, 250);
    throw new Error(`EA request failed ${res.status}: ${snippet}`);
  }

  // Some failures return HTML; guard that
  if (text.trim().startsWith("<")) {
    throw new Error(`EA returned HTML (blocked?): ${text.slice(0, 250)}`);
  }

  return JSON.parse(text);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeRows(members) {
  const rows = members.map((m) => {
    const games = toNum(m.gamesPlayed);
    const goals = toNum(m.goals);
    const assists = toNum(m.assists);
    const ga = goals + assists;

    const gaPerMatchRaw = games > 0 ? ga / games : 0;

    return {
      name: String(m.name ?? ""),
      games,
      goals,
      assists,
      ga,
      gaPerMatch: gaPerMatchRaw, // keep as number, UI formats toFixed(4)
      source: "ea",
    };
  });

  // Sort by G+A per match desc, tie-break by games desc
  rows.sort((a, b) => {
    if (b.gaPerMatch !== a.gaPerMatch) return b.gaPerMatch - a.gaPerMatch;
    return b.games - a.games;
  });

  return rows;
}

const data = await fetchJson(url);
if (!data?.members || !Array.isArray(data.members)) {
  throw new Error("Unexpected EA response: missing members[]");
}

const payload = {
  updatedAt: new Date().toISOString(),
  rows: computeRows(data.members),
};

const outPath = path.join(process.cwd(), "public", "stats.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

console.log(`Wrote ${outPath} with ${payload.rows.length} players`);
