import express, { type Application, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDist = fileURLToPath(new URL("../../../client/dist", import.meta.url));
const clientIndex = path.join(clientDist, "index.html");

/** Serve the production Vite build and send browser routes back to the SPA. */
export function mountClientRoutes(app: Application): void {
  app.use(express.static(clientDist, { index: false }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const backendPath =
      req.path === "/api" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/matchmake/") ||
      req.path === "/__healthcheck";
    if (req.method !== "GET" || backendPath || !req.accepts("html")) return next();
    res.sendFile(clientIndex);
  });
}
