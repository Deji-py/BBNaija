import { startHousemateMode } from "./modes/housemate.js";
import { joinHouse } from "./net/connection.js";
import { showLobby } from "./ui/lobby.js";
import { requestMic } from "./voice/mic.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;

showLobby(app, async (options) => {
  // Created inside the click handler: browsers only let audio start after a user gesture.
  const audioCtx = new AudioContext();
  // Ask for the mic before joining, so voice links can include it from the start.
  const mic = await requestMic(audioCtx);
  try {
    const room = await joinHouse({ ...options, voice: true });
    startHousemateMode(app, room, audioCtx, mic);
  } catch (err) {
    mic.stream?.getTracks().forEach((t) => t.stop());
    void audioCtx.close();
    throw err;
  }
});
