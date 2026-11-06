import { ITEMS, ITEM_IDS, MAX_ITEMS, ITEM_SELL_REFUND, type ItemId } from '@lumen/shared';
import { icon } from './icons.js';

/**
 * Quartermaster (items v0). Opens with P anywhere; buying and selling only work inside your fort (or while dead),
 * which the panel states plainly instead of letting the server refuse silently.
 */
export class ShopHud {
  readonly el: HTMLDivElement;
  open = false;
  private grid: HTMLDivElement; private owned: HTMLDivElement; private note: HTMLElement; private goldEl: HTMLElement;
  private sig = '';

  constructor(root: HTMLElement, private cb: { buy(item: ItemId): void; sell(slot: number): void; close(): void }) {
    this.el = document.createElement('div'); this.el.className = 'shop';
    this.el.innerHTML = `<div class="sh-head"><h3>Quartermaster</h3><span class="sh-gold"><span class="coin"></span><b>0</b></span></div>
      <p class="sh-note"></p>
      <div class="sh-grid">${ITEM_IDS.map((id) => {
        const d = ITEMS[id];
        return `<button class="it ${d.tag}" data-id="${id}"><span class="ii">${icon(id, 26)}</span><span class="in"><b>${d.name}</b><small>${d.blurb}</small></span><span class="ic">${d.cost}</span></button>`;
      }).join('')}</div>
      <div class="sh-owned"></div>
      <button class="sclose">Close (P)</button>`;
    root.appendChild(this.el);
    this.grid = this.el.querySelector('.sh-grid')!; this.owned = this.el.querySelector('.sh-owned')!;
    this.note = this.el.querySelector('.sh-note')!; this.goldEl = this.el.querySelector('.sh-gold b')!;
    this.grid.querySelectorAll<HTMLButtonElement>('.it').forEach((b) => b.addEventListener('click', () => cb.buy(b.dataset.id as ItemId)));
    this.owned.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.os'); if (b?.dataset.slot) cb.sell(Number(b.dataset.slot)); });
    this.el.querySelector('.sclose')!.addEventListener('click', () => cb.close());
  }

  setOpen(v: boolean) { this.open = v; this.el.classList.toggle('open', v); this.sig = ''; }

  update(gold: number, items: string[], canShop: boolean) {
    if (!this.open) return;
    const sig = `${gold}|${items.join(',')}|${canShop}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.goldEl.textContent = String(gold);
    this.note.textContent = canShop ? 'Gear is yours until sold. Items compete with bulwarks for the same gold — choose.' : 'You can browse here, but trade only inside your fort (or while you wait to respawn). H: recall.';
    this.note.classList.toggle('warn', !canShop);
    this.grid.querySelectorAll<HTMLButtonElement>('.it').forEach((b) => {
      const id = b.dataset.id as ItemId, owned = items.includes(id);
      b.disabled = !canShop || owned || ITEMS[id].cost > gold || items.length >= MAX_ITEMS;
      b.classList.toggle('owned', owned);
      b.classList.toggle('poor', ITEMS[id].cost > gold);
    });
    this.owned.innerHTML = Array.from({ length: MAX_ITEMS }, (_, i) => {
      const id = items[i] as ItemId | undefined;
      return id ? `<button class="os" data-slot="${i}" ${canShop ? '' : 'disabled'} title="Sell for ${Math.floor(ITEMS[id].cost * ITEM_SELL_REFUND)}">${icon(id, 22)}<small>sell +${Math.floor(ITEMS[id].cost * ITEM_SELL_REFUND)}</small></button>` : '<span class="os empty"></span>';
    }).join('');
  }
}
