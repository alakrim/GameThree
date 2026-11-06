import { BULWARKS, BULWARK_TYPES, SENDS, type BulwarkType, type SendType } from '@lumen/shared';

/**
 * Tower-defence HUD layer ("Bulwarks"): treasury, wave clock, Heartstones, build bar, war table, tooltips, toasts.
 * Kept separate from the combat HUD so either can evolve independently.
 */
export class TdHud {
  private gold: HTMLElement; private income: HTMLElement; private wave: HTMLElement; private waveT: HTMLElement;
  private hearts: [HTMLElement, HTMLElement]; private heartsLbl: [HTMLElement, HTMLElement];
  private bar: HTMLDivElement; private slots: HTMLDivElement[] = [];
  private table: HTMLDivElement;
  private tip: HTMLDivElement;
  private toasts: HTMLDivElement;
  private banner: HTMLDivElement;
  buildOpen = false; tableOpen = false; selected: BulwarkType = 'arrow';

  constructor(root: HTMLElement, touch: boolean, private cb: { build(type: BulwarkType): void; closeBuild(): void; send(unit: SendType, lane: string): void; toggleTable(open: boolean): void; place(): void; toggleBuild(): void }) {
    const el = document.createElement('div'); el.className = 'td';
    el.innerHTML = `
      <div class="treasury"><span class="coin"></span><b class="g">0</b><small>+<span class="inc">40</span>/wave</small></div>
      <div class="waveclock"><span class="w">Wave 0</span><span class="t">0s</span></div>
      <div class="hearts">
        <div class="hrow"><span class="hl">Your Heartstone</span><div class="hbar ally"><i></i></div></div>
        <div class="hrow"><span class="hl">Enemy Heartstone</span><div class="hbar foe"><i></i></div></div>
      </div>
      <div class="buildbar">${BULWARK_TYPES.map((t, i) => `<button class="bslot" data-t="${t}"><span class="k">${i + 1}</span><span class="n">${BULWARKS[t].name}</span><span class="c">${BULWARKS[t].levels[0].cost}</span></button>`).join('')}
        <div class="bhelp">${touch ? 'Aim with the reticle · PLACE to build' : 'LMB place · RMB / B cancel · look at a structure: U upgrade, X sell'}</div></div>
      <div class="wartable"><h3>War Table</h3><p>Send units into the enemy's next wave. Each send raises your income.</p>
        ${(Object.keys(SENDS) as SendType[]).map((u) => `<div class="srow"><div class="sinfo"><b>${SENDS[u].name}</b><small>${SENDS[u].cost} gold · +${SENDS[u].income} income</small></div>${['top', 'mid', 'bot'].map((l) => `<button class="sbtn" data-u="${u}" data-l="${l}">${l}</button>`).join('')}</div>`).join('')}
        <button class="sclose">Close (G)</button></div>
      <div class="tip"></div>
      <div class="toasts"></div>
      <div class="banner"></div>
      <div class="tdbtns"><button class="tdb tb-build">BUILD</button><button class="tdb tb-send">SEND</button><button class="tdb tb-place">PLACE</button></div>`;
    root.appendChild(el);
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
    this.gold = q('.g'); this.income = q('.inc'); this.wave = q('.w'); this.waveT = q('.t');
    this.hearts = [q('.hbar.ally > i'), q('.hbar.foe > i')];
    this.heartsLbl = [q('.hrow:nth-child(1) .hl'), q('.hrow:nth-child(2) .hl')];
    this.bar = q('.buildbar'); this.table = q('.wartable'); this.tip = q('.tip'); this.toasts = q('.toasts'); this.banner = q('.banner');
    this.slots = [...el.querySelectorAll<HTMLDivElement>('.bslot')];
    this.slots.forEach((b) => b.addEventListener('click', () => cb.build(b.dataset.t as BulwarkType)));
    el.querySelectorAll<HTMLButtonElement>('.sbtn').forEach((b) => b.addEventListener('click', () => cb.send(b.dataset.u as SendType, b.dataset.l!)));
    q('.sclose').addEventListener('click', () => cb.toggleTable(false));
    q('.tb-build').addEventListener('click', () => cb.toggleBuild());
    q('.tb-send').addEventListener('click', () => cb.toggleTable(!this.tableOpen));
    q('.tb-place').addEventListener('pointerdown', (e) => { e.stopPropagation(); cb.place(); });
    void this.heartsLbl;
  }

  setBuild(open: boolean, selected: BulwarkType) {
    this.buildOpen = open; this.selected = selected;
    this.bar.classList.toggle('open', open);
    document.body.classList.toggle('building', open);
    for (const s of this.slots) s.classList.toggle('sel', s.dataset.t === selected);
  }
  setTable(open: boolean) { this.tableOpen = open; this.table.classList.toggle('open', open); }

  update(gold: number, income: number, wave: number, nextWave: number, hearts: [number, number]) {
    this.gold.textContent = String(gold); this.income.textContent = String(income);
    this.wave.textContent = `Wave ${wave}`; this.waveT.textContent = `next in ${nextWave}s`;
    hearts.forEach((f, i) => { this.hearts[i as 0 | 1].style.width = `${Math.max(0, Math.min(1, f)) * 100}%`; });
    for (const s of this.slots) s.classList.toggle('poor', BULWARKS[s.dataset.t as BulwarkType].levels[0].cost > gold);
    this.table.querySelectorAll<HTMLButtonElement>('.sbtn').forEach((b) => { b.disabled = SENDS[b.dataset.u as SendType].cost > gold; });
  }

  tooltip(text: string | null) { this.tip.style.opacity = text ? '1' : '0'; if (text) this.tip.innerHTML = text; }

  toast(text: string, cls: '' | 'bad' | 'good' | 'gold' = '') {
    const t = document.createElement('div'); t.className = `toast ${cls}`; t.textContent = text;
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastChild!.remove();
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2600);
  }

  showBanner(title: string, sub = '') {
    this.banner.innerHTML = `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`;
    this.banner.classList.remove('show'); void this.banner.offsetWidth; this.banner.classList.add('show');
  }
}
