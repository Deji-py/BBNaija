import type { IceServer } from "@bbn/shared";

const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
/** Credentials must outlive the longest stay in the house: an expired one can't refresh its relay. */
const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;

export function turnConfigured(): boolean {
  return !!keyId && !!apiToken;
}

/**
 * Short-lived Cloudflare TURN credentials for one mesh client. TURN relays the
 * audio when two browsers can't reach each other directly (mobile carriers,
 * strict home routers). The long-term key stays on the server.
 * Returns undefined when not configured or Cloudflare can't be reached; the
 * client then falls back to STUN only.
 */
export async function turnIceServers(): Promise<IceServer[] | undefined> {
  if (!keyId || !apiToken) return undefined;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
    const { iceServers } = (await res.json()) as { iceServers?: IceServer[] };
    if (!Array.isArray(iceServers) || iceServers.length === 0) throw new Error("Cloudflare TURN sent no servers");
    // Browsers block port 53, and the mesh waits for gathering to finish, so a URL there only costs time.
    return iceServers.map((server) => ({ ...server, urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)) }));
  } catch (err) {
    console.error("[voice] TURN credentials unavailable, falling back to STUN:", err);
    return undefined;
  }
}
