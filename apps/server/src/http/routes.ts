import { createEndpoint, createRouter, matchMaker } from "colyseus";
import {
  HOUSE_ROOM,
  type AdminApplication,
  type AdminSeason,
  type HealthResponse,
  type HouseCard,
  type HouseSummary,
  type HousesResponse,
  type LoginRequestResponse,
  type LoginVerifyResponse,
  type MeResponse,
  type PublicSeason,
  VOTE_PACKS,
} from "@bbn/shared";
import { AuthError, bearer, requestLoginLink, signOut, toPublicUser, userFromSession, verifyLoginLink } from "../accounts/auth.js";
import {
  SeasonError,
  applicationSeason,
  createSeason,
  decideApplication,
  enterableSeasons,
  getSeason,
  isHostOf,
  listApplications,
  listSeasons,
  parseApplication,
  seasonsWithStatus,
  setSeasonHost,
  setSeasonStatus,
  submitApplication,
  toApplicationView,
  toPublicSeason,
} from "../accounts/seasons.js";
import { isAdminSecret } from "../config.js";
import { db } from "../db/client.js";
import type { Season } from "../generated/prisma/client.js";
import { eventLog } from "../systems/eventLog.js";
import { PaymentError, handlePaystackWebhook, paymentsEnabled, seasonStats, startCheckout, verifyCheckout } from "../systems/payments.js";

const startedAt = Date.now();

/** The context shape we use from the router (kept narrow on purpose). */
interface Ctx {
  body?: unknown;
  params?: Record<string, string>;
  getHeader(name: string): string | null;
  json(body: Record<string, unknown>): unknown;
  error(status: string, body?: { message?: string }): Error;
}

/** Turns our domain errors into HTTP errors with a readable message. */
async function handle(ctx: Ctx, fn: () => Promise<object>) {
  try {
    return ctx.json((await fn()) as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AuthError || err instanceof SeasonError || err instanceof PaymentError) throw ctx.error(err.status, { message: err.message });
    throw err;
  }
}

async function requireUser(ctx: Ctx) {
  const user = await userFromSession(bearer(ctx.getHeader("authorization")));
  if (!user) throw new AuthError("UNAUTHORIZED", "Please sign in.");
  return user;
}

/**
 * Who's using the console API: the platform admin (admin secret, every season)
 * or a signed-in host (only the seasons they host).
 */
async function consoleCaller(ctx: Ctx): Promise<{ admin: true } | { admin: false; userId: string }> {
  if (isAdminSecret(ctx.getHeader("x-admin-secret"))) return { admin: true };
  const user = await userFromSession(bearer(ctx.getHeader("authorization")));
  if (!user) throw new AuthError("UNAUTHORIZED", "Sign in as a host, or use the admin secret.");
  return { admin: false, userId: user.id };
}

async function requirePlatformAdmin(ctx: Ctx): Promise<void> {
  const caller = await consoleCaller(ctx);
  if (!caller.admin) throw new AuthError("FORBIDDEN", "Only the platform admin can do that.");
}

/** The caller may manage this season: platform admin, or its host. */
async function requireSeasonAccess(ctx: Ctx, season: Season | null): Promise<Season> {
  if (!season) throw new SeasonError("NOT_FOUND", "Season not found.");
  const caller = await consoleCaller(ctx);
  if (!caller.admin && !isHostOf({ id: caller.userId }, season)) throw new AuthError("FORBIDDEN", "You don't host this season.");
  return season;
}

/** Live houses for the home-page grid: live seasons, plus each house room's published summary. */
async function liveHouses(): Promise<HouseCard[]> {
  const [seasons, rooms] = await Promise.all([seasonsWithStatus("live"), matchMaker.query({ name: HOUSE_ROOM })]);
  const summaries = new Map<string, HouseSummary>();
  for (const r of rooms) {
    const m = r.metadata as HouseSummary | undefined;
    if (m?.seasonId) summaries.set(m.seasonId, m);
  }
  const cards = await Promise.all(
    seasons.map(async (s): Promise<HouseCard> => {
      const summary = summaries.get(s.id);
      return {
        season: await toPublicSeason(s),
        open: !!summary,
        seasonId: s.id,
        viewerCount: summary?.viewerCount ?? 0,
        housemates: summary?.housemates ?? [],
        task: summary?.task ?? "",
        round: summary?.round ?? "",
        diary: summary?.diary ?? false,
        tvOn: summary?.tvOn ?? false,
      };
    }),
  );
  // Busiest houses first, like a streaming site.
  return cards.sort((a, b) => b.viewerCount + b.housemates.length * 10 - (a.viewerCount + a.housemates.length * 10));
}

/**
 * HTTP API. Served by Colyseus on the game server's port; in development the
 * client reaches it through Vite at /colyseus/api/…
 */
export const routes = createRouter({
  health: createEndpoint("/health", { method: "GET" }, async (ctx) => {
    const body: HealthResponse = { ok: true, name: "big-brother-ninja", uptimeSec: Math.round((Date.now() - startedAt) / 1000) };
    return ctx.json(body);
  }),

  // ---------------------------------------------------------------- public

  houses: createEndpoint("/api/houses", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const res: HousesResponse = {
        live: await liveHouses(),
        applications: await Promise.all((await seasonsWithStatus("applications")).map(toPublicSeason)),
      };
      return res;
    }),
  ),

  season: createEndpoint("/api/seasons/:id", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const s = await getSeason(ctx.params.id);
      if (!s || s.status === "draft") throw new SeasonError("NOT_FOUND", "Season not found.");
      const season: PublicSeason = await toPublicSeason(s);
      return { season };
    }),
  ),

  requestLogin: createEndpoint("/api/auth/request", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      const { devLink } = await requestLoginLink(email, ctx.getHeader("origin"));
      const res: LoginRequestResponse = { ok: true, ...(devLink ? { devLink } : {}) };
      return res;
    }),
  ),

  verifyLogin: createEndpoint("/api/auth/verify", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const res: LoginVerifyResponse = await verifyLoginLink((ctx.body as { token?: unknown } | undefined)?.token);
      return res;
    }),
  ),

  signOut: createEndpoint("/api/auth/signout", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await signOut(bearer(ctx.getHeader("authorization")));
      return { ok: true };
    }),
  ),

  me: createEndpoint("/api/me", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const user = await requireUser(ctx as Ctx);
      const apps = await db.application.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { season: { include: { host: true } } },
      });
      const hosted = await db.season.findMany({ where: { hostUserId: user.id, status: { not: "ended" } }, include: { host: true } });
      const res: MeResponse = {
        user: toPublicUser(user),
        applications: await Promise.all(apps.map(async (a) => ({ season: await toPublicSeason(a.season), application: toApplicationView(a) }))),
        canEnter: await Promise.all((await enterableSeasons(user.id)).map(toPublicSeason)),
        hosting: await Promise.all(hosted.map(toPublicSeason)),
      };
      return res;
    }),
  ),

  apply: createEndpoint("/api/seasons/:id/applications", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const user = await requireUser(ctx as Ctx);
      const application = await submitApplication(user.id, ctx.params.id, parseApplication(ctx.body));
      eventLog.add("application", `${application.displayName} (${user.email}) applied`, ctx.params.id);
      return { application };
    }),
  ),

  // ---------------------------------------------------------------- console: platform admin or the season's host

  consoleSeasons: createEndpoint("/api/admin/seasons", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const caller = await consoleCaller(ctx as Ctx);
      const seasons: AdminSeason[] = await listSeasons(caller.admin ? undefined : caller.userId);
      return { seasons, platformAdmin: caller.admin };
    }),
  ),

  createSeason: createEndpoint("/api/admin/seasons", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await requirePlatformAdmin(ctx as Ctx);
      const season = await createSeason(ctx.body);
      eventLog.add("season", `Season created: ${season.name}`, season.id);
      return { ok: true };
    }),
  ),

  setHost: createEndpoint("/api/admin/seasons/:id/host", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await requirePlatformAdmin(ctx as Ctx);
      const { season, email } = await setSeasonHost(ctx.params.id, (ctx.body as { email?: unknown } | undefined)?.email);
      eventLog.add("season", email ? `${email} is now hosting ${season.name}` : `${season.name} has no host`, season.id);
      return { ok: true };
    }),
  ),

  seasonStatus: createEndpoint("/api/admin/seasons/:id/status", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await requireSeasonAccess(ctx as Ctx, await getSeason(ctx.params.id));
      const season = await setSeasonStatus(ctx.params.id, (ctx.body as { status?: unknown } | undefined)?.status);
      eventLog.add("season", `${season.name} is now ${season.status}`, season.id);
      return { ok: true };
    }),
  ),

  applications: createEndpoint("/api/admin/seasons/:id/applications", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await requireSeasonAccess(ctx as Ctx, await getSeason(ctx.params.id));
      const applications: AdminApplication[] = await listApplications(ctx.params.id);
      return { applications };
    }),
  ),

  seasonStats: createEndpoint("/api/admin/seasons/:id/stats", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      await requireSeasonAccess(ctx as Ctx, await getSeason(ctx.params.id));
      return seasonStats(ctx.params.id);
    }),
  ),

  paymentConfig: createEndpoint("/api/payments", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => ({
      enabled: paymentsEnabled(),
      packs: VOTE_PACKS.map((p) => ({ id: p.id, votes: p.votes, label: p.label, priceLabel: p.priceLabel })),
    })),
  ),

  checkout: createEndpoint("/api/payments/checkout", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const user = await requireUser(ctx as Ctx);
      const body = ctx.body as { packId?: unknown; seasonId?: unknown } | undefined;
      const origin = (ctx as Ctx).getHeader("origin") ?? process.env.PUBLIC_URL ?? "http://localhost:5173";
      const url = await startCheckout(user.id, user.email, String(body?.seasonId ?? ""), String(body?.packId ?? ""), origin);
      return { url };
    }),
  ),

  verifyPayment: createEndpoint("/api/payments/verify", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const user = await requireUser(ctx as Ctx);
      const reference = (ctx.body as { reference?: unknown } | undefined)?.reference;
      if (typeof reference !== "string") throw new PaymentError("BAD_REQUEST", "Missing payment reference.");
      return { message: await verifyCheckout(user.id, reference) };
    }),
  ),

  paystackWebhook: createEndpoint("/api/payments/webhook", { method: "POST" }, async (ctx) => {
    const raw = JSON.stringify(ctx.body ?? {});
    await handlePaystackWebhook(raw, (ctx as Ctx).getHeader("x-paystack-signature"));
    return (ctx as Ctx).json({ ok: true });
  }),

  decide: createEndpoint("/api/admin/applications/:id/decision", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const season = await requireSeasonAccess(ctx as Ctx, await applicationSeason(ctx.params.id));
      const { app, name } = await decideApplication(ctx.params.id, (ctx.body as { decision?: unknown } | undefined)?.decision);
      eventLog.add("application", `${name} was ${app.status === "pending" ? "moved back to pending" : app.status}`, season.id);
      return { ok: true };
    }),
  ),
});
