import { AVATAR_COLORS } from "@bbn/shared";
import { startHousemateMode } from "./modes/housemate.js";
import { startSpectatorMode } from "./modes/spectator.js";
import { startAdminMode } from "./modes/admin.js";
import { joinHouse } from "./net/connection.js";
import { api, getSessionToken, paymentsApi } from "./net/api.js";
import { showLobby, showWatchStart } from "./ui/lobby.js";
import { showApply, showAuthVerify, showLanding, showSignIn } from "./ui/pages.js";
import { showConsoleHome } from "./ui/consoleHome.js";
import { requestMic } from "./voice/mic.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
const [, section = "", id = ""] = location.pathname.replace(/\/+$/, "").split("/").map(decodeURIComponent);

/**
 * Simple path router. Each live season is its own house, so watching, entering
 * and applying take the season id: /watch/<id>, /house/<id>, /apply/<id>.
 */
async function route(): Promise<void> {
  switch (section) {
    case "":
      return showLanding(app);
    case "signin":
      return showSignIn(app);
    case "auth":
      return showAuthVerify(app);
    case "apply":
      return id ? showApply(app, id) : location.replace("/");
    case "house":
      return id ? enterHouse(id) : location.replace("/");
    case "watch":
      return id ? watch(id) : location.replace("/");
    case "bigbrother":
      return bigBrother();
    default:
      location.replace("/");
  }
}

/** Selected housemates of a live season: pick a colour, then the 3D house. */
async function enterHouse(seasonId: string): Promise<void> {
  const me = await api.me();
  if (!me) return location.replace(`/signin?next=${encodeURIComponent(location.pathname)}`);
  const season = me.canEnter.find((s) => s.id === seasonId);
  if (!season) return location.replace("/"); // the home page explains your status
  const name = me.applications.find((a) => a.season.id === seasonId)?.application.displayName ?? me.user.displayName ?? "Housemate";

  app.classList.add("game");
  showLobby(app, name, async (options, status) => {
    // Created inside the click handler: browsers only let audio start after a user gesture.
    const audioCtx = new AudioContext();
    // Ask for the mic before joining, so voice links can include it from the start.
    const skip = new Promise<void>((resolve) =>
      status.hint("Waiting for microphone permission…", "Continue without mic", resolve),
    );
    const mic = await requestMic(audioCtx, skip);
    status.hint("Entering…");
    try {
      const room = await joinHouse({ ...options, seasonId, role: "housemate", voice: true, sessionToken: getSessionToken() ?? undefined });
      startHousemateMode(app, room, audioCtx, mic, seasonId);
    } catch (err) {
      mic.stream?.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      throw err;
    }
  });
}

/** Spectators: no avatar, no mic. Signing in is optional (it sets your viewer-chat name). */
async function watch(seasonId: string): Promise<void> {
  app.classList.add("game");
  const reference = new URLSearchParams(location.search).get("reference");
  let note: string | undefined;
  if (reference && getSessionToken()) {
    try {
      note = await paymentsApi.verify(reference);
    } catch (err) {
      note = err instanceof Error ? err.message : "Couldn't confirm the payment.";
    }
    history.replaceState(null, "", location.pathname);
  }
  showWatchStart(app, async (name) => {
    const audioCtx = new AudioContext();
    try {
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!; // name colour in viewer chat
      const room = await joinHouse({ name, color, seasonId, role: "viewer", voice: true, sessionToken: getSessionToken() ?? undefined });
      startSpectatorMode(app, room, audioCtx, seasonId);
    } catch (err) {
      void audioCtx.close();
      throw err;
    }
  }, note);
}

/**
 * Big Brother console: hosts (signed in) or the platform admin (secret) pick a
 * season, then its live console opens in place — the secret never leaves memory.
 */
function bigBrother(): Promise<void> {
  return showConsoleHome(app, async (auth, season) => {
    // Clicking "Open console" is the user gesture that lets audio start.
    const audioCtx = new AudioContext();
    const mic = await requestMic(audioCtx);
    try {
      const room = await joinHouse({
        name: "Big Brother",
        color: "#e0243b",
        seasonId: season.id,
        role: "admin",
        voice: true,
        ...(auth.kind === "admin" ? { adminSecret: auth.secret } : { sessionToken: getSessionToken() ?? undefined }),
      });
      app.replaceChildren();
      app.classList.add("game");
      startAdminMode(app, room, audioCtx, mic, auth, season.id);
    } catch (err) {
      mic.stream?.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      throw err;
    }
  });
}

route().catch((err) => {
  console.error(err);
  app.textContent = "Something went wrong loading this page. Is the server running?";
});
