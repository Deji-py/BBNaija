import { startHousemateMode } from "./modes/housemate.js";
import { startSpectatorMode } from "./modes/spectator.js";
import { startAdminMode } from "./modes/admin.js";
import { joinHouse } from "./net/connection.js";
import { showAdminLogin, showLobby, showWatchStart } from "./ui/lobby.js";
import { requestMic } from "./voice/mic.js";
import { AVATAR_COLORS } from "@bbn/shared";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
const path = location.pathname.replace(/\/+$/, "");

if (path === "/bigbrother") {
  // Big Brother console: needs the admin secret; the mic is for the Diary Room and announcements.
  showAdminLogin(app, async (adminSecret) => {
    const audioCtx = new AudioContext();
    const mic = await requestMic(audioCtx);
    try {
      const room = await joinHouse({ name: "Big Brother", color: "#e0243b", role: "admin", adminSecret, voice: true });
      startAdminMode(app, room, audioCtx, mic);
    } catch (err) {
      mic.stream?.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      throw err;
    }
  });
} else if (path === "/watch") {
  // Spectators: no avatar, no mic.
  showWatchStart(app, async (name) => {
    // Created inside the click handler: browsers only let audio start after a user gesture.
    const audioCtx = new AudioContext();
    try {
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!; // name colour in viewer chat
      const room = await joinHouse({ name, color, role: "viewer", voice: true });
      startSpectatorMode(app, room, audioCtx);
    } catch (err) {
      void audioCtx.close();
      throw err;
    }
  });
} else {
  showLobby(app, async (options) => {
    const audioCtx = new AudioContext();
    // Ask for the mic before joining, so voice links can include it from the start.
    const mic = await requestMic(audioCtx);
    try {
      const room = await joinHouse({ ...options, role: "housemate", voice: true });
      startHousemateMode(app, room, audioCtx, mic);
    } catch (err) {
      mic.stream?.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      throw err;
    }
  });
}
