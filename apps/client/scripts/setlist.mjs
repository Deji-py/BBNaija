// Writes public/music/setlist.json from the audio files in public/music, for the party DJ.
// Usage: drop royalty-free tracks (mp3, m4a, ogg, wav) in apps/client/public/music, then `pnpm music`.
// Only add tracks whose licence allows public, commercial use (e.g. the Pixabay Content License).
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";

const dir = fileURLToPath(new URL("../public/music/", import.meta.url));
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|wav)$/i;
const MIN_SECONDS = 24; // shorter tracks can't hold the DJ's blends in and out

const tracks = [];
for (const file of (await readdir(dir)).filter((f) => AUDIO.test(f)).sort()) {
  const { format, common } = await parseFile(dir + file, { duration: true });
  const duration = Math.round((format.duration ?? 0) * 100) / 100;
  if (duration < MIN_SECONDS) {
    console.warn(`skipped ${file}: ${duration}s is too short`);
    continue;
  }
  const title = common.title || file.replace(AUDIO, "").replace(/[-_]+/g, " ").trim();
  tracks.push({ file, title, ...(common.artist ? { artist: common.artist } : {}), duration });
  console.log(`${file}  ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, "0")}  ${title}`);
}
await writeFile(dir + "setlist.json", `${JSON.stringify({ tracks }, null, 2)}\n`);
console.log(`\n${tracks.length} track(s) → public/music/setlist.json`);
