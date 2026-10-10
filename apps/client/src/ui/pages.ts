import { LIMITS, type ApplicationInput, type ApplicationView, type MeResponse, type PublicSeason } from "@bbn/shared";
import { api, ApiError } from "../net/api.js";
import { HouseGrid, applicationCards } from "./houseGrid.js";

/**
 * Plain HTML pages around the 3D house: landing, sign-in, the sign-in link
 * landing spot, and the application form. Everything user-supplied is set with
 * textContent (never innerHTML) so it can't inject markup.
 */

const NEXT_KEY = "bbn:next";

/** Only same-site paths are allowed as "where to go after signing in" (no open redirects). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function page(parent: HTMLElement, me: MeResponse | null): HTMLElement {
  parent.replaceChildren();
  const el = document.createElement("div");
  el.className = "page";
  el.innerHTML = `
    <header class="site-header">
      <a class="brand" href="/">Big Brother <span>Ninja</span></a>
      <nav>
        <a href="/">Live houses</a>
        <span class="who"></span>
      </nav>
    </header>
    <main class="page-main"></main>
  `;
  const who = el.querySelector(".who")!;
  if (me) {
    const name = document.createElement("span");
    name.className = "muted-inline";
    name.textContent = me.user.displayName ?? me.user.email;
    const out = document.createElement("button");
    out.type = "button";
    out.className = "link-button";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
      await api.signOut();
      location.href = "/";
    });
    who.append(name, out);
  } else {
    const a = document.createElement("a");
    a.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
    a.textContent = "Sign in";
    who.append(a);
  }
  parent.appendChild(el);
  return el.querySelector(".page-main")!;
}

function card(main: HTMLElement, title: string, text?: string): HTMLElement {
  const c = document.createElement("section");
  c.className = "card page-card";
  const h = document.createElement("h1");
  h.textContent = title;
  c.append(h);
  if (text) c.append(para(text));
  main.append(c);
  return c;
}

function para(text: string, className = "muted"): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function linkButton(href: string, label: string, secondary = false): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.className = secondary ? "button secondary" : "button";
  a.textContent = label;
  return a;
}

function seasonLine(s: PublicSeason): string {
  return `${s.selectedCount} of ${s.maxHousemates} housemates selected`;
}

// ------------------------------------------------------------------ landing

const GRID_REFRESH_MS = 5000;

/** Home: a Twitch-style grid of live houses, seasons taking applications, and your own status. */
export async function showLanding(parent: HTMLElement): Promise<void> {
  const [me, houses] = await Promise.all([api.me(), api.houses()]);
  const main = page(parent, me);
  main.classList.add("wide");

  if (me) main.append(...myStatusCards(me));

  const liveHead = document.createElement("h2");
  liveHead.className = "section-title";
  liveHead.innerHTML = `<span class="live-dot"></span> Live houses`;
  main.append(liveHead);
  const grid = new HouseGrid(main);
  grid.set(houses.live);

  const appsSection = document.createElement("section");
  main.append(appsSection);
  const renderApps = (seasons: PublicSeason[]) => {
    appsSection.replaceChildren();
    if (!seasons.length) return;
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = "🎟️ Taking applications";
    appsSection.append(h, applicationCards(seasons));
  };
  renderApps(houses.applications);

  const about = document.createElement("p");
  about.className = "muted center about";
  about.textContent =
    "Selected housemates live together in a 3D house — talking, cooking, plotting — while everyone else watches live, picks favourites and votes.";
  main.append(about);

  // Keep the grid live: viewer counts, who's where, what's happening.
  const timer = setInterval(async () => {
    try {
      const next = await api.houses();
      grid.set(next.live);
      renderApps(next.applications);
    } catch {
      // Server blip: keep showing the last data.
    }
  }, GRID_REFRESH_MS);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    grid.dispose();
  });
}

/** Your applications, houses you can enter, and houses you host. */
function myStatusCards(me: MeResponse): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (me.canEnter.length) {
    const c = document.createElement("section");
    c.className = "card page-card highlight";
    const h = document.createElement("h2");
    h.textContent = "You're a housemate! 🎉";
    c.append(h);
    for (const s of me.canEnter) c.append(linkButton(`/house/${encodeURIComponent(s.id)}`, `Enter ${s.name}`));
    out.push(c);
  }
  if (me.hosting.length) {
    const c = document.createElement("section");
    c.className = "card page-card";
    const h = document.createElement("h2");
    h.textContent = "Houses you host";
    c.append(h, para(me.hosting.map((s) => `${s.name} (${s.status})`).join(" · ")), linkButton("/bigbrother", "Open the Big Brother console"));
    out.push(c);
  }
  const pending = me.applications.filter((a) => !me.canEnter.some((s) => s.id === a.season.id));
  if (pending.length) {
    const c = document.createElement("section");
    c.className = "card page-card";
    const h = document.createElement("h2");
    h.textContent = "Your applications";
    c.append(h);
    for (const { season, application } of pending) c.append(para(applicationLine(season, application)));
    out.push(c);
  }
  return out;
}

function applicationLine(season: PublicSeason, app: ApplicationView): string {
  if (app.status === "pending") return `${season.name}: Big Brother is reviewing your application.`;
  if (app.status === "rejected") return `${season.name}: thanks for applying — you weren't selected this time.`;
  return season.status === "ended"
    ? `${season.name}: you were a housemate. The season has ended.`
    : `${season.name}: you've been selected! You can enter once the season goes live.`;
}

// ------------------------------------------------------------------ sign in

export async function showSignIn(parent: HTMLElement): Promise<void> {
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const me = await api.me();
  if (me) {
    location.replace(next);
    return;
  }
  const main = page(parent, null);
  const c = card(main, "Sign in", "We'll send you a link — no password needed.");
  const form = document.createElement("form");
  form.className = "stack";
  form.innerHTML = `
    <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" maxlength="${LIMITS.email}" /></label>
    <button type="submit">Send sign-in link</button>
    <p class="error" role="alert"></p>
    <div class="result"></div>
  `;
  c.append(form);
  const input = form.elements.namedItem("email") as HTMLInputElement;
  const button = form.querySelector("button")!;
  const error = form.querySelector<HTMLElement>(".error")!;
  const result = form.querySelector<HTMLElement>(".result")!;
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = "";
    try {
      sessionStorage.setItem(NEXT_KEY, next);
      const res = await api.requestLogin(input.value);
      result.replaceChildren(para(`Check ${input.value} for your sign-in link. It works once, for 15 minutes.`));
      if (res.devLink) {
        // Development only: there's no email service locally, so show the link here.
        const box = document.createElement("div");
        box.className = "dev-box";
        box.append(para("Development mode — no email is sent. Use this link:", "dev-note"));
        const a = document.createElement("a");
        a.href = res.devLink;
        a.className = "button";
        a.textContent = "Open sign-in link";
        box.append(a);
        result.append(box);
      }
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      button.disabled = false;
    }
  });
}

/** Where sign-in links land: swaps the link's token for a session, then continues. */
export async function showAuthVerify(parent: HTMLElement): Promise<void> {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const main = page(parent, null);
  const c = card(main, "Signing you in…");
  try {
    await api.verifyLogin(token);
    let next = "/";
    try {
      next = safeNext(sessionStorage.getItem(NEXT_KEY));
      sessionStorage.removeItem(NEXT_KEY);
    } catch {
      // ignore
    }
    location.replace(next);
  } catch (err) {
    c.querySelector("h1")!.textContent = "That link didn't work";
    c.append(para(err instanceof Error ? err.message : String(err)), linkButton("/signin", "Get a new link"));
  }
}

// ------------------------------------------------------------------ apply

export async function showApply(parent: HTMLElement, seasonId: string): Promise<void> {
  const me = await api.me();
  if (!me) {
    location.replace(`/signin?next=${encodeURIComponent(location.pathname)}`);
    return;
  }
  const main = page(parent, me);
  let season: PublicSeason;
  try {
    season = await api.season(seasonId);
  } catch {
    card(main, "Season not found", "That season doesn't exist (or isn't open yet).").append(linkButton("/", "See live houses"));
    return;
  }
  const existing = me.applications.find((a) => a.season.id === season.id);
  if (season.status !== "applications") {
    const c = card(main, `${season.name} isn't taking applications`, season.status === "live" ? "It's live now — come and watch!" : "");
    if (existing) c.append(para(applicationLine(season, existing.application)));
    c.append(linkButton(season.status === "live" ? `/watch/${encodeURIComponent(season.id)}` : "/", season.status === "live" ? "Watch live" : "Back home"));
    return;
  }
  if (existing && existing.application.status !== "pending") {
    card(main, season.name, applicationLine(season, existing.application));
    return;
  }
  if (me.hosting.some((s) => s.id === season.id)) {
    card(main, season.name, "You host this season, so you can't apply to it.");
    return;
  }

  const a = existing?.application;
  const c = card(
    main,
    `Apply for ${season.name}`,
    `${season.hostName ? `Hosted by ${season.hostName}. ` : ""}${seasonLine(season)}. You can edit your application until it's reviewed.`,
  );
  const form = document.createElement("form");
  form.className = "stack apply-form";
  form.innerHTML = `
    <label class="field"><span>Display name (shown in the house)</span><input name="displayName" required maxlength="${LIMITS.displayName}" /></label>
    <label class="field"><span>Country</span><input name="country" required maxlength="${LIMITS.country}" autocomplete="country-name" /></label>
    <label class="field"><span>About you</span><textarea name="bio" required maxlength="${LIMITS.bio}" rows="4"></textarea></label>
    <label class="field"><span>Why should Big Brother pick you?</span><textarea name="motivation" required maxlength="${LIMITS.motivation}" rows="4"></textarea></label>
    <label class="field"><span>Link to a short intro clip (optional)</span><input name="clipUrl" type="url" maxlength="${LIMITS.clipUrl}" placeholder="https://…" /></label>
    <label class="field"><span>When can you be in the house? (time zone too)</span><input name="availability" required maxlength="${LIMITS.availability}" placeholder="e.g. Weekday evenings 7–10pm WAT" /></label>
    <fieldset class="field consents">
      <legend>Please confirm</legend>
      <label class="check"><input type="checkbox" name="ageConfirmed" required /> I am 18 or older.</label>
      <label class="check"><input type="checkbox" name="consentBroadcast" required /> I agree to be broadcast live to the public while in the house.</label>
      <label class="check"><input type="checkbox" name="consentRecording" required /> I agree that my voice and in-house activity may be recorded.</label>
      <label class="check"><input type="checkbox" name="consentRules" required /> I'll follow the house rules and Big Brother's instructions.</label>
    </fieldset>
    <button type="submit">${a ? "Update application" : "Send application"}</button>
    <p class="error" role="alert"></p>
  `;
  c.append(form);
  const f = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  if (a) {
    for (const k of ["displayName", "country", "bio", "motivation", "clipUrl", "availability"] as const) f(k).value = a[k];
    for (const k of ["ageConfirmed", "consentBroadcast", "consentRecording", "consentRules"] as const) f(k).checked = a[k];
  } else if (me.user.displayName) {
    f("displayName").value = me.user.displayName;
  }

  const button = form.querySelector("button")!;
  const error = form.querySelector<HTMLElement>(".error")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = "";
    const input: ApplicationInput = {
      displayName: f("displayName").value,
      country: f("country").value,
      bio: f("bio").value,
      motivation: f("motivation").value,
      clipUrl: f("clipUrl").value,
      availability: f("availability").value,
      ageConfirmed: f("ageConfirmed").checked,
      consentBroadcast: f("consentBroadcast").checked,
      consentRecording: f("consentRecording").checked,
      consentRules: f("consentRules").checked,
    };
    try {
      await api.apply(season.id, input);
      location.href = "/";
    } catch (err) {
      error.textContent = err instanceof ApiError || err instanceof Error ? err.message : String(err);
      button.disabled = false;
    }
  });
}
