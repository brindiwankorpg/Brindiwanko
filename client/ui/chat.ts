/**
 * @file Chat box (bottom left): tabs All / Map / Party / Guild / Private /
 * System, a colour per channel, the input line with commands (`/w name`,
 * `/r`, `/p`, `/g`, `/me`, `/e`, `/friend`, `/ignore`, `/who`, `/help`),
 * name completion with Tab, item links with their details on hover, and a
 * menu on player names (private message, friend, trade, party and guild
 * invitations, inspect, ignore, report).
 *
 * Message times and the opacity of the box are options; the box can be
 * folded down to its input line and its log resized.
 * Enter opens the input, Escape leaves it; while typing, the game ignores the
 * keyboard. On touch screens the box opens over the game with the chat button.
 * Messages are always inserted as text, never as HTML.
 */
import { MAX_CHAT_LENGTH, type ChatChannel, type ChatMessage, type WritableChannel } from '../../shared/social.js';
import { formatClock, t, tDynamic } from '../i18n.js';
import { el, icon, localized } from './dom.js';

type Tab = 'all' | 'map' | 'party' | 'guild' | 'private' | 'system';
const TABS: Tab[] = ['all', 'map', 'party', 'guild', 'private', 'system'];
/** Messages kept in the box. */
const MAX_LINES = 200;

/** Turns strings into text nodes (messages are never parsed as HTML). */
const nodes = (parts: (HTMLElement | string)[]): Node[] => parts.map((p) => (typeof p === 'string' ? document.createTextNode(p) : p));

/** What the chat needs from the game. */
export interface ChatHost {
  send(text: string, channel: WritableChannel): void;
  emote(balloon: number): void;
  /** Suspends the game keyboard while typing. */
  typing(active: boolean): void;
  /** Names to complete (players around, friends...). */
  knownNames(): string[];
  /** Actions of the name menu. */
  addFriend(name: string): void;
  ignore(name: string): void;
  trade(id: number): void;
  inviteParty(id: number): void;
  inviteGuild(id: number): void;
  /** Whether the invitations make sense for this player (already a member / no guild of one's own). */
  canInviteParty(id: number): boolean;
  canInviteGuild(id: number): boolean;
  inspect(id: number): void;
  report(id: number, name: string): void;
  /** Own character id (no menu on one's own name). */
  selfId(): number;
}

/** The chat box. */
export class ChatBox {
  readonly element: HTMLDivElement;
  private tab: Tab = 'all';
  private readonly log = el('div', { className: 'chat-log', attrs: { 'aria-live': 'polite' } });
  private readonly tabsEl = el('div', { className: 'chat-tabs', attrs: { role: 'tablist' } });
  private readonly input: HTMLInputElement;
  private readonly messages: ChatMessage[] = [];
  private readonly unread = new Set<Tab>();
  private menu: HTMLElement | null = null;

  constructor(layer: HTMLElement, private readonly host: ChatHost) {
    this.input = localized(el('input', { className: 'chat-input', attrs: { type: 'text', maxlength: String(MAX_CHAT_LENGTH) } }), { label: 'chat.input', placeholder: 'chat.placeholder' });
    const send = localized(el('button', { className: 'button small', attrs: { type: 'button' }, on: { click: () => this.submit() } }), { text: 'chat.send' });
    const emotes = localized(el('button', { className: 'button small', text: '☺', attrs: { type: 'button' }, on: { click: () => this.toggleEmotes(emotes) } }), { title: 'chat.emotes', label: 'chat.emotes' });
    // Folds the box down to its input line (the log can also be resized by its corner).
    const fold = localized(el('button', { className: 'button small chat-fold', text: '▾', attrs: { type: 'button' }, on: { click: () => this.toggleFolded(fold) } }), { title: 'chat.fold', label: 'chat.fold' });
    // Phones held upright show the chat as a sheet at the bottom: its grip closes it with a swipe down.
    const grip = localized(el('button', { className: 'chat-grip', attrs: { type: 'button' }, on: { click: () => this.close() } }), { title: 'chat.close', label: 'chat.close' });
    this.bindSwipe(grip);
    this.element = el('div', { className: 'chat-box skin-window' }, [grip, this.tabsEl, this.log, el('div', { className: 'chat-line' }, [fold, this.input, emotes, send])]);
    layer.append(this.element);
    this.followKeyboard();
    this.input.addEventListener('focus', () => this.host.typing(true));
    this.input.addEventListener('blur', () => this.host.typing(false));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.complete();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
    this.renderTabs();
  }

  /** Folds or unfolds the box (tabs and messages hidden). */
  private toggleFolded(button: HTMLElement): void {
    const folded = this.element.classList.toggle('folded');
    button.textContent = folded ? '▴' : '▾';
    if (!folded) this.log.scrollTop = this.log.scrollHeight;
  }

  /** Applies the chat options: message times, opacity when not in use. */
  applyOptions(o: { chatTimestamps: boolean; chatOpacity: number }): void {
    this.element.classList.toggle('no-time', !o.chatTimestamps);
    this.element.style.setProperty('--chat-opacity', String(o.chatOpacity));
  }

  /** Adds text at the end of the input and gives it the focus (item link from the bag). */
  insert(text: string): void {
    this.element.classList.add('open');
    const value = this.input.value;
    this.input.value = `${value}${value && !value.endsWith(' ') ? ' ' : ''}${text}`.slice(0, MAX_CHAT_LENGTH);
    this.input.focus();
  }

  /** Gives the focus to the input (Enter key). */
  focus(prefix = ''): void {
    this.element.classList.add('open');
    if (prefix) this.input.value = prefix;
    this.input.focus();
  }

  /** Tells whether the input has the focus. */
  get typing(): boolean {
    return document.activeElement === this.input;
  }

  /** Shows or hides the box (touch screens). */
  toggle(): void {
    this.element.classList.toggle('open');
    if (this.element.classList.contains('open')) this.input.focus();
    else this.input.blur();
  }

  /** Tells whether the box is shown as an open sheet over the game (touch screens). */
  get openOnTouch(): boolean {
    return document.body.classList.contains('touch-mode') && this.element.classList.contains('open');
  }

  /** Hides the box (touch screens) and its keyboard. */
  close(): void {
    this.element.classList.remove('open');
    this.input.blur();
  }

  /** A swipe down on the grip closes the box. */
  private bindSwipe(grip: HTMLElement): void {
    let startY: number | null = null;
    grip.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (startY !== null && e.clientY - startY > 40) {
        startY = null;
        this.close();
      }
    });
    const end = () => (startY = null);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /**
   * Keeps the bottom sheet above the on-screen keyboard: browsers that do not shrink the page for the
   * keyboard (iPhone) only shrink the visual viewport, whose height gives the room the keyboard takes.
   */
  private followKeyboard(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      this.element.style.setProperty('--keyboard-height', `${covered}px`);
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
  }

  /** Re-applies translated labels. */
  refreshLabels(): void {
    this.input.placeholder = t('chat.placeholder');
    this.renderTabs();
    this.renderLog();
  }

  private renderTabs(): void {
    this.tabsEl.replaceChildren(
      ...TABS.map((tab) =>
        el('button', {
          className: `chat-tab chat-${tab}${tab === this.tab ? ' active' : ''}${this.unread.has(tab) ? ' unread' : ''}`,
          text: tDynamic(`chat.tab.${tab}`),
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(tab === this.tab) },
          on: {
            click: () => {
              this.tab = tab;
              this.unread.delete(tab);
              this.renderTabs();
              this.renderLog();
            },
          },
        }),
      ),
    );
  }

  /** Tab of a channel. */
  private static tabOf(channel: ChatChannel): Tab {
    return channel === 'global' ? 'map' : channel;
  }

  private visible(m: ChatMessage): boolean {
    return this.tab === 'all' || ChatBox.tabOf(m.channel) === this.tab;
  }

  /** Adds a message. */
  add(m: ChatMessage): void {
    this.messages.push(m);
    if (this.messages.length > MAX_LINES) this.messages.shift();
    const tab = ChatBox.tabOf(m.channel);
    if (!this.visible(m) && (m.channel === 'private' || m.channel === 'party' || m.channel === 'guild')) {
      this.unread.add(tab);
      this.renderTabs();
    }
    if (!this.visible(m)) return;
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.append(this.line(m));
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  private renderLog(): void {
    this.log.replaceChildren(...this.messages.filter((m) => this.visible(m)).map((m) => this.line(m)));
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** One message line. */
  private line(m: ChatMessage): HTMLElement {
    const time = new Date(m.at);
    const parts: (HTMLElement | string)[] = [el('span', { className: 'chat-time', text: `${formatClock(time)} ` })];
    if (m.channel === 'system') {
      parts.push(tDynamic(m.key ?? '', m.params));
      return el('div', { className: 'chat-msg chat-system' }, nodes(parts));
    }
    if (m.channel !== 'map') parts.push(el('span', { className: 'chat-channel', text: `[${tDynamic(`chat.channel.${m.channel}`)}] ` }));
    if (m.channel === 'private' && m.to && m.from?.id === this.host.selfId()) {
      parts.push(`${t('chat.to')} `, this.name(m.to.name, m.to.id), t('chat.name_separator'));
    } else if (m.from) {
      parts.push(this.name(m.from.name, m.from.id), m.action ? ' ' : t('chat.name_separator'));
    }
    parts.push(...this.withLinks(m));
    return el('div', { className: `chat-msg chat-${m.channel}${m.action ? ' chat-action' : ''}` }, nodes(parts));
  }

  /** Text with its `[item]` links. */
  private withLinks(m: ChatMessage): (HTMLElement | string)[] {
    if (!m.links?.length) return [m.text];
    const out: (HTMLElement | string)[] = [];
    let last = 0;
    for (const match of m.text.matchAll(/\[([^[\]]{1,60})\]/g)) {
      const link = m.links.find((l) => l.name.toLowerCase() === match[1]!.trim().toLowerCase());
      if (!link) continue;
      out.push(m.text.slice(last, match.index));
      out.push(el('span', { className: 'chat-link', title: link.description || link.name }, [icon(link.icon), el('span', { text: `[${link.name}]` })]));
      last = match.index! + match[0].length;
    }
    out.push(m.text.slice(last));
    return out;
  }

  /** A clickable player name (opens the name menu). */
  private name(name: string, id: number): HTMLElement {
    return el('button', { className: 'chat-name', text: name, attrs: { type: 'button' }, on: { click: (e) => this.openMenu(e as MouseEvent, name, id) } });
  }

  /** Menu of a player name. */
  openMenu(e: MouseEvent, name: string, id: number): void {
    this.closeMenu();
    if (id === this.host.selfId()) return;
    const item = (label: string, run: () => void) => el('button', { className: 'chat-menu-item', text: label, attrs: { type: 'button' }, on: { click: () => (this.closeMenu(), run()) } });
    this.menu = el('div', { className: 'chat-menu skin-window' }, [
      el('strong', { text: name }),
      item(t('chat.menu.whisper'), () => this.focus(`/w ${name} `)),
      item(t('chat.menu.friend'), () => this.host.addFriend(name)),
      item(t('chat.menu.trade'), () => this.host.trade(id)),
      ...(this.host.canInviteParty(id) ? [item(t('chat.menu.party'), () => this.host.inviteParty(id))] : []),
      ...(this.host.canInviteGuild(id) ? [item(t('chat.menu.guild'), () => this.host.inviteGuild(id))] : []),
      item(t('chat.menu.inspect'), () => this.host.inspect(id)),
      item(t('chat.menu.ignore'), () => this.host.ignore(name)),
      item(t('chat.menu.report'), () => this.host.report(id, name)),
    ]);
    document.body.append(this.menu);
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 290));
    Object.assign(this.menu.style, { left: `${x}px`, top: `${y}px` });
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  /** Sends the typed line. */
  private submit(): void {
    const text = this.input.value.trim();
    this.input.value = '';
    if (!text) {
      this.input.blur();
      return;
    }
    // The private tab answers the last person who whispered.
    const line = this.tab === 'private' && !text.startsWith('/') ? `/r ${text}` : text;
    const channel: WritableChannel = this.tab === 'party' ? 'party' : this.tab === 'guild' ? 'guild' : 'map';
    this.host.send(line, channel);
  }

  /** Completes the last word with a known player name. */
  private complete(): void {
    const value = this.input.value;
    const start = value.lastIndexOf(' ') + 1;
    const word = value.slice(start).toLowerCase();
    if (!word) return;
    const match = this.host.knownNames().find((n) => n.toLowerCase().startsWith(word));
    if (match) this.input.value = `${value.slice(0, start)}${match} `;
  }

  /** Small picker of emotion balloons. */
  private toggleEmotes(anchor: HTMLElement): void {
    const existing = this.element.querySelector('.emote-picker');
    if (existing) {
      existing.remove();
      return;
    }
    const picker = el(
      'div',
      { className: 'emote-picker skin-window' },
      Array.from({ length: 10 }, (_, i) =>
        el('button', {
          className: 'button small',
          text: tDynamic(`ev.balloon.${i + 1}`),
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.host.emote(i + 1);
              picker.remove();
            },
          },
        }),
      ),
    );
    anchor.parentElement?.append(picker);
  }
}
