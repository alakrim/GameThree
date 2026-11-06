import { PALETTE } from '../render/palette.js';

export interface CompassMarker { yaw: number; color: string; label?: string }
export interface HudStats { fps: number; ms: number; tier: string; mode: string; status: string; rtt: number; tick: number; ents: number; draws: number; tris: number }

/** DOM HUD: compass bar, vitals, reticle, prompts. Crisp at any DPR and cheap to update. */
export class Hud {
  private compass: HTMLDivElement; private ticks: { el: HTMLDivElement; yaw: number }[] = [];
  private marks: HTMLDivElement[] = [];
  private hp: HTMLElement; private stats: HTMLDivElement; private prompt: HTMLDivElement; private help: HTMLDivElement;
  constructor(root: HTMLElement, touch: boolean, onView: () => void) {
    root.innerHTML = `
      <div class="compass"></div>
      <div class="reticle"></div>
      <div class="vitals"><div class="bar"><i></i></div><span class="bar-label">Health</span></div>
      <div class="stats"></div>
      <div class="prompt">${touch ? 'Left thumb: move · Right thumb: look' : 'Click to take control'}</div>
      <div class="help">${touch ? '' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp; <kbd>Mouse</kbd> look &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>V</kbd> 1st / 3rd person &nbsp; <kbd>Esc</kbd> release'}</div>
      <button class="btn">VIEW</button>`;
    this.compass = root.querySelector('.compass')!;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    // World "north" = sim +y = camera yaw 0.
    dirs.forEach((d, i) => {
      const el = document.createElement('div'); el.className = `tick${d.length > 1 ? ' minor' : ''}`; el.textContent = d;
      this.compass.appendChild(el); this.ticks.push({ el, yaw: -(i / 8) * Math.PI * 2 });
    });
    this.hp = root.querySelector('.bar > i')!;
    this.stats = root.querySelector('.stats')!;
    this.prompt = root.querySelector('.prompt')!;
    this.help = root.querySelector('.help')!;
    root.querySelector('.btn')!.addEventListener('click', onView);
    if (touch) setTimeout(() => { this.prompt.style.opacity = '0'; }, 5000);
    setTimeout(() => { this.help.style.opacity = '0.55'; }, 12000);
  }

  setMarkers(m: CompassMarker[]) {
    for (const el of this.marks) el.remove();
    this.marks = m.map((mk) => {
      const el = document.createElement('div'); el.className = 'mark'; el.style.background = mk.color; el.title = mk.label ?? '';
      this.compass.appendChild(el); (el as HTMLDivElement & { yaw: number }).yaw = mk.yaw; return el;
    });
  }

  /** Re-aim a marker (e.g. bearing from the player to an objective). */
  setMarkerYaw(i: number, yaw: number) { const m = this.marks[i] as (HTMLDivElement & { yaw: number }) | undefined; if (m) m.yaw = yaw; }

  /** Place every compass element by its angular offset from the camera yaw (±100° visible). */
  update(camYaw: number, hpFrac: number, locked: boolean, touch: boolean) {
    const w = this.compass.clientWidth, span = (Math.PI * 200) / 180;
    const place = (el: HTMLElement, yaw: number) => {
      const d = Math.atan2(Math.sin(yaw - camYaw), Math.cos(yaw - camYaw));
      el.style.left = `${(0.5 - d / span) * w}px`;
      el.style.display = Math.abs(d) < span / 2 ? '' : 'none';
    };
    for (const t of this.ticks) place(t.el, t.yaw);
    for (const m of this.marks) place(m, (m as HTMLDivElement & { yaw: number }).yaw);
    this.hp.style.width = `${Math.max(0, Math.min(1, hpFrac)) * 100}%`;
    if (!touch) this.prompt.style.opacity = locked ? '0' : '1';
  }

  updateStats(s: HudStats) {
    this.stats.innerHTML = `<b>${s.fps.toFixed(0)}</b> fps · ${s.ms.toFixed(1)} ms · ${s.tier}<br>${s.mode} · ${s.status}${s.mode === 'ws' ? ` · <b>${s.rtt.toFixed(0)}</b> ms` : ''}<br>${s.draws} draws · ${(s.tris / 1000).toFixed(0)}k tris · ${s.ents} units`;
  }
}

export const markerColors = { ally: (t: 0 | 1) => `#${(t === 0 ? PALETTE.dawn : PALETTE.dusk).toString(16).padStart(6, '0')}`, enemy: `#${PALETTE.hostile.toString(16)}` };

export class LoadingScreen {
  private el: HTMLDivElement; private fill: HTMLElement;
  constructor() {
    this.el = document.createElement('div'); this.el.className = 'loading';
    this.el.innerHTML = `<div><h1>PROJECT LUMEN</h1><p>The Skarnveld</p><div class="bar"><i></i></div></div>`;
    document.body.appendChild(this.el);
    this.fill = this.el.querySelector('.bar > i')!;
  }
  progress(f: number) { this.fill.style.width = `${Math.round(f * 100)}%`; }
  done() { this.el.style.opacity = '0'; setTimeout(() => this.el.remove(), 900); }
}
