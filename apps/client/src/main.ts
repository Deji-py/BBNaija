import type { HealthResponse } from "@bbn/shared";
import { SERVER_HTTP_URL } from "./config.js";

const statusEl = document.querySelector<HTMLSpanElement>("#server-status")!;

async function checkServer(): Promise<void> {
  try {
    const res = await fetch(`${SERVER_HTTP_URL}/health`);
    const health = (await res.json()) as HealthResponse;
    statusEl.textContent = `online (up ${health.uptimeSec}s)`;
    statusEl.className = "ok";
  } catch {
    statusEl.textContent = `offline — is the server running on ${SERVER_HTTP_URL}?`;
    statusEl.className = "error";
  }
}

void checkServer();
