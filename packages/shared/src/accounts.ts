/** Accounts, seasons and applications (M7): shapes of the HTTP API shared by client and server. */

export type SeasonStatus = "draft" | "applications" | "live" | "ended";
export const SEASON_STATUSES: readonly SeasonStatus[] = ["draft", "applications", "live", "ended"];

export type ApplicationStatus = "pending" | "selected" | "rejected";
export type HousemateStatus = "active" | "evicted" | "winner" | "removed";

/** Field limits, enforced by the server and mirrored in the form. */
export const LIMITS = {
  email: 254,
  displayName: 20,
  country: 56,
  bio: 500,
  motivation: 800,
  availability: 300,
  clipUrl: 300,
  seasonName: 60,
} as const;

/** How long a sign-in link works, and how long you stay signed in. */
export const LOGIN_LINK_MINUTES = 15;
export const SESSION_DAYS = 30;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface PublicSeason {
  id: string;
  name: string;
  status: SeasonStatus;
  maxHousemates: number;
  selectedCount: number;
}

export interface ApplicationInput {
  displayName: string;
  country: string;
  bio: string;
  motivation: string;
  clipUrl: string;
  availability: string;
  ageConfirmed: boolean;
  consentBroadcast: boolean;
  consentRecording: boolean;
  consentRules: boolean;
}

export interface ApplicationView extends ApplicationInput {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
}

/** GET /api/me */
export interface MeResponse {
  user: PublicUser;
  season: PublicSeason | null;
  application: ApplicationView | null;
  /** True when you may enter the house right now (selected, season live, not removed). */
  canEnterHouse: boolean;
}

/** POST /api/auth/request */
export interface LoginRequestResponse {
  ok: true;
  /** Development only: the sign-in link, shown on screen because no email is sent locally. */
  devLink?: string;
}

/** POST /api/auth/verify */
export interface LoginVerifyResponse {
  sessionToken: string;
  user: PublicUser;
}

export interface AdminSeason extends PublicSeason {
  applicationCount: number;
  createdAt: string;
}

export interface AdminApplication extends ApplicationView {
  email: string;
  userId: string;
}

/** Simple, permissive email check — the sign-in link proves the address actually works. */
export function isValidEmail(email: string): boolean {
  return email.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Only http(s) links are accepted for intro clips (no javascript: or data: URLs). */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
