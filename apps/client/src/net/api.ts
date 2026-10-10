import type {
  AdminApplication,
  AdminSeason,
  ApplicationInput,
  ApplicationView,
  HousesResponse,
  LoginRequestResponse,
  LoginVerifyResponse,
  MeResponse,
  PublicSeason,
} from "@bbn/shared";
import { SERVER_HTTP_URL } from "../config.js";

const SESSION_KEY = "bbn:session";

/** The signed-in session token (kept in this browser), or null. */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage you'd have to sign in again on each visit; nothing else breaks.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const token = getSessionToken();
  const res = await fetch(`${SERVER_HTTP_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  /** Live houses (with live summaries) and seasons taking applications — the home-page grid. */
  houses: () => request<HousesResponse>("GET", "/api/houses"),

  season: (id: string) => request<{ season: PublicSeason }>("GET", `/api/seasons/${encodeURIComponent(id)}`).then((r) => r.season),

  requestLogin: (email: string) => request<LoginRequestResponse>("POST", "/api/auth/request", { email }),

  async verifyLogin(token: string): Promise<LoginVerifyResponse> {
    const res = await request<LoginVerifyResponse>("POST", "/api/auth/verify", { token });
    setSessionToken(res.sessionToken);
    return res;
  },

  async signOut(): Promise<void> {
    await request("POST", "/api/auth/signout").catch(() => {});
    setSessionToken(null);
  },

  /** Your account, the current season and your application — or null if not signed in. */
  async me(): Promise<MeResponse | null> {
    if (!getSessionToken()) return null;
    try {
      return await request<MeResponse>("GET", "/api/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionToken(null); // expired or signed out elsewhere
        return null;
      }
      throw err;
    }
  },

  apply: (seasonId: string, input: ApplicationInput) =>
    request<{ application: ApplicationView }>("POST", `/api/seasons/${encodeURIComponent(seasonId)}/applications`, input).then(
      (r) => r.application,
    ),

  /** Signed-in user starts a house they host; it opens for applications immediately. */
  createHouse: (name: string, maxHousemates: number) =>
    request<{ season: PublicSeason }>("POST", "/api/seasons", { name, maxHousemates }).then((r) => r.season),
};

/**
 * Who's at the console: the platform admin (secret, every season) or a host
 * (their normal sign-in, only the seasons they host).
 */
export type ConsoleAuth = { kind: "admin"; secret: string } | { kind: "host" };

/** Big Brother console calls. */
export function adminApi(auth: ConsoleAuth) {
  // Hosts are authorised by their session token, which request() always sends.
  const h: Record<string, string> = auth.kind === "admin" ? { "x-admin-secret": auth.secret } : {};
  return {
    seasons: () => request<{ seasons: AdminSeason[]; platformAdmin: boolean }>("GET", "/api/admin/seasons", undefined, h),
    createSeason: (name: string, maxHousemates: number, hostEmail: string) =>
      request("POST", "/api/admin/seasons", { name, maxHousemates, hostEmail }, h),
    setHost: (id: string, email: string) => request("POST", `/api/admin/seasons/${encodeURIComponent(id)}/host`, { email }, h),
    setSeasonStatus: (id: string, status: string) =>
      request("POST", `/api/admin/seasons/${encodeURIComponent(id)}/status`, { status }, h),
    applications: (seasonId: string) =>
      request<{ applications: AdminApplication[] }>("GET", `/api/admin/seasons/${encodeURIComponent(seasonId)}/applications`, undefined, h).then(
        (r) => r.applications,
      ),
    decide: (applicationId: string, decision: "selected" | "rejected" | "pending") =>
      request("POST", `/api/admin/applications/${encodeURIComponent(applicationId)}/decision`, { decision }, h),
    stats: (seasonId: string) =>
      request<{ watchingNow: number; watchMinutes: number; signedInViewers: number; votes: number; voteWeight: number }>(
        "GET",
        `/api/admin/seasons/${encodeURIComponent(seasonId)}/stats`,
        undefined,
        h,
      ),
  };
}

export interface PaymentPack {
  id: string;
  votes: number;
  label: string;
  priceLabel: string;
}

export const paymentsApi = {
  config: () => request<{ enabled: boolean; packs: PaymentPack[] }>("GET", "/api/payments"),
  checkout: (packId: string, seasonId: string) =>
    request<{ url: string }>("POST", "/api/payments/checkout", { packId, seasonId }).then((r) => r.url),
  verify: (reference: string) => request<{ message: string }>("POST", "/api/payments/verify", { reference }).then((r) => r.message),
};
