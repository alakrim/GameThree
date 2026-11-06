export interface HudStats { fps: number; ms: number; tier: string; mode: string; status: string; rtt: number; tick: number; ents: number; draws: number }

/** DOM HUD (crisp text at any DPR, accessible). Game-state UI moves to a dedicated layer with the core loop. */
export class Hud {
  private stats: HTMLDivElement;
  constructor(root: HTMLElement, actions: { recenter(): void; stop(): void }) {
    const touch = matchMedia('(pointer: coarse)').matches;
    root.innerHTML = `
      <div class="plaque title">PROJECT LUMEN<small>FOUNDATION BUILD · SHOALS OF AUREL</small></div>
      <div class="plaque stats"></div>
      <div class="plaque hint">${touch ? 'Tap to move · drag to pan · pinch to zoom' : 'Right/left-click to move (hold to steer) · wheel zoom · arrows/edge pan · Space recenter · Y lock · S stop'}</div>
      <div class="btns"><button class="medallion" data-a="stop">STOP</button><button class="medallion" data-a="center">CENTER</button></div>`;
    this.stats = root.querySelector('.stats')!;
    root.querySelector('[data-a=stop]')!.addEventListener('click', actions.stop);
    root.querySelector('[data-a=center]')!.addEventListener('click', actions.recenter);
  }
  update(s: HudStats) {
    this.stats.innerHTML = `<b>${s.fps.toFixed(0)}</b> fps · ${s.ms.toFixed(1)} ms<br>${s.mode} · ${s.status}${s.mode === 'ws' ? ` · <b>${s.rtt.toFixed(0)}</b> ms` : ''}<br>tick ${s.tick} · ${s.ents} units · ${s.draws} draws<br>quality <b>${s.tier}</b>`;
  }
}
