import { FILE_STATION, TRACK_MAX_BYTES, TRACK_MAX_LABEL } from "@bbn/shared";
import { SERVER_HTTP_URL } from "../config.js";
import { getSessionToken } from "./api.js";

/** URL every client uses to play the house's uploaded song. Empty unless that station is on. */
export function trackPlaybackUrl(seasonId: string, station: string, token: string): string {
  if (station !== FILE_STATION || !token) return "";
  return `${SERVER_HTTP_URL}/api/radio/${encodeURIComponent(seasonId)}?t=${encodeURIComponent(token)}`;
}

/** Upload a song for this house. Replaces whatever was on the sound bar. */
export async function uploadTrack(seasonId: string, file: File): Promise<string> {
  if (file.size <= 0) throw new Error("That file is empty.");
  if (file.size > TRACK_MAX_BYTES) throw new Error(`Songs must be ${TRACK_MAX_LABEL} or smaller.`);
  const type = trackContentType(file);
  if (!type) throw new Error("Use an MP3, M4A, OGG or WAV file.");
  const session = getSessionToken();
  if (!session) throw new Error("Sign in to put a song on the sound bar.");
  const res = await fetch(`${SERVER_HTTP_URL}/api/radio/${encodeURIComponent(seasonId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session}`, "Content-Type": type },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !body.token) throw new Error(body.message || "Couldn't upload that song.");
  return body.token;
}

function trackContentType(file: File): string {
  const name = file.name.toLowerCase();
  if (file.type === "audio/mpeg" || file.type === "audio/mp3" || name.endsWith(".mp3")) return "audio/mpeg";
  if (file.type === "audio/mp4" || file.type === "audio/m4a" || file.type === "audio/x-m4a" || name.endsWith(".m4a")) return "audio/mp4";
  if (file.type === "audio/ogg" || name.endsWith(".ogg") || name.endsWith(".oga")) return "audio/ogg";
  if (file.type === "audio/wav" || file.type === "audio/x-wav" || file.type === "audio/wave" || name.endsWith(".wav")) return "audio/wav";
  return "";
}
