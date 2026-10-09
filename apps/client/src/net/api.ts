import type {
  AdminApplication,
  AdminSeason,
  ApplicationInput,
  ApplicationView,
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
  season: () => request<{ season: PublicSeason | null }>("GET", "/api/season").then((r) => r.season),

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

  apply: (input: ApplicationInput) =>
    request<{ application: ApplicationView }>("POST", "/api/applications", input).then((r) => r.application),
};

/** Big Brother console calls, authorised with the admin secret. */
export function adminApi(secret: string) {
  const h = { "x-admin-secret": secret };
  return {
    seasons: () => request<{ seasons: AdminSeason[] }>("GET", "/api/admin/seasons", undefined, h).then((r) => r.seasons),
    createSeason: (name: string, maxHousemates: number) =>
      request("POST", "/api/admin/seasons", { name, maxHousemates }, h),
    setSeasonStatus: (id: string, status: string) =>
      request("POST", `/api/admin/seasons/${encodeURIComponent(id)}/status`, { status }, h),
    applications: (seasonId: string) =>
      request<{ applications: AdminApplication[] }>("GET", `/api/admin/seasons/${encodeURIComponent(seasonId)}/applications`, undefined, h).then(
        (r) => r.applications,
      ),
    decide: (applicationId: string, decision: "selected" | "rejected" | "pending") =>
      request("POST", `/api/admin/applications/${encodeURIComponent(applicationId)}/decision`, { decision }, h),
  };
}
