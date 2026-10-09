import {
  LIMITS,
  SEASON_STATUSES,
  isSafeHttpUrl,
  type AdminApplication,
  type AdminSeason,
  type ApplicationInput,
  type ApplicationStatus,
  type ApplicationView,
  type PublicSeason,
  type SeasonStatus,
} from "@bbn/shared";
import { db } from "../db/client.js";
import type { Application, Season } from "../generated/prisma/client.js";

export class SeasonError extends Error {
  constructor(
    readonly status: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

/** Statuses during which a season is "the" current one. Only one season may be in either at a time. */
const OPEN_STATUSES: SeasonStatus[] = ["applications", "live"];

/** The season the public sees: taking applications or live. */
export async function currentSeason(): Promise<Season | null> {
  return db.season.findFirst({ where: { status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" } });
}

export async function toPublicSeason(season: Season): Promise<PublicSeason> {
  const selectedCount = await db.housemate.count({ where: { seasonId: season.id, status: { not: "removed" } } });
  return {
    id: season.id,
    name: season.name,
    status: season.status as SeasonStatus,
    maxHousemates: season.maxHousemates,
    selectedCount,
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

/**
 * Who may enter the house as a housemate right now: a selected housemate
 * (not removed/evicted) of the season that's live.
 */
export async function housemateAccess(userId: string): Promise<{ season: Season; displayName: string } | null> {
  const season = await db.season.findFirst({ where: { status: "live" }, orderBy: { createdAt: "desc" } });
  if (!season) return null;
  const hm = await db.housemate.findUnique({ where: { userId_seasonId: { userId, seasonId: season.id } } });
  if (!hm || hm.status !== "active") return null;
  const app = await db.application.findUnique({ where: { userId_seasonId: { userId, seasonId: season.id } } });
  const user = await db.user.findUnique({ where: { id: userId } });
  return { season, displayName: app?.displayName ?? user?.displayName ?? "Housemate" };
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

/** Submit (or, while still pending, update) an application to the season taking applications. */
export async function submitApplication(userId: string, input: ApplicationInput): Promise<ApplicationView> {
  const season = await db.season.findFirst({ where: { status: "applications" }, orderBy: { createdAt: "desc" } });
  if (!season) throw new SeasonError("FORBIDDEN", "Applications aren't open right now.");

  const existing = await db.application.findUnique({ where: { userId_seasonId: { userId, seasonId: season.id } } });
  if (existing && existing.status !== "pending") {
    throw new SeasonError("CONFLICT", "Your application has already been reviewed.");
  }
  const data = { ...input, clipUrl: input.clipUrl || null };
  const app = existing
    ? await db.application.update({ where: { id: existing.id }, data })
    : await db.application.create({ data: { ...data, userId, seasonId: season.id } });
  await db.user.update({ where: { id: userId }, data: { displayName: input.displayName } });
  return toApplicationView(app);
}

// ------------------------------------------------------------------ admin

export async function listSeasons(): Promise<AdminSeason[]> {
  const seasons = await db.season.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { applications: true } } } });
  return Promise.all(
    seasons.map(async (s) => ({
      ...(await toPublicSeason(s)),
      applicationCount: s._count.applications,
      createdAt: s.createdAt.toISOString(),
    })),
  );
}

export async function createSeason(body: unknown): Promise<void> {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const max = Number(b.maxHousemates);
  if (!name || name.length > LIMITS.seasonName) throw new SeasonError("BAD_REQUEST", "Give the season a name (max 60 characters).");
  if (!Number.isInteger(max) || max < 2 || max > 8) throw new SeasonError("BAD_REQUEST", "Max housemates must be 2–8.");
  await db.season.create({ data: { name, maxHousemates: max } });
}

export async function setSeasonStatus(seasonId: string, status: unknown): Promise<Season> {
  if (!SEASON_STATUSES.includes(status as SeasonStatus)) throw new SeasonError("BAD_REQUEST", "Unknown status.");
  const season = await db.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new SeasonError("NOT_FOUND", "Season not found.");
  if (OPEN_STATUSES.includes(status as SeasonStatus)) {
    const other = await db.season.findFirst({ where: { id: { not: seasonId }, status: { in: OPEN_STATUSES } } });
    if (other) throw new SeasonError("CONFLICT", `“${other.name}” is already ${other.status === "live" ? "live" : "taking applications"}. End it first.`);
  }
  const data: { status: string; startsAt?: Date; endsAt?: Date } = { status: status as string };
  if (status === "live" && !season.startsAt) data.startsAt = new Date();
  if (status === "ended") data.endsAt = new Date();
  return db.season.update({ where: { id: seasonId }, data });
}

export async function listApplications(seasonId: string): Promise<AdminApplication[]> {
  const apps = await db.application.findMany({ where: { seasonId }, orderBy: { createdAt: "asc" }, include: { user: true } });
  return apps.map((a) => ({ ...toApplicationView(a), email: a.user.email, userId: a.userId }));
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
