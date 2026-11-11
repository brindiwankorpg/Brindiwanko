/**
 * @file Friends window (online status, location, private message, removal,
 * ignored players), trade window (two columns, offer from the bag and gold,
 * lock then confirm on both sides) and the small windows answering a trade
 * request or offering actions on a player clicked in the world, and the
 * window showing an inspected player.
 */
import { drawCharacterFrame } from '../../shared/art/character.js';
import type { FriendsPayload, InspectPayload, TradeView } from '../../shared/social.js';
import type { InventoryPayload } from '../../shared/protocol.js';
import { rasterize } from '../art/render.js';
import { t, tDynamic } from '../i18n.js';
import { el, icon, rebuildKeepingInput, sent } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** Friends window actions. */
export interface FriendsHost {
  whisper(name: string): void;
  addFriend(name: string): void;
  removeFriend(id: number): void;
  unignore(id: number): void;
  /** Players in sight on the map (nobody has to type their exact name to befriend or invite them). */
  nearby(): { id: number; name: string; guild?: string }[];
  inviteParty(id: number): void;
  canInviteParty(id: number): boolean;
}

/** The friends window. */
export class FriendsWindow extends GameWindow {
  private data: FriendsPayload = { friends: [], ignored: [] };

  constructor(private readonly host: FriendsHost) {
    super('friends', t('friends.title'), { className: 'friends-window' });
  }

  set(data: FriendsPayload): void {
    this.data = data;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('friends.title'));
    this.render();
  }

  private render(): void {
    const input = el('input', { attrs: { type: 'text', name: 'friend', maxlength: '40', placeholder: t('friends.name'), 'aria-label': t('friends.name') } });
    const add = el('button', { className: 'button small', text: t('friends.add'), attrs: { type: 'button' }, on: { click: () => input.value.trim() && this.host.addFriend(sent(input).value.trim()) } });
    const friends = [...this.data.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const rows = friends.map((f) =>
      el('div', { className: `friend-row${f.online ? ' online' : ''}` }, [
        el('span', { className: 'friend-dot', title: f.online ? t('friends.online') : t('friends.offline') }),
        el('span', { className: 'friend-name', text: `${f.name} (${t('hud.level', { level: f.level })})` }),
        el('span', { className: 'friend-location', text: f.online ? f.location : t('friends.offline') }),
        f.online ? el('button', { className: 'button small', text: '✉', title: t('chat.menu.whisper'), attrs: { type: 'button' }, on: { click: () => this.host.whisper(f.name) } }) : el('span'),
        el('button', { className: 'button small danger', text: '✕', title: t('friends.remove'), attrs: { type: 'button' }, on: { click: () => this.host.removeFriend(f.id) } }),
      ]),
    );
    const ignored = this.data.ignored.map((i) =>
      el('div', { className: 'friend-row' }, [
        el('span', { className: 'friend-name', text: i.name }),
        el('button', { className: 'button small', text: t('friends.unignore'), attrs: { type: 'button' }, on: { click: () => this.host.unignore(i.id) } }),
      ]),
    );
    // Players in sight, with the usual actions in one click.
    const friendIds = new Set(this.data.friends.map((f) => f.id));
    const ignoredIds = new Set(this.data.ignored.map((i) => i.id));
    const nearby = this.host.nearby().filter((p) => !ignoredIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map((p) =>
      el('div', { className: 'friend-row online' }, [
        el('span', { className: 'friend-dot' }),
        el('span', { className: 'friend-name', text: p.guild ? `${p.name} [${p.guild}]` : p.name }),
        el('button', { className: 'button small', text: '✉', title: t('chat.menu.whisper'), attrs: { type: 'button' }, on: { click: () => this.host.whisper(p.name) } }),
        friendIds.has(p.id) ? el('span', { className: 'friend-location', text: t('friends.already') }) : el('button', { className: 'button small', text: t('friends.add_short'), attrs: { type: 'button' }, on: { click: () => this.host.addFriend(p.name) } }),
        this.host.canInviteParty(p.id) ? el('button', { className: 'button small', text: t('friends.invite_party'), attrs: { type: 'button' }, on: { click: () => this.host.inviteParty(p.id) } }) : el('span'),
      ]),
    );
    // Updated live (friends logging in and out): the name being typed stays.
    rebuildKeepingInput(this.body, () => this.body.replaceChildren(
      el('div', { className: 'friend-add' }, [input, add]),
      el('div', { className: 'friend-list' }, rows.length ? rows : [el('p', { className: 'bag-empty', text: t('friends.none') })]),
      el('h4', { text: t('friends.nearby') }),
      el('div', { className: 'friend-list' }, nearby.length ? nearby : [el('p', { className: 'bag-empty', text: t('friends.nobody_nearby') })]),
      ...(ignored.length ? [el('h4', { text: t('friends.ignored') }), el('div', { className: 'friend-list' }, ignored)] : []),
    ));
  }
}

/** Trade window actions. */
export interface TradeHost {
  inventory(): InventoryPayload;
  currencyName(): string;
  offer(items: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number }[], gold: number): void;
  lock(): void;
  confirm(): void;
  cancel(): void;
}

/** The trade window. */
export class TradeWindow extends GameWindow {
  private view: TradeView | null = null;
  /** Closed by the server: do not send a cancel back. */
  private closing = false;

  constructor(private readonly host: TradeHost) {
    super('trade', t('trade.title'), { className: 'trade-window' });
  }

  /** New state (null: the trade ended). */
  set(view: TradeView | null): void {
    this.view = view;
    if (!view) {
      this.closing = true;
      this.close();
      this.closing = false;
      return;
    }
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.render();
  }

  override onClose(): void {
    if (!this.closing && this.view) this.host.cancel();
  }

  private side(title: string, side: TradeView['mine'], editable: boolean): HTMLElement {
    const currency = this.host.currencyName();
    const status = side.confirmed ? t('trade.confirmed') : side.locked ? t('trade.locked') : t('trade.open');
    const rows = side.items.map((it, i) =>
      el('div', { className: 'trade-row' }, [
        icon(it.icon),
        el('span', { className: 'bank-name', text: `${it.name} ×${it.quantity}` }),
        editable && !side.locked
          ? el('button', { className: 'button small danger', text: '✕', attrs: { type: 'button' }, on: { click: () => this.sendOffer(side.items.filter((_, j) => j !== i), side.gold) } })
          : el('span'),
      ]),
    );
    return el('section', { className: `trade-side${side.locked ? ' locked' : ''}${side.confirmed ? ' confirmed' : ''}` }, [
      el('h4', { text: `${title} — ${status}` }),
      ...(rows.length ? rows : [el('p', { className: 'bag-empty', text: t('trade.nothing') })]),
      el('div', { className: 'trade-gold' }, [icon('gold'), el('span', { text: `${side.gold} ${currency}` })]),
    ]);
  }

  private sendOffer(items: TradeView['mine']['items'], gold: number): void {
    this.host.offer(items.map((i) => ({ kind: i.kind, id: i.id, quantity: i.quantity })), gold);
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    this.setTitle(t('trade.with', { name: v.partner.name }));
    const inventory = this.host.inventory();
    const controls: HTMLElement[] = [];
    if (!v.mine.locked) {
      const tradable = inventory.entries.filter((e) => e.kind !== 'item' || e.category === 'regular');
      const choice = el('select', { attrs: { 'aria-label': t('trade.add'), ...(tradable.length ? {} : { disabled: '' }) } }, tradable.map((e) => el('option', { text: `${e.name} ×${e.quantity}`, attrs: { value: `${e.kind}:${e.id}` } })));
      if (tradable.length === 0) choice.append(el('option', { text: t('trade.bag_empty'), attrs: { value: '' } }));
      const qty = el('input', { className: 'qty-input', attrs: { type: 'number', name: 'qty', min: '1', step: '1' } });
      qty.value = '1';
      const add = el('button', {
        className: 'button small',
        text: t('trade.add'),
        attrs: { type: 'button', ...(tradable.length ? {} : { disabled: '' }) },
        on: {
          click: () => {
            const [kind, id] = choice.value.split(':') as ['item' | 'weapon' | 'armor', string];
            if (!kind) return;
            const quantity = Math.max(1, Math.trunc(Number(sent(qty).value)) || 1);
            const others = v.mine.items.filter((i) => !(i.kind === kind && i.id === Number(id)));
            this.host.offer([...others.map((i) => ({ kind: i.kind, id: i.id, quantity: i.quantity })), { kind, id: Number(id), quantity }], v.mine.gold);
          },
        },
      });
      const gold = el('input', { className: 'qty-input', attrs: { type: 'number', name: 'gold', min: '0', step: '1', 'aria-label': t('trade.gold') } });
      gold.value = String(v.mine.gold);
      const setGold = el('button', { className: 'button small', text: t('trade.set_gold'), attrs: { type: 'button' }, on: { click: () => this.sendOffer(v.mine.items, Math.max(0, Math.trunc(Number(gold.value)) || 0)) } });
      controls.push(el('div', { className: 'trade-controls' }, [choice, qty, add]), el('div', { className: 'trade-controls' }, [gold, setGold]));
    }
    const lock = el('button', { className: 'button', text: t('trade.lock'), attrs: { type: 'button', ...(v.mine.locked ? { disabled: '' } : {}) }, on: { click: () => this.host.lock() } });
    const confirm = el('button', { className: 'button primary', text: t('trade.confirm'), attrs: { type: 'button', ...(v.mine.locked && v.theirs.locked && !v.mine.confirmed ? {} : { disabled: '' }) }, on: { click: () => this.host.confirm() } });
    const cancel = el('button', { className: 'button danger', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: () => this.close() } });
    // Updated live (the partner's offer): the amounts being typed stay.
    rebuildKeepingInput(this.body, () => this.body.replaceChildren(
      el('div', { className: 'trade-layout' }, [this.side(t('trade.you'), v.mine, true), this.side(v.partner.name, v.theirs, false)]),
      ...controls,
      el('p', { className: 'hint', text: t('trade.help') }),
      el('div', { className: 'trade-buttons' }, [lock, confirm, cancel]),
    ));
  }
}

/** A question asked in the choice window. */
interface Question {
  title: string;
  text: string;
  items: ListItem[];
  onDismiss: (() => void) | null;
  /** Time after which the question no longer matters (a loot roll ended): it is dropped from the queue. */
  expiresAt?: number;
}

/** Options of a question. */
export interface AskOptions {
  /** How long the question matters, in ms. */
  ttlMs?: number;
  /**
   * Shown at once, the question being shown going back to the queue (a menu opened by the player);
   * otherwise a question arriving while another one waits for its answer is queued after it.
   */
  now?: boolean;
}

/**
 * Questions with a few answers (trade request, invitations, loot rolls, actions on a player), one at a
 * time: those arriving while one is shown wait for their turn instead of replacing it.
 */
export class ChoiceWindow extends GameWindow {
  private current: Question | null = null;
  private choices: ListItem[] = [];
  private answered = false;
  private readonly queue: Question[] = [];
  /** Question whose answers the body shows. */
  private rendered: Question | null = null;

  constructor(id: string) {
    super(id, '', { className: 'choice-window' });
  }

  /** Sets a question and its answers (then open the window), or queues it behind the one shown. */
  ask(title: string, text: string, items: ListItem[], onDismiss: (() => void) | null = null, options: AskOptions = {}): void {
    const question: Question = { title, text, items, onDismiss, expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined };
    const waiting = this.current && !this.answered && this.manager?.isOpen(this);
    if (waiting && !options.now) {
      this.queue.push(question);
      return;
    }
    if (waiting && this.current) this.queue.unshift(this.current);
    this.show(question);
  }

  private show(q: Question): void {
    this.current = q;
    this.setTitle(q.title);
    this.answered = false;
    this.choices = q.items.map((i) => ({
      ...i,
      onSelect: () => {
        this.answered = true;
        this.close();
        i.onSelect?.();
      },
    }));
  }

  override onClose(): void {
    const q = this.current;
    if (q && !this.answered) q.onDismiss?.();
    this.current = null;
    this.rendered = null;
    // The next question still relevant, if any.
    const now = Date.now();
    let next = this.queue.shift();
    while (next && next.expiresAt !== undefined && next.expiresAt <= now) next = this.queue.shift();
    if (!next) return;
    const question = next;
    // After the current input is handled (the key that closed this window must not answer the next one).
    setTimeout(() => {
      if (this.current) {
        this.queue.unshift(question);
        return;
      }
      this.show(question);
      this.manager?.open(this);
    }, 0);
  }

  override onOpen(): void {
    // Opened again for a question that only joined the queue: the one shown stays as it is (cursor included).
    if (this.current && this.current === this.rendered) return;
    this.rendered = this.current;
    const text = this.current?.text ?? '';
    const list = el('div');
    this.body.replaceChildren(...(text ? [el('p', { text })] : []), list);
    this.setList(this.choices, list);
  }
}

/** Another player's level, class, guild and equipment. */
export class InspectWindow extends GameWindow {
  private data: InspectPayload | null = null;

  constructor() {
    super('inspect', t('inspect.title'), { className: 'inspect-window' });
  }

  /** Shows a player (opening is left to the caller). */
  set(data: InspectPayload): void {
    this.data = data;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const d = this.data;
    this.setTitle(d ? `${t('inspect.title')} — ${d.name}` : t('inspect.title'));
    if (!d) return;
    const sprite = rasterize(drawCharacterFrame(d.appearance, 'down', 1), 3);
    sprite.className = 'inspect-sprite';
    this.body.replaceChildren(
      el('div', { className: 'inspect-head' }, [
        sprite,
        el('div', {}, [
          el('strong', { text: d.name }),
          el('div', { text: t('inspect.level_class', { level: d.level, className: d.className }) }),
          el('div', { className: 'hint', text: d.guildTag ? `<${d.guildTag}>` : t('inspect.no_guild') }),
        ]),
      ]),
      d.equipment.length
        ? el('ul', { className: 'inspect-equipment' }, d.equipment.map((e) => el('li', {}, [icon(e.icon), el('span', { className: 'hint', text: `${tDynamic(`equip.slot.${e.slot}`)} : ` }), el('span', { text: e.name })])))
        : el('p', { className: 'bag-empty', text: t('inspect.no_equipment') }),
    );
  }
}
