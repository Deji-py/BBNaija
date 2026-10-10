import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOVIE_MAX_BYTES, MOVIE_MAX_LABEL } from "@bbn/shared";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/movies");

const SEASON_ID = /^[a-z0-9]{10,40}$/;
const TOKEN = /^[a-f0-9]{32}$/;

const TYPES: Record<string, { ext: "mp4" | "webm"; contentType: string; sniff: (head: Buffer) => boolean }> = {
  "video/mp4": {
    ext: "mp4",
    contentType: "video/mp4",
    sniff: (head) => head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp",
  },
  "video/webm": {
    ext: "webm",
    contentType: "video/webm",
    sniff: (head) => head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3,
  },
};

export class MovieError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface MovieMeta {
  token: string;
  ext: "mp4" | "webm";
}

const uploading = new Set<string>();

export function movieTokenMatches(seasonId: string, token: string): boolean {
  const meta = readMetaSync(seasonId);
  return !!meta && meta.token === token;
}

export function currentMovieToken(seasonId: string): string {
  return readMetaSync(seasonId)?.token ?? "";
}

/** Save one movie for this season, replacing the previous file. Returns its playback token. */
export async function saveMovie(seasonId: string, contentType: string, req: IncomingMessage): Promise<string> {
  if (!SEASON_ID.test(seasonId)) throw new MovieError(404, "Season not found.");
  const kind = TYPES[contentType.split(";")[0]?.trim().toLowerCase() ?? ""];
  if (!kind) throw new MovieError(415, "Use an MP4 or WebM file.");
  const declared = Number(req.headers["content-length"]);
  if (!Number.isFinite(declared) || declared <= 0) throw new MovieError(411, "The movie upload needs a size.");
  if (declared > MOVIE_MAX_BYTES) throw new MovieError(413, `Movies must be ${MOVIE_MAX_LABEL} or smaller.`);
  if (uploading.has(seasonId)) throw new MovieError(409, "Someone is already uploading a movie. Try again in a moment.");

  uploading.add(seasonId);
  const part = join(DIR, `${seasonId}.part`);
  try {
    const head = await writeCapped(req, part);
    if (!kind.sniff(head)) throw new MovieError(415, "That file isn't an MP4 or WebM video.");
    const finalPath = join(DIR, `${seasonId}.${kind.ext}`);
    await rename(part, finalPath);
    const token = randomBytes(16).toString("hex");
    const metaPath = join(DIR, `${seasonId}.json`);
    const metaTmp = `${metaPath}.part`;
    await writeFile(metaTmp, JSON.stringify({ token, ext: kind.ext } satisfies MovieMeta));
    await rename(metaTmp, metaPath);
    const other = kind.ext === "mp4" ? "webm" : "mp4";
    await rm(join(DIR, `${seasonId}.${other}`), { force: true });
    return token;
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  } finally {
    uploading.delete(seasonId);
  }
}

/** Stream the season's movie when the token matches. Supports Range so the TV can seek. */
export async function sendMovie(seasonId: string, token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const meta = SEASON_ID.test(seasonId) && TOKEN.test(token) ? await readMeta(seasonId) : null;
  if (!meta || meta.token !== token) {
    res.writeHead(404);
    res.end();
    return;
  }
  const kind = TYPES[`video/${meta.ext}`];
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
      if (size > MOVIE_MAX_BYTES) {
        req.destroy();
        throw new MovieError(413, `Movies must be ${MOVIE_MAX_LABEL} or smaller.`);
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
    throw new MovieError(400, "That file is empty.");
  }
  return Buffer.concat(head);
}

function parseMeta(raw: string): MovieMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MovieMeta>;
    if ((parsed.ext !== "mp4" && parsed.ext !== "webm") || typeof parsed.token !== "string" || !TOKEN.test(parsed.token)) return null;
    return { token: parsed.token, ext: parsed.ext };
  } catch {
    return null;
  }
}

function readMetaSync(seasonId: string): MovieMeta | null {
  if (!SEASON_ID.test(seasonId)) return null;
  try {
    return parseMeta(readFileSync(join(DIR, `${seasonId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function readMeta(seasonId: string): Promise<MovieMeta | null> {
  if (!SEASON_ID.test(seasonId)) return null;
  try {
    return parseMeta(await readFile(join(DIR, `${seasonId}.json`), "utf8"));
  } catch {
    return null;
  }
}
