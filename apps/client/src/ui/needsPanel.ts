import { NEEDS, NEED_INFO, moodOf, type NeedValues } from "@bbn/shared";

/**
 * "How am I feeling?" overlay for your own housemate: mood at the top, a bar
 * per need, and a hint for the most urgent one. Click the header to fold it.
 */
export class NeedsPanel {
  private readonly el: HTMLElement;
  private readonly mood: HTMLButtonElement;
  private readonly bars = new Map<string, { fill: HTMLElement; value: HTMLElement; row: HTMLElement }>();
  private readonly hint: HTMLElement;
  private shown = "";

  constructor(parent: HTMLElement) {
    this.el = document.createElement("aside");
    this.el.className = "needs-panel";
    this.el.hidden = true;
    this.mood = document.createElement("button");
    this.mood.type = "button";
    this.mood.className = "needs-mood";
    this.mood.title = "Show or hide your needs";
    this.mood.addEventListener("click", () => this.el.classList.toggle("folded"));
    const list = document.createElement("div");
    list.className = "needs-list";
    for (const need of NEEDS) {
      const info = NEED_INFO[need];
      const row = document.createElement("div");
      row.className = "need-row";
      row.title = info.fix;
      const label = document.createElement("span");
      label.className = "need-label";
      label.textContent = `${info.icon} ${info.label}`;
      const bar = document.createElement("span");
      bar.className = "need-bar";
      const fill = document.createElement("i");
      bar.append(fill);
      const value = document.createElement("span");
      value.className = "need-value";
      row.append(label, bar, value);
      list.append(row);
      this.bars.set(need, { fill, value, row });
    }
    this.hint = document.createElement("p");
    this.hint.className = "needs-hint";
    this.el.append(this.mood, list, this.hint);
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.append(this.el);
  }

  update(needs: NeedValues | undefined): void {
    if (!needs) return;
    const key = NEEDS.map((n) => needs[n]).join(",");
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = false;
    const mood = moodOf(needs);
    this.mood.textContent = `${mood.icon} ${mood.label}`;
    for (const need of NEEDS) {
      const v = needs[need];
      const bar = this.bars.get(need)!;
      bar.fill.style.width = `${v}%`;
      bar.fill.dataset.level = v < 25 ? "low" : v < 50 ? "mid" : "ok";
      bar.value.textContent = String(v);
      bar.row.classList.toggle("urgent", v < 25);
    }
    this.hint.textContent = mood.need ? `💡 ${NEED_INFO[mood.need].fix}` : "";
    this.hint.hidden = !mood.need;
  }
}
