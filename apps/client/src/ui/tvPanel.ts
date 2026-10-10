/** A small list of choices, shown beside the TV or the home theater. */
export class TvPanel {
  private readonly el: HTMLElement;
  private readonly note: HTMLElement;
  private current = "";
  private localFile = false;
  private status: string | null = null;
  private powerButton: HTMLButtonElement | null = null;

  constructor(
    parent: HTMLElement,
    title: string,
    choices: readonly { id: string; label: string }[],
    private readonly onPick: (id: string) => void,
    note: string,
    file?: { label: string; accept?: string; onFile: (file: File) => void; onStopFile: () => void },
    upload?: { label: string; accept: string; onFile: (file: File) => void },
    power?: { onToggle: () => void },
    extraClass?: string,
  ) {
    this.el = document.createElement("div");
    this.el.className = extraClass ? `tv-panel ${extraClass}` : "tv-panel";
    this.el.hidden = true;
    const heading = document.createElement("p");
    heading.className = "tv-panel-title";
    heading.textContent = title;
    this.el.append(heading);
    if (power) {
      this.powerButton = document.createElement("button");
      this.powerButton.type = "button";
      this.powerButton.textContent = "Turn the sound bar on";
      this.powerButton.addEventListener("click", () => power.onToggle());
      this.el.append(this.powerButton);
    }
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.station = choice.id;
      button.textContent = choice.label;
      button.addEventListener("click", () => {
        file?.onStopFile();
        this.onPick(choice.id);
      });
      this.el.append(button);
    }
    if (file) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = file.accept ?? "audio/*";
      input.hidden = true;
      const pick = document.createElement("button");
      pick.type = "button";
      pick.textContent = file.label;
      pick.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const chosen = input.files?.[0];
        input.value = "";
        if (chosen) file.onFile(chosen);
      });
      this.el.append(pick, input);
    }
    if (upload) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = upload.accept;
      input.hidden = true;
      const pick = document.createElement("button");
      pick.type = "button";
      pick.dataset.upload = "true";
      pick.textContent = upload.label;
      pick.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const chosen = input.files?.[0];
        input.value = "";
        if (chosen) upload.onFile(chosen);
      });
      this.el.append(pick, input);
    }
    this.note = document.createElement("p");
    this.note.className = "tv-panel-note";
    this.note.dataset.base = note;
    this.note.textContent = note;
    this.el.append(this.note);
    parent.append(this.el);
  }

  setOpen(open: boolean, selected: string, localFile = false): void {
    this.el.hidden = !open;
    if (selected !== this.current || localFile !== this.localFile) {
      this.current = selected;
      this.localFile = localFile;
      for (const button of this.el.querySelectorAll<HTMLButtonElement>("button[data-station]")) {
        button.setAttribute("aria-pressed", button.dataset.station === selected && !localFile ? "true" : "false");
      }
    }
    this.renderNote();
  }

  /** Sound-bar stations stay locked until it is on. The power button itself stays clickable. */
  setPower(on: boolean): void {
    if (this.powerButton) this.powerButton.textContent = on ? "Turn the sound bar off" : "Turn the sound bar on";
    if (this.status) return;
    for (const button of this.el.querySelectorAll<HTMLButtonElement>("button")) {
      if (button === this.powerButton) continue;
      button.disabled = !on;
    }
  }

  /** Replaces the hint line until cleared. Also locks the buttons while a movie is uploading. */
  setStatus(text: string | null, busy = false): void {
    this.status = text;
    for (const button of this.el.querySelectorAll<HTMLButtonElement>("button")) button.disabled = busy;
    this.renderNote();
  }

  private renderNote(): void {
    const base = this.note.dataset.base ?? "";
    this.note.textContent = this.status
      ? this.status
      : this.localFile
        ? "Playing your file on this computer only. Pick a station to go back."
        : base;
  }
}
