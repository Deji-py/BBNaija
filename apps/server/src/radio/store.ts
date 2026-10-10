import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACK_MAX_BYTES, TRACK_MAX_LABEL } from "@bbn/shared";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/radio");
const SEASON_ID = /^[a-z0-9]{10,40}$/;
const TOKEN = /^[a-f0-9]{32}$/;

type Ext = "mp3" | "m4a" | "ogg" | "wav";

const TYPES: Record<string, { ext: Ext; contentType: string; sniff: (head: Buffer) => boolean }> = {
  "audio/mpeg": { ext: "mp3", contentType: "audio/mpeg", sniff: sniffMp3 },
  "audio/mp3": { ext: "mp3", contentType: "audio/mpeg", sniff: sniffMp3 },
  "audio/mp4": { ext: "m4a", contentType: "audio/mp4", sniff: sniffFtyp },
  "audio/m4a": { ext: "m4a", contentType: "audio/mp4", sniff: sniffFtyp },
  "audio/x-m4a": { ext: "m4a", contentType: "audio/mp4", sniff: sniffFtyp },
  "audio/ogg": { ext: "ogg", contentType: "audio/ogg", sniff: (h) => h.subarray(0, 4).toString("ascii") === "OggS" },
  "audio/wav": { ext: "wav", contentType: "audio/wav", sniff: sniffWav },
  "audio/x-wav": { ext: "wav", contentType: "audio/wav", sniff: sniffWav },
  "audio/wave": { ext: "wav", contentType: "audio/wav", sniff: sniffWav },
};

function sniffMp3(head: Buffer): boolean {
  return head.subarray(0, 3).toString("ascii") === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
}
function sniffFtyp(head: Buffer): boolean {
  return head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp";
}
function sniffWav(head: Buffer): boolean {
  return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WAVE";
}

export class TrackError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface TrackMeta {
  token: string;
  ext: Ext;
}

const uploading = new Set<string>();

export function trackTokenMatches(seasonId: string, token: string): boolean {
  const meta = readMetaSync(seasonId);
  return !!meta && meta.token === token;
}

export function currentTrackToken(seasonId: string): string {
  return readMetaSync(seasonId)?.token ?? "";
}

/** Save one song for this season, replacing the previous file. */
export async function saveTrack(seasonId: string, contentType: string, req: IncomingMessage): Promise<string> {
  if (!SEASON_ID.test(seasonId)) throw new TrackError(404, "Season not found.");
  const kind = TYPES[contentType.split(";")[0]?.trim().toLowerCase() ?? ""];
  if (!kind) throw new TrackError(415, "Use an MP3, M4A, OGG or WAV file.");
  const declared = Number(req.headers["content-length"]);
  if (!Number.isFinite(declared) || declared <= 0) throw new TrackError(411, "The song upload needs a size.");
  if (declared > TRACK_MAX_BYTES) throw new TrackError(413, `Songs must be ${TRACK_MAX_LABEL} or smaller.`);
  if (uploading.has(seasonId)) throw new TrackError(409, "Someone is already putting a song on. Try again in a moment.");

  uploading.add(seasonId);
  const part = join(DIR, `${seasonId}.part`);
  try {
    const head = await writeCapped(req, part);
    if (!kind.sniff(head)) throw new TrackError(415, "That file isn't a playable audio track.");
    const finalPath = join(DIR, `${seasonId}.${kind.ext}`);
    await rename(part, finalPath);
    const token = randomBytes(16).toString("hex");
    const metaPath = join(DIR, `${seasonId}.json`);
    await writeFile(`${metaPath}.part`, JSON.stringify({ token, ext: kind.ext } satisfies TrackMeta));
    await rename(`${metaPath}.part`, metaPath);
    for (const ext of ["mp3", "m4a", "ogg", "wav"] as const) {
      if (ext !== kind.ext) await rm(join(DIR, `${seasonId}.${ext}`), { force: true });
    }
    return token;
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  } finally {
    uploading.delete(seasonId);
  }
}

export async function sendTrack(seasonId: string, token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const meta = SEASON_ID.test(seasonId) && TOKEN.test(token) ? await readMeta(seasonId) : null;
  if (!meta || meta.token !== token) {
    res.writeHead(404);
    res.end();
    return;
  }
  const kind = Object.values(TYPES).find((t) => t.ext === meta.ext);
  const filePath = join(DIR, `${seasonId}.${meta.ext}`);
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  const common = {
    "Content-Type": kind?.contentType ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { ...common, "Content-Length": size });
    createReadStream(filePath).pipe(res);
    return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  const start = match ? Number(match[1]) : NaN;
  const end = match && match[2] ? Number(match[2]) : size - 1;
  if (!match || start >= size || end >= size || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    ...common,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
  });
  createReadStream(filePath, { start, end }).pipe(res);
}

async function writeCapped(req: IncomingMessage, dest: string): Promise<Buffer> {
  await mkdir(dirname(dest), { recursive: true });
  const out = createWriteStream(dest);
  const head: Buffer[] = [];
  let size = 0;
  let headBytes = 0;
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > TRACK_MAX_BYTES) {
        req.destroy();
        throw new TrackError(413, `Songs must be ${TRACK_MAX_LABEL} or smaller.`);
      }
      if (headBytes < 16) {
        head.push(buf.subarray(0, 16 - headBytes));
        headBytes += buf.length;
      }
      if (!out.write(buf)) await once(out, "drain");
    }
    await new Promise<void>((resolve, reject) => {
      out.once("error", reject);
      out.end(() => resolve());
    });
  } catch (err) {
    out.destroy();
    await rm(dest, { force: true });
    throw err;
  }
  if (size === 0) {
    await rm(dest, { force: true });
    throw new TrackError(400, "That file is empty.");
  }
  return Buffer.concat(head);
}

function parseMeta(raw: string): TrackMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TrackMeta>;
    if (!parsed.ext || !["mp3", "m4a", "ogg", "wav"].includes(parsed.ext)) return null;
    if (typeof parsed.token !== "string" || !TOKEN.test(parsed.token)) return null;
    return { token: parsed.token, ext: parsed.ext };
  } catch {
    return null;
  }
}

function readMetaSync(seasonId: string): TrackMeta | null {
  if (!SEASON_ID.test(seasonId)) return null;
  try {
    return parseMeta(readFileSync(join(DIR, `${seasonId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function readMeta(seasonId: string): Promise<TrackMeta | null> {
  if (!SEASON_ID.test(seasonId)) return null;
  try {
    return parseMeta(await readFile(join(DIR, `${seasonId}.json`), "utf8"));
  } catch {
    return null;
  }
}
