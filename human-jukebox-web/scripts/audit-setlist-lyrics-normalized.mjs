import fs from "node:fs";

const inputPath = "lyrics-audit-not-found.json";
if (!fs.existsSync(inputPath)) {
  throw new Error("Missing lyrics-audit-not-found.json. Run scripts/audit-setlist-lyrics.mjs first.");
}

const initialAudit = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const failures = Array.isArray(initialAudit?.failures) ? initialAudit.failures : [];

function normalizeQuotes(value) {
  return String(value || "")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMeta(value) {
  return normalizeQuotes(value)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+-\s+live$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleVariants(title) {
  const raw = normalizeQuotes(title);
  const noMeta = stripMeta(raw);
  const noQuestion = noMeta.replace(/\?$/, "").trim();
  const firstOfSlash = noMeta.split("/")[0].trim();
  const firstOfDash = noMeta.split(" - ")[0].trim();
  const lessPunct = noMeta.replace(/[.,!?:;]/g, " ").replace(/\s+/g, " ").trim();
  const set = new Set([raw, noMeta, noQuestion, firstOfSlash, firstOfDash, lessPunct].filter(Boolean));
  return [...set];
}

function artistVariants(artist) {
  const raw = normalizeQuotes(artist);
  const noMeta = stripMeta(raw);
  const firstAmp = noMeta.split(" & ")[0].trim();
  const firstComma = noMeta.split(",")[0].trim();
  const firstFeat = noMeta.split(/\bfeat\.?\b/i)[0].trim();
  const firstWith = noMeta.split(/\bwith\b/i)[0].trim();
  const firstSlash = noMeta.split("/")[0].trim();
  const set = new Set([raw, noMeta, firstAmp, firstComma, firstFeat, firstWith, firstSlash].filter(Boolean));
  return [...set];
}

async function fetchLyrics(song, artist) {
  const url = `https://www.the-human-jukebox.org/api/lyrics-genius?song=${encodeURIComponent(song)}&artist=${encodeURIComponent(artist)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const data = await res.json();
    const lyrics = typeof data?.lyrics === "string" ? data.lyrics.trim() : "";
    if (!lyrics) {
      return { ok: false, reason: "empty_lyrics" };
    }
    return { ok: true, source: data?.source || null, lyricsLength: lyrics.length };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

const recovered = [];
const stillMissing = [];

for (let index = 0; index < failures.length; index += 1) {
  const failure = failures[index];
  const tVariants = titleVariants(failure.title);
  const aVariants = artistVariants(failure.artist);

  let found = null;
  let attempts = 0;

  for (const t of tVariants) {
    if (found) {
      break;
    }
    for (const a of aVariants) {
      attempts += 1;
      // Skip obvious placeholder pair.
      if (/^song title$/i.test(t) && /^artist name$/i.test(a)) {
        continue;
      }
      const result = await fetchLyrics(t, a);
      if (result.ok) {
        found = { title: t, artist: a, source: result.source, lyricsLength: result.lyricsLength, attempts };
        break;
      }
    }
  }

  if (found) {
    recovered.push({
      songId: failure.songId,
      originalTitle: failure.title,
      originalArtist: failure.artist,
      matchedTitle: found.title,
      matchedArtist: found.artist,
      source: found.source,
      lyricsLength: found.lyricsLength,
      attempts: found.attempts,
      setlists: failure.setlists || [],
    });
  } else {
    stillMissing.push({
      songId: failure.songId,
      title: failure.title,
      artist: failure.artist,
      setlists: failure.setlists || [],
      initialReason: failure.reason || "http_404",
    });
  }

  if ((index + 1) % 10 === 0 || index === failures.length - 1) {
    console.log(`Retried ${index + 1}/${failures.length}, recovered: ${recovered.length}, still missing: ${stillMissing.length}`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  initialFailures: failures.length,
  recoveredByNormalization: recovered.length,
  stillMissing: stillMissing.length,
};

const output = { summary, recovered, stillMissing };
fs.writeFileSync("lyrics-audit-normalized-retry.json", JSON.stringify(output, null, 2), "utf8");

const lines = [
  "# Lyrics Normalized Retry Report",
  "",
  `Generated: ${summary.generatedAt}`,
  `Initial failures: ${summary.initialFailures}`,
  `Recovered by normalization: ${summary.recoveredByNormalization}`,
  `Still missing: ${summary.stillMissing}`,
  "",
  "## Still Missing After Normalization",
  "",
];

if (stillMissing.length === 0) {
  lines.push("None", "");
} else {
  for (const song of stillMissing) {
    lines.push(`- ${song.title} - ${song.artist} | setlists: ${(song.setlists || []).join(", ")}`);
  }
  lines.push("");
}

lines.push("## Recovered By Normalization", "");
if (recovered.length === 0) {
  lines.push("None", "");
} else {
  for (const song of recovered) {
    lines.push(
      `- ${song.originalTitle} - ${song.originalArtist} => ${song.matchedTitle} - ${song.matchedArtist} | source: ${song.source || "unknown"}`
    );
  }
  lines.push("");
}

fs.writeFileSync("lyrics-audit-normalized-retry.md", lines.join("\n"), "utf8");

console.log("Normalized retry audit complete.");
console.log(JSON.stringify(summary, null, 2));