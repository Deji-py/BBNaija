import { LIMITS, SEASON_STATUSES, isSafeHttpUrl, type AdminApplication, type AdminSeason } from "@bbn/shared";
import type { adminApi } from "../net/api.js";

type AdminApi = ReturnType<typeof adminApi>;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  applications: "Taking applications",
  live: "Live",
  ended: "Ended",
};

/**
 * Season management: create seasons and assign hosts (platform admin only),
 * move a season through draft → applications → live → ended, and review its
 * applicants. Hosts only ever see the seasons they host — the server enforces it.
 */
export class SeasonAdmin {
  private readonly el: HTMLElement;
  private readonly seasonsEl: HTMLElement;
  private readonly appsEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly filterEl: HTMLSelectElement;
  private seasons: AdminSeason[] = [];
  private platformAdmin = false;
  private selectedSeason: string | null = null;
  private readonly createForm: HTMLFormElement;

  constructor(
    parent: HTMLElement,
    private readonly api: AdminApi,
    /** When given, each season gets an "Open console" button. */
    private readonly onOpenConsole?: (season: AdminSeason) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "season-admin";
    this.el.innerHTML = `
      <section>
        <h2>Seasons</h2>
        <ul class="season-list"></ul>
        <form class="new-season" hidden>
          <input name="name" placeholder="New season name" maxlength="${LIMITS.seasonName}" required />
          <input name="max" type="number" min="2" max="8" value="8" aria-label="Max housemates" title="Max housemates" />
          <input name="host" type="email" placeholder="Host's email (optional)" maxlength="${LIMITS.email}" />
          <button type="submit">Create</button>
        </form>
        <p class="error admin-error" role="alert"></p>
      </section>
      <section>
        <h2>Applicants <select class="app-filter" aria-label="Show">
          <option value="all">All</option><option value="pending">Pending</option>
          <option value="selected">Selected</option><option value="rejected">Rejected</option>
        </select></h2>
        <div class="applicants"><p class="admin-note">Pick a season above.</p></div>
      </section>
    `;
    parent.appendChild(this.el);
    this.seasonsEl = this.el.querySelector(".season-list")!;
    this.appsEl = this.el.querySelector(".applicants")!;
    this.errorEl = this.el.querySelector(".admin-error")!;
    this.filterEl = this.el.querySelector(".app-filter")!;
    this.filterEl.addEventListener("change", () => void this.loadApplicants());

    const form = this.el.querySelector<HTMLFormElement>(".new-season")!;
    this.createForm = form;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
      const max = Number((form.elements.namedItem("max") as HTMLInputElement).value);
      const host = (form.elements.namedItem("host") as HTMLInputElement).value.trim();
      void this.run(async () => {
        await this.api.createSeason(name, max, host);
        form.reset();
      });
    });

    this.seasonsEl.addEventListener("change", (e) => {
      const select = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-season]");
      if (select) void this.run(() => this.api.setSeasonStatus(select.dataset.season!, select.value));
    });
    this.seasonsEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const li = target.closest<HTMLElement>("li[data-season]");
      if (!li || target.closest("select")) return;
      const season = this.seasons.find((s) => s.id === li.dataset.season);
      if (target.closest("[data-open]") && season) return this.onOpenConsole?.(season);
      if (target.closest("[data-host]") && season) {
        const email = prompt(`Host's email for ${season.name} (leave empty to remove the host):`, season.hostEmail);
        if (email !== null) void this.run(() => this.api.setHost(season.id, email.trim()));
        return;
      }
      this.selectedSeason = li.dataset.season!;
      this.renderSeasons();
      void this.loadApplicants();
    });
    this.appsEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-decision]");
      if (!b) return;
      void this.run(() => this.api.decide(b.dataset.app!, b.dataset.decision as "selected" | "rejected" | "pending"));
    });

    void this.refresh();
  }

  /** Reload everything (also call when the tab is shown). */
  async refresh(): Promise<void> {
    try {
      const res = await this.api.seasons();
      this.seasons = res.seasons;
      this.platformAdmin = res.platformAdmin;
      this.createForm.hidden = !this.platformAdmin;
      if (!this.selectedSeason || !this.seasons.some((s) => s.id === this.selectedSeason)) {
        this.selectedSeason = this.seasons.find((s) => s.status === "applications" || s.status === "live")?.id ?? this.seasons[0]?.id ?? null;
      }
      this.renderSeasons();
      await this.loadApplicants();
    } catch (err) {
      this.errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.errorEl.textContent = "";
    try {
      await action();
    } catch (err) {
      this.errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
    await this.refresh();
  }

  private renderSeasons(): void {
    this.seasonsEl.replaceChildren(
      ...this.seasons.map((s) => {
        const li = document.createElement("li");
        li.dataset.season = s.id;
        li.classList.toggle("selected", s.id === this.selectedSeason);
        const name = document.createElement("b");
        name.textContent = s.name;
        const meta = document.createElement("small");
        meta.textContent = `${s.selectedCount}/${s.maxHousemates} selected · ${s.applicationCount} applied`;
        const hostLine = document.createElement("small");
        hostLine.textContent = s.hostEmail ? `Host: ${s.hostEmail}` : "No host yet";
        const info = document.createElement("span");
        info.className = "who";
        info.append(name, meta, hostLine);
        const buttons = document.createElement("span");
        buttons.className = "season-buttons";
        if (this.platformAdmin) {
          const hostBtn = document.createElement("button");
          hostBtn.type = "button";
          hostBtn.dataset.host = "";
          hostBtn.textContent = "Host…";
          buttons.append(hostBtn);
        }
        if (this.onOpenConsole && s.status !== "ended") {
          const open = document.createElement("button");
          open.type = "button";
          open.dataset.open = "";
          open.className = "primary";
          open.textContent = "Open console";
          buttons.append(open);
        }
        const select = document.createElement("select");
        select.dataset.season = s.id;
        select.setAttribute("aria-label", `Status of ${s.name}`);
        for (const st of SEASON_STATUSES) {
          const o = document.createElement("option");
          o.value = st;
          o.textContent = STATUS_LABEL[st]!;
          o.selected = st === s.status;
          select.append(o);
        }
        li.append(info, select, buttons);
        return li;
      }),
    );
    if (!this.seasons.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = this.platformAdmin ? "No seasons yet — create one below." : "You don't host any seasons yet. Ask the platform admin to assign you one.";
      this.seasonsEl.append(li);
    }
  }

  private async loadApplicants(): Promise<void> {
    if (!this.selectedSeason) return;
    const apps = await this.api.applications(this.selectedSeason);
    const filter = this.filterEl.value;
    const shown = apps.filter((a) => filter === "all" || a.status === filter);
    this.appsEl.replaceChildren(...shown.map((a) => this.applicantCard(a)));
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "admin-note";
      p.textContent = apps.length ? "No applicants with that status." : "No applications yet.";
      this.appsEl.append(p);
    }
  }

  private applicantCard(a: AdminApplication): HTMLElement {
    const el = document.createElement("article");
    el.className = `applicant status-${a.status}`;
    const head = document.createElement("header");
    const name = document.createElement("b");
    name.textContent = a.displayName;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = a.status;
    head.append(name, badge);

    const meta = document.createElement("p");
    meta.className = "admin-note";
    meta.textContent = `${a.email} · ${a.country} · applied ${new Date(a.createdAt).toLocaleDateString()}`;

    const field = (label: string, value: string) => {
      const p = document.createElement("p");
      const l = document.createElement("span");
      l.className = "label";
      l.textContent = `${label}: `;
      p.append(l, document.createTextNode(value));
      return p;
    };
    el.append(head, meta, field("Bio", a.bio), field("Why", a.motivation), field("Availability", a.availability));
    if (a.clipUrl && isSafeHttpUrl(a.clipUrl)) {
      const p = document.createElement("p");
      const link = document.createElement("a");
      link.href = a.clipUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Intro clip ↗";
      p.append(link);
      el.append(p);
    }
    el.append(field("Consents", a.ageConfirmed && a.consentBroadcast && a.consentRecording && a.consentRules ? "18+, broadcast, recording, rules ✓" : "incomplete"));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const btn = (decision: string, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.app = a.id;
      b.dataset.decision = decision;
      b.textContent = label;
      b.disabled = a.status === decision;
      return b;
    };
    actions.append(btn("selected", "Select"), btn("rejected", "Reject"), btn("pending", "Reset"));
    el.append(actions);
    return el;
  }
}
