import type { AdminSeason } from "@bbn/shared";
import { adminApi, api, ApiError, type ConsoleAuth } from "../net/api.js";
import { SeasonAdmin } from "./adminSeasons.js";

/**
 * /bigbrother front door. Hosts come in with their normal sign-in and see only
 * the seasons they host; the platform admin uses the admin secret and sees
 * everything (and can create seasons and assign hosts). Picking a season opens
 * its live 3D console via `onOpen`.
 */
export async function showConsoleHome(
  parent: HTMLElement,
  onOpen: (auth: ConsoleAuth, season: AdminSeason) => Promise<void>,
): Promise<void> {
  const me = await api.me();
  parent.replaceChildren();
  const el = document.createElement("div");
  el.className = "page console-home";
  el.innerHTML = `
    <header class="site-header">
      <a class="brand" href="/">Big Brother <span>Ninja</span></a>
      <nav><span class="muted-inline">Big Brother console</span></nav>
    </header>
    <main class="page-main wide"></main>
  `;
  parent.append(el);
  const main = el.querySelector<HTMLElement>("main")!;

  const enter = (auth: ConsoleAuth) => {
    main.replaceChildren();
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent =
      auth.kind === "admin"
        ? "Platform admin: create seasons, assign hosts, and open any house's console."
        : `Signed in as ${me?.user.email}. You can run the houses you host.`;
    const status = document.createElement("p");
    status.className = "error";
    main.append(intro, status);
    new SeasonAdmin(main, adminApi(auth), (season) => {
      status.textContent = "";
      onOpen(auth, season).catch((err) => (status.textContent = err instanceof Error ? err.message : String(err)));
    });
  };

  const choose = document.createElement("section");
  choose.className = "card page-card";
  choose.innerHTML = `
    <h1>Big Brother console</h1>
    <div class="host-entry"></div>
    <form class="stack admin-entry">
      <label class="field"><span>Platform admin secret</span><input name="secret" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Open as platform admin</button>
      <p class="error" role="alert"></p>
    </form>
  `;
  main.append(choose);

  const hostEntry = choose.querySelector<HTMLElement>(".host-entry")!;
  if (me?.hosting.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `You host ${me.hosting.map((s) => s.name).join(", ")}.`;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Continue as host";
    b.addEventListener("click", () => enter({ kind: "host" }));
    hostEntry.append(p, b, Object.assign(document.createElement("p"), { className: "muted or", textContent: "— or —" }));
  } else {
    const p = document.createElement("p");
    p.className = "muted";
    p.innerHTML = me
      ? "You don't host any seasons. Hosts are assigned by the platform admin."
      : `Hosts: <a href="/signin?next=%2Fbigbrother">sign in</a> with the email the platform admin assigned to your season.`;
    hostEntry.append(p);
  }

  const form = choose.querySelector<HTMLFormElement>(".admin-entry")!;
  const err = form.querySelector<HTMLElement>(".error")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const secret = (form.elements.namedItem("secret") as HTMLInputElement).value;
    err.textContent = "";
    try {
      const res = await adminApi({ kind: "admin", secret }).seasons();
      if (!res.platformAdmin) throw new Error("That secret isn't right.");
      enter({ kind: "admin", secret });
    } catch (e2) {
      err.textContent = e2 instanceof ApiError && e2.status === 401 ? "That secret isn't right." : e2 instanceof Error ? e2.message : String(e2);
    }
  });
}
