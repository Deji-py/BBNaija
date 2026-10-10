import type { Application, Request, Response } from "express";
import { housemateAccess } from "../accounts/seasons.js";
import { bearer, userFromSession } from "../accounts/auth.js";
import { TrackError, saveTrack, sendTrack } from "../radio/store.js";

/** Sound-bar upload and playback. Same idea as the TV movie: one file per house. */
export function mountRadioRoutes(app: Application): void {
  app.post("/api/radio/:seasonId", (req, res) => {
    void handleUpload(req, res);
  });
  app.get("/api/radio/:seasonId", (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    void sendTrack(param(req, "seasonId"), token, req, res);
  });
}

async function handleUpload(req: Request, res: Response): Promise<void> {
  try {
    const seasonId = param(req, "seasonId");
    const header = req.headers.authorization;
    const user = await userFromSession(bearer(Array.isArray(header) ? (header[0] ?? null) : (header ?? null)));
    if (!user) throw new TrackError(401, "Please sign in.");
    const access = await housemateAccess(user.id, seasonId);
    if (!access) throw new TrackError(403, "Only a housemate in this house can put a song on the sound bar.");
    const token = await saveTrack(seasonId, String(req.headers["content-type"] ?? ""), req);
    res.status(200).json({ token });
  } catch (err) {
    if (res.headersSent) return;
    const status = err instanceof TrackError ? err.status : 500;
    const message = err instanceof TrackError ? err.message : "Couldn't save that song.";
    res.status(status).json({ message });
  }
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}
