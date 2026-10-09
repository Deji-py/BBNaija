import { startHousemateMode } from "./modes/housemate.js";
import { joinHouse } from "./net/connection.js";
import { showLobby } from "./ui/lobby.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;

showLobby(app, async (options) => {
  const room = await joinHouse(options);
  startHousemateMode(app, room);
});
