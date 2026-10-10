import type { Application, Request, Response } from "express";
import { housemateAccess } from "../accounts/seasons.js";
import { bearer, userFromSession } from "../accounts/auth.js";
import { MovieError, saveMovie, sendMovie } from "../movies/store.js";

/** Movie upload and playback. Colyseus's JSON routes can't carry a video body. */
export function mountMovieRoutes(app: Application): void {
  app.post("/api/tv/:seasonId", (req, res) => {
    void handleUpload(req, res);
  });
  app.get("/api/tv/:seasonId", (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    void sendMovie(param(req, "seasonId"), token, req, res);
  });
}

async function handleUpload(req: Request, res: Response): Promise<void> {
  try {
    const seasonId = param(req, "seasonId");
    const header = req.headers.authorization;
    const user = await userFromSession(bearer(Array.isArray(header) ? (header[0] ?? null) : (header ?? null)));
    if (!user) throw new MovieError(401, "Please sign in.");
    const access = await housemateAccess(user.id, seasonId);
    if (!access) throw new MovieError(403, "Only a housemate in this house can put a movie on the TV.");
    const token = await saveMovie(seasonId, String(req.headers["content-type"] ?? ""), req);
    res.status(200).json({ token });
  } catch (err) {
    if (res.headersSent) return;
    const status = err instanceof MovieError ? err.status : 500;
    const message = err instanceof MovieError ? err.message : "Couldn't save that movie.";
    res.status(status).json({ message });
  }
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}
