import { MOVIE_CHANNEL, MOVIE_MAX_BYTES, MOVIE_MAX_LABEL } from "@bbn/shared";
import { SERVER_HTTP_URL } from "../config.js";
import { getSessionToken } from "./api.js";

/** URL every client uses to play the house's uploaded movie. Empty unless that channel is on. */
export function moviePlaybackUrl(seasonId: string, channel: string, token: string): string {
  if (channel !== MOVIE_CHANNEL || !token) return "";
  return `${SERVER_HTTP_URL}/api/tv/${encodeURIComponent(seasonId)}?t=${encodeURIComponent(token)}`;
}

/** Upload a movie for this house. The server rejects anything over the size limit. */
export async function uploadMovie(seasonId: string, file: File): Promise<string> {
  if (file.size <= 0) throw new Error("That file is empty.");
  if (file.size > MOVIE_MAX_BYTES) throw new Error(`Movies must be ${MOVIE_MAX_LABEL} or smaller.`);
  const type = movieContentType(file);
  if (!type) throw new Error("Use an MP4 or WebM file.");
  const session = getSessionToken();
  if (!session) throw new Error("Sign in to put a movie on the TV.");
  const res = await fetch(`${SERVER_HTTP_URL}/api/tv/${encodeURIComponent(seasonId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session}`, "Content-Type": type },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !body.token) throw new Error(body.message || "Couldn't upload that movie.");
  return body.token;
}

function movieContentType(file: File): "video/mp4" | "video/webm" | "" {
  const name = file.name.toLowerCase();
  if (file.type === "video/mp4" || name.endsWith(".mp4")) return "video/mp4";
  if (file.type === "video/webm" || name.endsWith(".webm")) return "video/webm";
  return "";
}
