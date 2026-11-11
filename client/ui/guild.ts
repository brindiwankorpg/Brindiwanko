/**
 * @file Party and guild windows.
 *
 * - Party: members with level and HP, the leader's actions (remove, give the
 *   lead, loot rule), invitation by name, leaving.
 * - Guild: without a guild, the creation form with the emblem editor (shape,
 *   pattern, colours, symbol, live preview) and its cost; with a guild, tabs
 *   Members (rank, online, last seen, actions allowed by the player's rank),
 *   Information (emblem, level, message of the day), Bank (items and gold),
 *   Log, Ranks (names and permissions of the lower ranks).
 */
import { emblemDataUrl } from '../../shared/art/emblem.js';
import {
  EMBLEM_COLORS,
  EMBLEM_PATTERNS,
  EMBLEM_SHAPES,
  EMBLEM_SYMBOLS,
  GUILD_NAME,
  GUILD_RANKS,
  GUILD_TAG,
  GuildPermission,
  PERMISSION_KEYS,
  type Emblem,
  type GuildDirectoryPage,
  type GuildView,
  type PartyView,
} from '../../shared/guild.js';
import type { InventoryPayload } from '../../shared/protocol.js';
import { formatServerTime, t, tDynamic } from '../i18n.js';
import { confirmDialog } from './dialog.js';
import { el, icon, rebuildKeepingInput, sent } from './dom.js';
import { GameWindow } from './windows.js';

/** Party window actions. */
export interface PartyHost {
  selfId(): number;
  inviteByName(name: string): void;
  leave(): void;
  kick(id: number): void;
  promote(id: number): void;
  loot(mode: PartyView['loot']): void;
  raid(raid: boolean): void;
}

/** The party window. */
export class PartyWindow extends GameWindow {
  private view: PartyView | null = null;

  constructor(private readonly host: PartyHost) {
    super('party', t('party.title'), { className: 'party-window' });
  }

  set(view: PartyView | null): void {
    this.view = view;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('party.title'));
    this.render();
  }

  private render(): void {
    const input = el('input', { attrs: { type: 'text', name: 'invite', maxlength: '40', placeholder: t('friends.name'), 'aria-label': t('friends.name') } });
    const invite = el('button', { className: 'button small', text: t('party.invite'), attrs: { type: 'button' }, on: { click: () => input.value.trim() && this.host.inviteByName(sent(input).value.trim()) } });
    const v = this.view;
    const self = this.host.selfId();
    const leader = v?.leader === self;
    const rows = (v?.members ?? []).map((m) =>
      el('div', { className: `party-row${m.near ? '' : ' far'}` }, [
        el('span', { className: 'party-name', text: `${m.id === v!.leader ? '♛ ' : ''}${m.name} (${m.online ? t('hud.level', { level: m.level }) : t('friends.offline')})` }),
        el('span', { className: 'party-hp', text: m.online ? `${m.hp}/${m.maxHp}` : '' }),
        leader && m.id !== self ? el('button', { className: 'button small', text: '♛', title: t('party.promote'), attrs: { type: 'button' }, on: { click: () => this.host.promote(m.id) } }) : el('span'),
        leader && m.id !== self ? el('button', { className: 'button small danger', text: '✕', title: t('party.kick'), attrs: { type: 'button' }, on: { click: () => this.host.kick(m.id) } }) : el('span'),
      ]),
    );
    const loot = el('select', { attrs: { 'aria-label': t('party.loot') } }, (['personal', 'shared'] as const).map((l) => el('option', { text: tDynamic(`party.loot_${l}`), attrs: { value: l } })));
    loot.value = v?.loot ?? 'personal';
    if (!leader) loot.disabled = true;
    loot.addEventListener('change', () => this.host.loot(loot.value as PartyView['loot']));
    // Updated live (members' HP...): the name being typed stays.
    rebuildKeepingInput(this.body, () => this.body.replaceChildren(
      el('div', { className: 'friend-add' }, [input, invite]),
      v
        ? el('div', {}, [
            el('div', { className: 'friend-list' }, rows),
            el('label', { className: 'party-loot' }, [el('span', { text: t('party.loot') }), loot]),
            leader
              ? el('button', { className: 'button small', text: v.raid ? t('party.to_party') : t('party.to_raid'), attrs: { type: 'button' }, on: { click: () => this.host.raid(!v.raid) } })
              : v.raid ? el('p', { className: 'hint', text: t('party.is_raid') }) : el('span'),
            el('button', { className: 'button small danger', text: t('party.leave'), attrs: { type: 'button' }, on: { click: () => this.host.leave() } }),
          ])
        : el('p', { className: 'bag-empty', text: t('party.none') }),
    ));
  }
}

/** Guild window actions. */
export interface GuildHost {
  selfId(): number;
  inventory(): InventoryPayload;
  currencyName(): string;
  creationCost(): number;
  create(name: string, tag: string, emblem: Emblem): void;
  inviteByName(name: string): void;
  leave(): void;
  kick(id: number): void;
  setRank(id: number, rank: number): void;
  editRank(rank: number, name: string, permissions: number): void;
  motd(text: string): void;
  bank(kind: 'item' | 'weapon' | 'armor', id: number, quantity: number, deposit: boolean): void;
  gold(amount: number): void;
  /** One page of the directory of guilds (shown to players without a guild). */
  directory(search: string, page: number): Promise<GuildDirectoryPage>;
  /** Opens a private message to a player (the leader of a guild). */
  whisper(name: string): void;
}

type GuildTab = 'members' | 'info' | 'bank' | 'log' | 'ranks';

/** The guild window. */
export class GuildWindow extends GameWindow {
  private view: GuildView | null = null;
  private tab: GuildTab = 'members';
  /** Without a guild: the tab shown, and the search and page of the directory. */
  private noGuildTab: 'find' | 'found' = 'find';
  private dirSearch = '';
  private dirPage = 0;
  private draft: Emblem = { shape: 0, pattern: 1, primary: 4, secondary: 2, symbol: 0, symbolColor: 7 };
  /** Re-evaluates the "found the guild" button (name, tag and gold); set while the creation form is shown. */
  private updateCreate: (() => void) | null = null;

  constructor(private readonly host: GuildHost) {
    super('guild', t('guild.title'), { className: 'guild-window' });
  }

  set(view: GuildView | null): void {
    this.view = view;
    if (this.manager?.isOpen(this)) this.render();
  }

  /** Inventory changed (bank tab). */
  refresh(): void {
    if (!this.view && this.manager?.isOpen(this)) this.updateCreate?.();
    if (this.manager?.isOpen(this) && this.tab === 'bank') this.render();
  }

  override onOpen(): void {
    this.render();
  }

  private can(permission: number): boolean {
    const v = this.view;
    return !!v && (v.myRank === 0 || ((v.ranks[v.myRank]?.permissions ?? 0) & permission) !== 0);
  }

  private render(): void {
    const v = this.view;
    if (!v) {
      this.setTitle(t('guild.title'));
      this.renderCreation();
      return;
    }
    this.setTitle(`${v.name} <${v.tag}>`);
    const tabs: GuildTab[] = ['members', 'info', 'bank', 'log', 'ranks'];
    const bar = el(
      'div',
      { className: 'bag-tabs' },
      tabs.map((tab) =>
        el('button', {
          className: `bag-tab${tab === this.tab ? ' active' : ''}`,
          text: tDynamic(`guild.tab.${tab}`),
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.tab = tab;
              this.render();
            },
          },
        }),
      ),
    );
    const content = this.tab === 'members' ? this.members(v) : this.tab === 'info' ? this.info(v) : this.tab === 'bank' ? this.bank(v) : this.tab === 'log' ? this.log(v) : this.ranks(v);
    // Updated live (members' levels, the bank...): what is being typed stays.
    rebuildKeepingInput(this.body, () => this.body.replaceChildren(bar, content));
  }

  /** Creation form with the emblem editor. */
  private renderCreation(): void {
    // Without a guild: find one (the first tab: joining is what most newcomers want) or found one.
    if (this.noGuildTab === 'find') {
      this.updateCreate = null;
      rebuildKeepingInput(this.body, () => this.body.replaceChildren(this.noGuildTabs(), ...this.directoryView()));
      return;
    }
    const name = el('input', { attrs: { type: 'text', name: 'guild-name', maxlength: '24' } });
    const tag = el('input', { attrs: { type: 'text', name: 'guild-tag', maxlength: '5' } });
    const preview = el('img', { className: 'guild-emblem big', attrs: { alt: '' } });
    const refresh = () => (preview.src = emblemDataUrl(this.draft, 'draft'));
    const picker = (label: string, key: keyof Emblem, options: readonly string[]) => {
      const s = el('select', { attrs: { 'aria-label': label } }, options.map((o, i) => el('option', { text: tDynamic(`guild.emblem.${o}`), attrs: { value: String(i) } })));
      s.value = String(this.draft[key]);
      s.addEventListener('change', () => {
        this.draft = { ...this.draft, [key]: Number(s.value) };
        refresh();
      });
      return el('label', { className: 'form-row' }, [el('span', { text: label }), s]);
    };
    /** Colours are shown as swatches: a number in a list says nothing about the colour. */
    const swatches = (label: string, key: keyof Emblem) => {
      const row = el('div', { className: 'swatch-row', attrs: { role: 'radiogroup', 'aria-label': label } });
      const buttons = EMBLEM_COLORS.map((color, i) => {
        const b = el('button', { className: 'swatch', title: String(i + 1), attrs: { type: 'button', role: 'radio', 'aria-label': `${label} ${i + 1}` } });
        b.style.background = color;
        b.addEventListener('click', () => {
          this.draft = { ...this.draft, [key]: i };
          mark();
          refresh();
        });
        return b;
      });
      const mark = () => buttons.forEach((b, i) => {
        b.classList.toggle('selected', i === this.draft[key]);
        b.setAttribute('aria-checked', String(i === this.draft[key]));
      });
      mark();
      row.append(...buttons);
      return el('div', { className: 'form-row' }, [el('span', { text: label }), row]);
    };
    refresh();
    const cost = this.host.creationCost();
    const hint = el('p', { text: t('guild.cost', { cost, currency: this.host.currencyName() }) });
    const found = el('button', { className: 'button primary', text: t('guild.create'), attrs: { type: 'button' }, on: { click: () => this.host.create(name.value, tag.value, this.draft) } });
    this.updateCreate = () => {
      const affordable = this.host.inventory().gold >= cost;
      hint.className = affordable ? 'hint' : 'hint error';
      found.disabled = !affordable || !GUILD_NAME.test(name.value.trim()) || !GUILD_TAG.test(tag.value.trim());
    };
    name.addEventListener('input', this.updateCreate);
    tag.addEventListener('input', this.updateCreate);
    rebuildKeepingInput(this.body, () => this.body.replaceChildren(
      this.noGuildTabs(),
      el('p', { text: t('guild.none') }),
      el('div', { className: 'guild-create' }, [
        el('div', { className: 'guild-create-fields' }, [
          el('label', { className: 'form-row' }, [el('span', { text: t('guild.name') }), name]),
          el('label', { className: 'form-row' }, [el('span', { text: t('guild.tag') }), tag]),
          picker(t('guild.emblem.shape'), 'shape', EMBLEM_SHAPES),
          picker(t('guild.emblem.pattern'), 'pattern', EMBLEM_PATTERNS),
          swatches(t('guild.emblem.primary'), 'primary'),
          swatches(t('guild.emblem.secondary'), 'secondary'),
          picker(t('guild.emblem.symbol'), 'symbol', EMBLEM_SYMBOLS),
          swatches(t('guild.emblem.symbol_color'), 'symbolColor'),
        ]),
        preview,
      ]),
      hint,
      found,
    ));
    this.updateCreate();
  }

  /** Tabs shown without a guild: find one, or found one. */
  private noGuildTabs(): HTMLElement {
    return el('div', { className: 'bag-tabs', attrs: { role: 'tablist' } }, (['find', 'found'] as const).map((tab) =>
      el('button', {
        className: `bag-tab${tab === this.noGuildTab ? ' active' : ''}`,
        text: t(tab === 'find' ? 'guild.directory' : 'guild.found_title'),
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(tab === this.noGuildTab) },
        on: {
          click: () => {
            this.noGuildTab = tab;
            this.render();
          },
        },
      }),
    ));
  }

  /**
   * Directory of the guilds, one page at a time: the server searches all of them (names and tags, without
   * caring about accents) and sends only the page shown, however many guilds there are.
   */
  private directoryView(): HTMLElement[] {
    const list = el('div', { className: 'guild-directory', attrs: { 'aria-live': 'polite' } }, [el('p', { className: 'hint', text: t('guild.directory_loading') })]);
    const pager = el('div', { className: 'guild-pager' });
    const search = el('input', { className: 'guild-search', attrs: { type: 'search', name: 'guild-search', maxlength: '40', placeholder: t('guild.directory_search'), 'aria-label': t('guild.directory_search') } });
    search.value = this.dirSearch;
    let request = 0;
    let timer = 0;
    const draw = (r: GuildDirectoryPage) => {
      list.replaceChildren(
        ...(r.guilds.length
          ? r.guilds.map((g) =>
              el('div', { className: 'friend-row guild-dir-row' }, [
                el('img', { className: 'guild-emblem', attrs: { alt: '', src: emblemDataUrl(g.emblem, `dir-${g.id}`) } }),
                el('span', { className: 'friend-name', text: `${g.name} <${g.tag}>` }),
                el('span', { className: 'friend-location', text: t('guild.directory_info', { level: g.level, members: g.members }) }),
                g.leader ? el('button', { className: 'button small', text: t('guild.directory_contact'), title: t('guild.directory_contact_help', { name: g.leader }), attrs: { type: 'button' }, on: { click: () => this.host.whisper(g.leader) } }) : el('span'),
              ]),
            )
          : [el('p', { className: 'bag-empty', text: t(this.dirSearch ? 'guild.directory_no_match' : 'guild.directory_empty') })]),
      );
      const last = Math.max(0, Math.ceil(r.total / r.pageSize) - 1);
      const go = (page: number) => {
        this.dirPage = page;
        load();
      };
      pager.replaceChildren(
        ...(r.total > r.pageSize
          ? [
              el('button', { className: 'button small', text: '‹', title: t('guild.directory_previous'), attrs: { type: 'button', 'aria-label': t('guild.directory_previous'), ...(r.page > 0 ? {} : { disabled: '' }) }, on: { click: () => go(r.page - 1) } }),
              el('span', { text: t('guild.directory_range', { from: r.page * r.pageSize + 1, to: Math.min(r.total, (r.page + 1) * r.pageSize), total: r.total }) }),
              el('button', { className: 'button small', text: '›', title: t('guild.directory_next'), attrs: { type: 'button', 'aria-label': t('guild.directory_next'), ...(r.page < last ? {} : { disabled: '' }) }, on: { click: () => go(r.page + 1) } }),
            ]
          : r.total > 0 ? [el('span', { text: t('guild.directory_count', { total: r.total }) })] : []),
      );
    };
    const load = () => {
      const id = ++request;
      void this.host.directory(this.dirSearch, this.dirPage).then((r) => {
        // A newer search, or a window drawn again meanwhile: this answer is not shown.
        if (id !== request || !list.isConnected) return;
        this.dirPage = r.page;
        draw(r);
      });
    };
    // The server is asked once the player stops typing for a moment, not at every letter.
    search.addEventListener('input', () => {
      this.dirSearch = search.value.trim();
      this.dirPage = 0;
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 250);
    });
    window.setTimeout(load, 0);
    return [el('p', { className: 'hint', text: t('guild.directory_help') }), search, list, pager];
  }

  private members(v: GuildView): HTMLElement {
    const input = el('input', { attrs: { type: 'text', name: 'invite', maxlength: '40', placeholder: t('friends.name') } });
    const invite = this.can(GuildPermission.Invite)
      ? el('div', { className: 'friend-add' }, [input, el('button', { className: 'button small', text: t('guild.invite'), attrs: { type: 'button' }, on: { click: () => input.value.trim() && this.host.inviteByName(sent(input).value.trim()) } })])
      : el('span');
    const rows = v.members.map((m) => {
      const below = m.rank > v.myRank;
      const rankSelect = el('select', { attrs: { 'aria-label': t('guild.rank') } }, v.ranks.map((r, i) => el('option', { text: r.name, attrs: { value: String(i) } })));
      rankSelect.value = String(m.rank);
      rankSelect.disabled = !(below && this.can(GuildPermission.Ranks)) && !(v.myRank === 0 && m.id !== this.host.selfId());
      rankSelect.addEventListener('change', () => this.host.setRank(m.id, Number(rankSelect.value)));
      return el('div', { className: `friend-row${m.online ? ' online' : ''}` }, [
        el('span', { className: 'friend-dot' }),
        el('span', { className: 'friend-name', text: `${m.name} (${t('hud.level', { level: m.level })})` }),
        el('span', { className: 'friend-location', text: m.online ? t('friends.online') : m.lastSeen ? t('guild.last_seen', { date: formatServerTime(m.lastSeen, 'date') }) : t('friends.offline') }),
        rankSelect,
        below && this.can(GuildPermission.Kick) ? el('button', { className: 'button small danger', text: '✕', title: t('guild.kick'), attrs: { type: 'button' }, on: { click: async () => (await confirmDialog({ title: t('guild.kick'), message: t('guild.kick_confirm', { name: m.name }), ok: t('guild.kick'), danger: true })) && this.host.kick(m.id) } }) : el('span'),
      ]);
    });
    return el('div', {}, [invite, el('div', { className: 'friend-list' }, rows), el('button', { className: 'button small danger', text: t('guild.leave'), attrs: { type: 'button' }, on: { click: async () => (await confirmDialog({ title: t('guild.leave'), message: t('guild.leave_confirm'), ok: t('guild.leave'), danger: true })) && this.host.leave() } })]);
  }

  private info(v: GuildView): HTMLElement {
    const motd = el('textarea', { attrs: { name: 'motd', rows: '3', maxlength: '300' } });
    motd.value = v.motd;
    motd.readOnly = !this.can(GuildPermission.Motd);
    return el('div', { className: 'guild-info' }, [
      el('img', { className: 'guild-emblem big', attrs: { src: emblemDataUrl(v.emblem, `g${v.id}`), alt: '' } }),
      el('div', {}, [
        el('h3', { text: `${v.name} <${v.tag}>` }),
        el('p', { text: t('guild.level', { level: v.level, xp: v.xp, next: v.xpNext }) }),
        el('p', { text: t('guild.member_count', { count: v.members.length }) }),
        el('h4', { text: t('guild.motd') }),
        motd,
        this.can(GuildPermission.Motd) ? el('button', { className: 'button small', text: t('guild.save_motd'), attrs: { type: 'button' }, on: { click: () => this.host.motd(motd.value) } }) : el('span'),
      ]),
    ]);
  }

  private bank(v: GuildView): HTMLElement {
    const currency = this.host.currencyName();
    const deposit = this.can(GuildPermission.Deposit);
    const withdraw = this.can(GuildPermission.Withdraw);
    const row = (e: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number; name: string; icon: number }, toBank: boolean, allowed: boolean) => {
      const qty = el('input', { className: 'qty-input', attrs: { type: 'number', name: `qty-${toBank ? 'in' : 'out'}-${e.kind}-${e.id}`, min: '1', max: String(e.quantity) } });
      qty.value = '1';
      return el('div', { className: 'bank-row' }, [
        icon(e.icon),
        el('span', { className: 'bank-name', text: `${e.name} ×${e.quantity}` }),
        qty,
        el('button', { className: 'button small', text: toBank ? '→' : '←', attrs: { type: 'button', ...(allowed ? {} : { disabled: '' }) }, on: { click: () => this.host.bank(e.kind, e.id, Math.max(1, Math.trunc(Number(sent(qty).value)) || 1), toBank) } }),
      ]);
    };
    const bag = this.host.inventory().entries.filter((e) => e.kind !== 'item' || e.category === 'regular');
    const amount = el('input', { className: 'qty-input', attrs: { type: 'number', name: 'gold', min: '1' } });
    amount.value = '10';
    const read = () => Math.max(0, Math.trunc(Number(amount.value)) || 0);
    return el('div', {}, [
      el('div', { className: 'bank-layout' }, [
        el('section', { className: 'bank-column' }, [el('h4', { text: t('bank.bag') }), ...bag.map((e) => row(e, true, deposit))]),
        el('section', { className: 'bank-column' }, [el('h4', { text: t('guild.bank_slots', { used: v.bank.items.length, slots: v.bank.slots }) }), ...v.bank.items.map((e) => row(e, false, withdraw))]),
      ]),
      el('div', { className: 'bank-gold' }, [
        el('span', {}, [icon('gold'), el('span', { text: `${t('guild.tab.bank')} : ${v.bank.gold} ${currency}` })]),
        amount,
        el('button', { className: 'button small', text: t('bank.deposit'), attrs: { type: 'button', ...(deposit ? {} : { disabled: '' }) }, on: { click: () => read() && this.host.gold(read()) } }),
        el('button', { className: 'button small', text: t('bank.withdraw'), attrs: { type: 'button', ...(withdraw ? {} : { disabled: '' }) }, on: { click: () => read() && this.host.gold(-read()) } }),
      ]),
    ]);
  }

  private log(v: GuildView): HTMLElement {
    return el(
      'div',
      { className: 'guild-log' },
      v.log.map((l) => el('div', { className: 'guild-log-line' }, [el('span', { className: 'chat-time', text: `${formatServerTime(l.at)} ` }), el('span', { text: tDynamic(`guild.log.${l.action}`, { who: l.who, currency: this.host.currencyName(), ...l.details }) })])),
    );
  }

  private ranks(v: GuildView): HTMLElement {
    const rows: HTMLElement[] = [];
    for (let rank = 0; rank < GUILD_RANKS; rank++) {
      const r = v.ranks[rank]!;
      const editable = rank > v.myRank && this.can(GuildPermission.Ranks);
      const name = el('input', { attrs: { type: 'text', name: `rank-${rank}`, maxlength: '20' } });
      name.value = r.name;
      name.disabled = !editable;
      const boxes = PERMISSION_KEYS.map((key) => {
        const box = el('input', { attrs: { type: 'checkbox' } });
        box.checked = rank === 0 || (r.permissions & GuildPermission[key]) !== 0;
        box.disabled = !editable;
        return { key, box };
      });
      const save = editable
        ? el('button', {
            className: 'button small',
            text: t('common.save'),
            attrs: { type: 'button' },
            on: { click: () => this.host.editRank(rank, name.value, boxes.reduce((s, b) => (b.box.checked ? s | GuildPermission[b.key] : s), 0)) },
          })
        : el('span');
      rows.push(el('div', { className: 'guild-rank-row' }, [name, ...boxes.map((b) => el('label', { className: 'inline-check', title: tDynamic(`guild.perm.${b.key}`) }, [b.box, el('span', { text: tDynamic(`guild.perm.${b.key}`) })])), save]));
    }
    return el('div', { className: 'guild-ranks' }, rows);
  }
}
