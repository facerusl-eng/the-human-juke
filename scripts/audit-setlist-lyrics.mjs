import fs from "node:fs";

const dataPath =
  "C:/Users/haral.LAPTOP-NKM07EF3/AppData/Roaming/Code/User/workspaceStorage/2204e2bb53cac79bdf8151269b256d97/GitHub.copilot-chat/chat-session-resources/4a770dbd-579b-4889-aa9b-0d1d3b349ddc/call_dVsre368rKAqbqasQamnd975__vscode-1780042272029/content.json";

const wrapper = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const text = String(wrapper.result || "");
const startTag = "<untrusted-data-57d27f30-7cdf-4575-ac27-19f01349fcff>";
const endTag = "</untrusted-data-57d27f30-7cdf-4575-ac27-19f01349fcff>";

const firstStart = text.indexOf(startTag);
const secondStart = text.indexOf(startTag, firstStart + startTag.length);
const end = text.indexOf(endTag, secondStart + startTag.length);

if (secondStart < 0 || end < 0) {
  throw new Error("Unable to extract setlist songs payload from tool output file.");
}

const payload = text.slice(secondStart + startTag.length, end).trim();
const songs = JSON.parse(payload);

async function fetchWithTimeout(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSong(song) {
  const title = song.title || "";
  const artist = song.artist || "";
  const url = `https://www.the-human-jukebox.org/api/lyrics-genius?song=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;

  try {
    const res = await fetchWithTimeout(url, 25000);
    if (!res.ok) {
      let reason = `http_${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) {
          reason += `:${body.message}`;
        }
      } catch {
        // Ignore body parsing errors.
      }
      return { ok: false, reason };
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: "invalid_json" };
    }

    const lyrics = typeof data?.lyrics === "string" ? data.lyrics.trim() : "";
    if (!lyrics) {
      return { ok: false, reason: "empty_lyrics" };
    }

    return {
      ok: true,
      source: data?.source || null,
      lyricsLength: lyrics.length,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
    };
  }
}

const failures = [];
const successes = [];

for (let index = 0; index < songs.length; index += 1) {
  const song = songs[index];
  const result = await checkSong(song);

  if (result.ok) {
    successes.push({
      songId: song.song_id,
      title: song.title,
      artist: song.artist,
      setlists: song.setlists || [],
      source: result.source,
      lyricsLength: result.lyricsLength,
    });
  } else {
    failures.push({
      songId: song.song_id,
      title: song.title,
      artist: song.artist,
      setlists: song.setlists || [],
      reason: result.reason,
    });
  }

  if ((index + 1) % 20 === 0 || index === songs.length - 1) {
    console.log(`Checked ${index + 1}/${songs.length}, failures: ${failures.length}`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  checked: songs.length,
  failures: failures.length,
  successes: successes.length,
};

fs.writeFileSync(
  "lyrics-audit-not-found.json",
  JSON.stringify({ summary, failures, successes }, null, 2),
  "utf8"
);

const markdownLines = [
  "# Lyrics Audit Report",
  "",
  `Generated: ${summary.generatedAt}`,
  `Checked songs: ${summary.checked}`,
  `Missing/unresolved lyrics: ${summary.failures}`,
  `Resolved lyrics: ${summary.successes}`,
  "",
  "## Songs With Missing Lyrics",
  "",
];

if (failures.length === 0) {
  markdownLines.push("None", "");
} else {
  for (const item of failures) {
    const setlists = Array.isArray(item.setlists) ? item.setlists.join(", ") : "";
    markdownLines.push(
      `- ${item.title} - ${item.artist} | reason: ${item.reason} | setlists: ${setlists}`
    );
  }
  markdownLines.push("");
}

fs.writeFileSync("lyrics-audit-not-found.md", markdownLines.join("\n"), "utf8");

console.log("Audit complete.");
console.log(JSON.stringify(summary, null, 2));