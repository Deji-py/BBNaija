import { AVATAR_COLORS } from "@bbn/shared";
import { startHousemateMode } from "./modes/housemate.js";
import { startSpectatorMode } from "./modes/spectator.js";
import { startAdminMode } from "./modes/admin.js";
import { joinHouse } from "./net/connection.js";
import { api, getSessionToken } from "./net/api.js";
import { showAdminLogin, showLobby, showWatchStart } from "./ui/lobby.js";
import { showApply, showAuthVerify, showLanding, showSignIn } from "./ui/pages.js";
import { requestMic } from "./voice/mic.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
const path = location.pathname.replace(/\/+$/, "") || "/";

/** Simple path router: one entry point, a few pages. */
async function route(): Promise<void> {
  switch (path) {
    case "/":
      return showLanding(app);
    case "/signin":
      return showSignIn(app);
    case "/auth":
      return showAuthVerify(app);
    case "/apply":
      return showApply(app);
    case "/house":
      return enterHouse();
    case "/watch":
      return watch();
    case "/bigbrother":
      return bigBrother();
    default:
      location.replace("/");
  }
}

/** Selected housemates of the live season: pick a colour, then the 3D house. */
async function enterHouse(): Promise<void> {
  const me = await api.me();
  if (!me) return location.replace(`/signin?next=${encodeURIComponent("/house")}`);
  if (!me.canEnterHouse) return location.replace("/"); // the landing page explains your status
  const name = me.application?.displayName ?? me.user.displayName ?? "Housemate";

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
      const room = await joinHouse({ ...options, role: "housemate", voice: true, sessionToken: getSessionToken() ?? undefined });
      startHousemateMode(app, room, audioCtx, mic);
    } catch (err) {
      mic.stream?.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      throw err;
    }
  });
}

/** Spectators: no avatar, no mic. Signing in is optional (it sets your viewer-chat name). */
function watch(): void {
  app.classList.add("game");
  showWatchStart(app, async (name) => {
    const audioCtx = new AudioContext();
    try {
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!; // name colour in viewer chat
      const room = await joinHouse({ name, color, role: "viewer", voice: true, sessionToken: getSessionToken() ?? undefined });
      startSpectatorMode(app, room, audioCtx);
    } catch (err) {
      void audioCtx.close();
      throw err;
    }
  });
}

/** Big Brother console: needs the admin secret; the mic is for the Diary Room and announcements. */
function bigBrother(): void {
  app.classList.add("game");
  showAdminLogin(app, async (adminSecret) => {
    const audioCtx = new AudioContext();
    const mic = await requestMic(audioCtx);
    try {
      const room = await joinHouse({ name: "Big Brother", color: "#e0243b", role: "admin", adminSecret, voice: true });
      startAdminMode(app, room, audioCtx, mic, adminSecret);
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
