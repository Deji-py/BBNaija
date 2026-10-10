import {
  LIMITS,
  REWARD_IDS,
  SEASON_STATUSES,
  isSafeHttpUrl,
  isValidEmail,
  type RewardId,
  type AdminApplication,
  type AdminSeason,
  type ApplicationInput,
  type ApplicationStatus,
  type ApplicationView,
  type PublicSeason,
  type SeasonStatus,
} from "@bbn/shared";
import { db } from "../db/client.js";
import type { Application, Season, User } from "../generated/prisma/client.js";

export class SeasonError extends Error {
  constructor(
    readonly status: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

type SeasonWithHost = Season & { host?: User | null };

export async function getSeason(seasonId: unknown): Promise<SeasonWithHost | null> {
  if (typeof seasonId !== "string" || !seasonId || seasonId.length > 64) return null;
  return db.season.findUnique({ where: { id: seasonId }, include: { host: true } });
}

/** Seasons in a given status, newest first, with their hosts. */
export function seasonsWithStatus(status: SeasonStatus): Promise<SeasonWithHost[]> {
  return db.season.findMany({ where: { status }, orderBy: { createdAt: "desc" }, include: { host: true } });
}

export async function toPublicSeason(season: SeasonWithHost): Promise<PublicSeason> {
  const selectedCount = await db.housemate.count({ where: { seasonId: season.id, status: { not: "removed" } } });
  const host = season.host === undefined && season.hostUserId ? await db.user.findUnique({ where: { id: season.hostUserId } }) : season.host;
  return {
    id: season.id,
    name: season.name,
    status: season.status as SeasonStatus,
    maxHousemates: season.maxHousemates,
    selectedCount,
    hostName: host ? (host.displayName ?? host.email.split("@")[0]!) : "",
  };
}

export function toApplicationView(a: Application): ApplicationView {
  return {
    id: a.id,
    status: a.status as ApplicationStatus,
    createdAt: a.createdAt.toISOString(),
    displayName: a.displayName,
    country: a.country,
    bio: a.bio,
    motivation: a.motivation,
    clipUrl: a.clipUrl ?? "",
    availability: a.availability,
    ageConfirmed: a.ageConfirmed,
    consentBroadcast: a.consentBroadcast,
    consentRecording: a.consentRecording,
    consentRules: a.consentRules,
  };
}

/** Reward ids stored on a housemate. Anything else in the JSON is ignored. */
export function parsePerks(raw: string | null | undefined): RewardId[] {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((p): p is RewardId => typeof p === "string" && REWARD_IDS.includes(p as RewardId));
  } catch {
    return [];
  }
}

/** Remember the rewards a housemate is currently holding (immunity, nomination power, crown). */
export async function savePerks(userId: string, seasonId: string, perks: readonly string[]): Promise<void> {
  const clean = parsePerks(JSON.stringify(perks));
  await db.housemate.update({ where: { userId_seasonId: { userId, seasonId } }, data: { perks: JSON.stringify(clean) } });
}

/**
 * May this user enter this house as a housemate right now? A selected housemate
 * of a live season, still active — or the winner, until the season ends.
 * Evicted housemates watch instead.
 */
export async function housemateAccess(userId: string, seasonId: string): Promise<{ displayName: string; perks: RewardId[] } | null> {
  const season = await getSeason(seasonId);
  if (!season || season.status !== "live") return null;
  const hm = await db.housemate.findUnique({ where: { userId_seasonId: { userId, seasonId } } });
  if (!hm || (hm.status !== "active" && hm.status !== "winner")) return null;
  const app = await db.application.findUnique({ where: { userId_seasonId: { userId, seasonId } } });
  const user = await db.user.findUnique({ where: { id: userId } });
  return { displayName: app?.displayName ?? user?.displayName ?? "Housemate", perks: parsePerks(hm.perks) };
}

/** Live seasons this user may enter as a housemate. */
export async function enterableSeasons(userId: string): Promise<SeasonWithHost[]> {
  const rows = await db.housemate.findMany({
    where: { userId, status: { in: ["active", "winner"] }, season: { status: "live" } },
    include: { season: { include: { host: true } } },
  });
  return rows.map((r) => r.season);
}

/** Is this user the host of this season? */
export function isHostOf(user: { id: string } | null, season: Season | null): boolean {
  return !!user && !!season && season.hostUserId === user.id;
}

// ------------------------------------------------------------------ applications

/** Validates and cleans an application form. Throws SeasonError with a readable message. */
export function parseApplication(body: unknown): ApplicationInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const text = (key: keyof typeof LIMITS, label: string, required = true): string => {
    const v = typeof b[key] === "string" ? (b[key] as string).replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : "")).trim() : "";
    if (required && !v) throw new SeasonError("BAD_REQUEST", `${label} is required.`);
    if (v.length > LIMITS[key]) throw new SeasonError("BAD_REQUEST", `${label} must be at most ${LIMITS[key]} characters.`);
    return v;
  };
  const yes = (key: string) => b[key] === true;

  const input: ApplicationInput = {
    displayName: text("displayName", "Display name").replace(/\s+/g, " "),
    country: text("country", "Country"),
    bio: text("bio", "Bio"),
    motivation: text("motivation", "Why you should be selected"),
    clipUrl: text("clipUrl", "Intro clip link", false),
    availability: text("availability", "Availability"),
    ageConfirmed: yes("ageConfirmed"),
    consentBroadcast: yes("consentBroadcast"),
    consentRecording: yes("consentRecording"),
    consentRules: yes("consentRules"),
  };
  if (input.clipUrl && !isSafeHttpUrl(input.clipUrl)) throw new SeasonError("BAD_REQUEST", "The intro clip must be an http(s) link.");
  if (!input.ageConfirmed) throw new SeasonError("BAD_REQUEST", "You must be 18 or over to apply.");
  if (!input.consentBroadcast || !input.consentRecording || !input.consentRules) {
    throw new SeasonError("BAD_REQUEST", "Please agree to all three consents to apply.");
  }
  return input;
}

/** Submit (or, while still pending, update) an application to a season that's taking applications. */
export async function submitApplication(userId: string, seasonId: string, input: ApplicationInput): Promise<ApplicationView> {
  const season = await getSeason(seasonId);
  if (!season) throw new SeasonError("NOT_FOUND", "Season not found.");
  if (season.status !== "applications") throw new SeasonError("FORBIDDEN", "This season isn't taking applications.");
  if (season.hostUserId === userId) throw new SeasonError("FORBIDDEN", "You host this season, so you can't apply to it.");

  const existing = await db.application.findUnique({ where: { userId_seasonId: { userId, seasonId } } });
  if (existing && existing.status !== "pending") {
    throw new SeasonError("CONFLICT", "Your application has already been reviewed.");
  }
  const data = { ...input, clipUrl: input.clipUrl || null };
  const app = existing
    ? await db.application.update({ where: { id: existing.id }, data })
    : await db.application.create({ data: { ...data, userId, seasonId } });
  await db.user.update({ where: { id: userId }, data: { displayName: input.displayName } });
  return toApplicationView(app);
}

// ------------------------------------------------------------------ console (admin & hosts)

/** Seasons for the console: all of them for the platform admin, or just the ones a host runs. */
export async function listSeasons(hostUserId?: string): Promise<AdminSeason[]> {
  const seasons = await db.season.findMany({
    where: hostUserId ? { hostUserId } : {},
    orderBy: { createdAt: "desc" },
    include: { host: true, _count: { select: { applications: true } } },
  });
  return Promise.all(
    seasons.map(async (s) => ({
      ...(await toPublicSeason(s)),
      applicationCount: s._count.applications,
      createdAt: s.createdAt.toISOString(),
      hostEmail: s.host?.email ?? "",
    })),
  );
}

export async function createSeason(body: unknown): Promise<Season> {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const max = Number(b.maxHousemates);
  if (!name || name.length > LIMITS.seasonName) throw new SeasonError("BAD_REQUEST", "Give the season a name (max 60 characters).");
  if (!Number.isInteger(max) || max < 2 || max > 8) throw new SeasonError("BAD_REQUEST", "Max housemates must be 2–8.");
  const season = await db.season.create({ data: { name, maxHousemates: max } });
  if (typeof b.hostEmail === "string" && b.hostEmail.trim()) await setSeasonHost(season.id, b.hostEmail);
  return season;
}

/**
 * Assigns (or, with an empty email, removes) a season's host. The host account
 * is created if needed, so they can simply sign in with that email.
 */
export async function setSeasonHost(seasonId: string, rawEmail: unknown): Promise<{ season: Season; email: string }> {
  const season = await getSeason(seasonId);
  if (!season) throw new SeasonError("NOT_FOUND", "Season not found.");
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email) {
    return { season: await db.season.update({ where: { id: seasonId }, data: { hostUserId: null } }), email: "" };
  }
  if (!isValidEmail(email)) throw new SeasonError("BAD_REQUEST", "Enter a valid email for the host.");
  const host = await db.user.upsert({ where: { email }, update: {}, create: { email } });
  if (host.bannedAt) throw new SeasonError("FORBIDDEN", "That account is banned.");
  const applied = await db.application.findUnique({ where: { userId_seasonId: { userId: host.id, seasonId } } });
  if (applied) throw new SeasonError("CONFLICT", "That person applied to this season, so they can't host it.");
  return { season: await db.season.update({ where: { id: seasonId }, data: { hostUserId: host.id } }), email };
}

export async function setSeasonStatus(seasonId: string, status: unknown): Promise<Season> {
  if (!SEASON_STATUSES.includes(status as SeasonStatus)) throw new SeasonError("BAD_REQUEST", "Unknown status.");
  const season = await getSeason(seasonId);
  if (!season) throw new SeasonError("NOT_FOUND", "Season not found.");
  const data: { status: string; startsAt?: Date; endsAt?: Date } = { status: status as string };
  if (status === "live" && !season.startsAt) data.startsAt = new Date();
  if (status === "ended") data.endsAt = new Date();
  return db.season.update({ where: { id: seasonId }, data });
}

export async function listApplications(seasonId: string): Promise<AdminApplication[]> {
  const apps = await db.application.findMany({ where: { seasonId }, orderBy: { createdAt: "asc" }, include: { user: true } });
  return apps.map((a) => ({ ...toApplicationView(a), email: a.user.email, userId: a.userId }));
}

/** The season an application belongs to (for permission checks). */
export async function applicationSeason(applicationId: unknown): Promise<Season | null> {
  if (typeof applicationId !== "string") return null;
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { season: true } });
  return app?.season ?? null;
}

/**
 * Select / reject / reset an applicant. Selecting creates their Housemate
 * record (up to the season's max); anything else removes it.
 */
export async function decideApplication(applicationId: string, decision: unknown): Promise<{ app: Application; name: string }> {
  if (decision !== "selected" && decision !== "rejected" && decision !== "pending") {
    throw new SeasonError("BAD_REQUEST", "Decision must be selected, rejected or pending.");
  }
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { season: true } });
  if (!app) throw new SeasonError("NOT_FOUND", "Application not found.");

  const updated = await db.$transaction(async (tx) => {
    if (decision === "selected" && app.status !== "selected") {
      // Counted inside the transaction so two quick selections can't overfill the season.
      const selected = await tx.housemate.count({ where: { seasonId: app.seasonId, status: { not: "removed" } } });
      if (selected >= app.season.maxHousemates) {
        throw new SeasonError("CONFLICT", `This season already has ${app.season.maxHousemates} housemates.`);
      }
    }
    if (decision === "selected") {
      await tx.housemate.upsert({
        where: { userId_seasonId: { userId: app.userId, seasonId: app.seasonId } },
        update: { status: "active" },
        create: { userId: app.userId, seasonId: app.seasonId },
      });
    } else {
      await tx.housemate.deleteMany({ where: { userId: app.userId, seasonId: app.seasonId } });
    }
    return tx.application.update({
      where: { id: app.id },
      data: { status: decision, reviewedAt: decision === "pending" ? null : new Date() },
    });
  });
  return { app: updated, name: app.displayName };
}
