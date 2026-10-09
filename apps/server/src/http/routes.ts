import { createEndpoint, createRouter } from "colyseus";
import type {
  AdminApplication,
  AdminSeason,
  HealthResponse,
  LoginRequestResponse,
  LoginVerifyResponse,
  MeResponse,
  PublicSeason,
} from "@bbn/shared";
import { AuthError, bearer, requestLoginLink, signOut, toPublicUser, userFromSession, verifyLoginLink } from "../accounts/auth.js";
import {
  SeasonError,
  createSeason,
  currentSeason,
  decideApplication,
  housemateAccess,
  listApplications,
  listSeasons,
  parseApplication,
  setSeasonStatus,
  submitApplication,
  toApplicationView,
  toPublicSeason,
} from "../accounts/seasons.js";
import { isAdminSecret } from "../config.js";
import { db } from "../db/client.js";
import { eventLog } from "../systems/eventLog.js";

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
async function handle(ctx: Ctx, fn: () => Promise<Record<string, unknown>>) {
  try {
    return ctx.json(await fn());
  } catch (err) {
    if (err instanceof AuthError || err instanceof SeasonError) throw ctx.error(err.status, { message: err.message });
    throw err;
  }
}

async function requireUser(ctx: Ctx) {
  const user = await userFromSession(bearer(ctx.getHeader("authorization")));
  if (!user) throw new AuthError("UNAUTHORIZED", "Please sign in.");
  return user;
}

function requireAdmin(ctx: Ctx): void {
  if (!isAdminSecret(ctx.getHeader("x-admin-secret"))) throw new AuthError("UNAUTHORIZED", "Wrong admin secret.");
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

  season: createEndpoint("/api/season", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const s = await currentSeason();
      const season: PublicSeason | null = s ? await toPublicSeason(s) : null;
      return { season };
    }),
  ),

  requestLogin: createEndpoint("/api/auth/request", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      const { devLink } = await requestLoginLink(email, ctx.getHeader("origin"));
      const res: LoginRequestResponse = { ok: true, ...(devLink ? { devLink } : {}) };
      return res as unknown as Record<string, unknown>;
    }),
  ),

  verifyLogin: createEndpoint("/api/auth/verify", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const res: LoginVerifyResponse = await verifyLoginLink((ctx.body as { token?: unknown } | undefined)?.token);
      return res as unknown as Record<string, unknown>;
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
      const s = await currentSeason();
      const app = s ? await db.application.findUnique({ where: { userId_seasonId: { userId: user.id, seasonId: s.id } } }) : null;
      const res: MeResponse = {
        user: toPublicUser(user),
        season: s ? await toPublicSeason(s) : null,
        application: app ? toApplicationView(app) : null,
        canEnterHouse: !!(await housemateAccess(user.id)),
      };
      return res as unknown as Record<string, unknown>;
    }),
  ),

  apply: createEndpoint("/api/applications", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      const user = await requireUser(ctx as Ctx);
      const application = await submitApplication(user.id, parseApplication(ctx.body));
      eventLog.add("application", `${application.displayName} (${user.email}) applied`);
      return { application };
    }),
  ),

  // ---------------------------------------------------------------- Big Brother (admin secret)

  adminSeasons: createEndpoint("/api/admin/seasons", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      requireAdmin(ctx as Ctx);
      const seasons: AdminSeason[] = await listSeasons();
      return { seasons };
    }),
  ),

  adminCreateSeason: createEndpoint("/api/admin/seasons", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      requireAdmin(ctx as Ctx);
      await createSeason(ctx.body);
      eventLog.add("season", `Season created: ${(ctx.body as { name?: string }).name}`);
      return { ok: true };
    }),
  ),

  adminSeasonStatus: createEndpoint("/api/admin/seasons/:id/status", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      requireAdmin(ctx as Ctx);
      const season = await setSeasonStatus(ctx.params.id, (ctx.body as { status?: unknown } | undefined)?.status);
      eventLog.add("season", `${season.name} is now ${season.status}`);
      return { ok: true };
    }),
  ),

  adminApplications: createEndpoint("/api/admin/seasons/:id/applications", { method: "GET" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      requireAdmin(ctx as Ctx);
      const applications: AdminApplication[] = await listApplications(ctx.params.id);
      return { applications };
    }),
  ),

  adminDecide: createEndpoint("/api/admin/applications/:id/decision", { method: "POST" }, async (ctx) =>
    handle(ctx as Ctx, async () => {
      requireAdmin(ctx as Ctx);
      const { app, name } = await decideApplication(ctx.params.id, (ctx.body as { decision?: unknown } | undefined)?.decision);
      eventLog.add("application", `${name} was ${app.status === "pending" ? "moved back to pending" : app.status}`);
      return { ok: true };
    }),
  ),
});
