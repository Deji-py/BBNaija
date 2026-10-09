import { startHousemateMode } from "./modes/housemate.js";
import "./style.css";

// M1: solo mode. The lobby (name + colour picker) arrives with multiplayer in M2;
// until then `?name=` and `?color=` in the URL override the defaults.
const params = new URLSearchParams(location.search);
const name = params.get("name")?.slice(0, 20) || "Housemate";
const color = params.get("color") ? `#${params.get("color")!.replace(/^#/, "")}` : "#e4572e";

startHousemateMode(document.querySelector<HTMLElement>("#app")!, name, color);
