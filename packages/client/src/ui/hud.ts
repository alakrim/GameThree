import { HEROES, HERO_IDS, type HeroDef } from '@lumen/shared';
import { PALETTE } from '../render/palette.js';

export interface CompassMarker { yaw: number; color: string; label?: string }
export interface HudStats { fps: number; ms: number; tier: string; mode: string; status: string; rtt: number; tick: number; ents: number; draws: number; tris: number }
export interface HeroState { hpFrac: number; level: number; xp: number; cds: number[]; dead: boolean; respawn: number }

const KEYS = ['LMB', 'Q', 'E', 'R'];

/** DOM HUD: compass, vitals, ability bar, combat text, death/victory overlays. Crisp at any DPR and cheap to update. */
export class Hud {
  private compass: HTMLDivElement; private ticks: { el: HTMLDivElement; yaw: number }[] = [];
  private marks: (HTMLDivElement & { yaw: number })[] = [];
  private hp: HTMLElement; private xp: HTMLElement; private lvl: HTMLElement;
  private stats: HTMLDivElement; private prompt: HTMLDivElement; private help: HTMLDivElement;
  private abCd: HTMLElement[] = []; private tbCd: HTMLElement[] = [];
  private msg: HTMLDivElement;
  private root: HTMLElement;
  private dmgPool: HTMLDivElement[] = [];
  private floating: { el: HTMLDivElement; x: number; y: number; z: number; t: number }[] = [];

  constructor(root: HTMLElement, readonly touch: boolean, hero: HeroDef, actions: { view(): void; act(slot: number, phase: 'down' | 'up'): void }) {
    this.root = root;
    const names = ['Attack', ...hero.abilities.map((a) => a.name)];
    root.innerHTML = `
      <div class="compass"></div>
      <div class="reticle"></div>
      <div class="abilities">${names.map((n, i) => `<div class="ab${i === 3 ? ' ult' : ''}"><span class="key">${KEYS[i]}</span><span class="nm">${n}</span><div class="cd"></div></div>`).join('')}</div>
      <div class="level"><span>1</span></div>
      <div class="vitals"><div class="bar"><i></i></div><div class="xp"><i></i></div><span class="bar-label">${hero.name} · ${hero.role}</span></div>
      <div class="stats"></div>
      <div class="overlay-msg"><h2></h2><p></p></div>
      <div class="prompt">${touch ? 'Left thumb: move · Right thumb: look' : 'Click to take control'}</div>
      <div class="help">${touch ? '' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp; <kbd>LMB</kbd> attack &nbsp; <kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd> abilities &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>V</kbd> view &nbsp; <kbd>Esc</kbd> release'}</div>
      <div class="tbtns"></div>
      <button class="btn">VIEW</button>`;
    this.compass = root.querySelector('.compass')!;
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].forEach((d, i) => {
      const el = document.createElement('div'); el.className = `tick${d.length > 1 ? ' minor' : ''}`; el.textContent = d;
      this.compass.appendChild(el); this.ticks.push({ el, yaw: -(i / 8) * Math.PI * 2 }); // north = sim +y = camera yaw 0
    });
    this.hp = root.querySelector('.bar > i')!; this.xp = root.querySelector('.xp > i')!; this.lvl = root.querySelector('.level span')!;
    this.stats = root.querySelector('.stats')!; this.prompt = root.querySelector('.prompt')!; this.help = root.querySelector('.help')!;
    this.msg = root.querySelector('.overlay-msg')!;
    this.abCd = [...root.querySelectorAll<HTMLElement>('.ab .cd')];
    root.querySelector('.btn')!.addEventListener('click', actions.view);
    // Touch: attack + abilities on a right-thumb arc.
    const tb = root.querySelector('.tbtns')!;
    const layout = [{ x: 110, y: 110, s: 76, l: 'ATK' }, { x: 26, y: 120, s: 56, l: 'Q' }, { x: 64, y: 44, s: 56, l: 'E' }, { x: 136, y: 18, s: 56, l: 'R' }];
    layout.forEach((b, i) => {
      const el = document.createElement('button'); el.className = 'tb';
      Object.assign(el.style, { left: `${b.x - b.s / 2 + 40}px`, top: `${b.y - b.s / 2 + 40}px`, width: `${b.s}px`, height: `${b.s}px` });
      el.innerHTML = `<div class="cd">${b.l}</div>`;
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); actions.act(i, 'down'); });
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); actions.act(i, 'up'); });
      tb.appendChild(el); this.tbCd.push(el.querySelector('.cd')!);
    });
    if (touch) setTimeout(() => { this.prompt.style.opacity = '0'; }, 5000);
    setTimeout(() => { this.help.style.opacity = '0.55'; }, 15000);
  }

  setMarkers(m: CompassMarker[]) {
    for (const el of this.marks) el.remove();
    this.marks = m.map((mk) => {
      const el = document.createElement('div') as HTMLDivElement & { yaw: number };
      el.className = 'mark'; el.style.background = mk.color; el.title = mk.label ?? ''; el.yaw = mk.yaw;
      this.compass.appendChild(el); return el;
    });
  }
  setMarkerYaw(i: number, yaw: number) { const m = this.marks[i]; if (m) m.yaw = yaw; }

  update(camYaw: number, s: HeroState, locked: boolean, cooldownTotals: number[]) {
    const w = this.compass.clientWidth, span = (Math.PI * 200) / 180;
    const place = (el: HTMLElement, yaw: number) => {
      const d = Math.atan2(Math.sin(yaw - camYaw), Math.cos(yaw - camYaw));
      el.style.left = `${(0.5 - d / span) * w}px`;
      el.style.display = Math.abs(d) < span / 2 ? '' : 'none';
    };
    for (const t of this.ticks) place(t.el, t.yaw);
    for (const m of this.marks) place(m, m.yaw);
    this.hp.style.width = `${Math.max(0, Math.min(1, s.hpFrac)) * 100}%`;
    this.xp.style.width = `${Math.max(0, Math.min(1, s.xp)) * 100}%`;
    this.lvl.textContent = String(s.level);
    s.cds.forEach((c, i) => {
      const pct = c > 0 ? Math.min(100, (c / Math.max(0.01, cooldownTotals[i]!)) * 100) : 0;
      const txt = c > 0.05 ? (c >= 1 ? Math.ceil(c).toString() : c.toFixed(1)) : '';
      for (const el of [this.abCd[i], this.tbCd[i]]) if (el) { el.style.setProperty('--p', `${pct}%`); if (el.parentElement?.classList.contains('ab')) el.textContent = txt; }
    });
    document.body.classList.toggle('dead', s.dead);
    if (!this.touch) this.prompt.style.opacity = locked ? '0' : '1';
  }

  message(title: string, sub: string, cls: '' | 'victory' | 'defeat' = '') {
    this.msg.className = `overlay-msg show ${cls}`;
    this.msg.querySelector('h2')!.textContent = title; this.msg.querySelector('p')!.textContent = sub;
  }
  clearMessage() { this.msg.classList.remove('show'); }

  /** Floating combat text anchored to a world position (projected each frame by `project`). */
  damage(x: number, y: number, z: number, n: number, cls: '' | 'ab' | 'taken' | 'heal' = '') {
    const el = this.dmgPool.pop() ?? Object.assign(document.createElement('div'), { className: 'dmg' });
    el.className = `dmg ${cls}`; el.textContent = String(n); el.style.opacity = '1';
    this.root.appendChild(el);
    this.floating.push({ el, x: x + (Math.random() - 0.5) * 0.6, y, z: z + (Math.random() - 0.5) * 0.6, t: 0 });
  }
  updateFloating(dt: number, project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }) {
    for (const f of [...this.floating]) {
      f.t += dt;
      const p = project(f.x, f.y + f.t * 1.4, f.z);
      f.el.style.display = p.visible ? '' : 'none';
      f.el.style.left = `${p.x}px`; f.el.style.top = `${p.y}px`;
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.5) / 0.5));
      if (f.t > 1) { f.el.remove(); this.dmgPool.push(f.el); this.floating.splice(this.floating.indexOf(f), 1); }
    }
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

/** Pre-match hero selection. Resolves with a hero id (remembered for next time). */
export function pickHero(initial: string): Promise<string> {
  return new Promise((resolve) => {
    let sel = HEROES[initial] ? initial : HERO_IDS[0]!;
    const el = document.createElement('div'); el.className = 'picker';
    const keys = ['Q', 'E', 'R'];
    el.innerHTML = `<div><h1>Choose your champion</h1><p>3 v 3 · Skarnveld</p><div class="cards">${HERO_IDS.map((id) => {
      const h = HEROES[id]!;
      return `<button class="card${id === sel ? ' sel' : ''}" data-id="${id}"><span class="t">${h.role}</span><h3>${h.name}</h3><span class="t">${h.title}</span><p>${h.blurb}</p><ul>${h.abilities.map((a, i) => `<li><b>${keys[i]}</b>${a.name}</li>`).join('')}</ul></button>`;
    }).join('')}</div><button class="go">Enter the valley</button></div>`;
    document.body.appendChild(el);
    el.querySelectorAll<HTMLButtonElement>('.card').forEach((c) => c.addEventListener('click', () => {
      sel = c.dataset.id!; el.querySelectorAll('.card').forEach((x) => x.classList.toggle('sel', x === c));
    }));
    el.querySelector('.go')!.addEventListener('click', () => {
      try { localStorage.setItem('lumen.hero', sel); } catch { /* storage unavailable: fine */ }
      el.remove(); resolve(sel);
    });
  });
}
