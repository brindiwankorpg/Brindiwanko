/**
 * @file Administration panel: dashboard (players online, server load,
 * active maps and instances, refreshed every 5 seconds), accounts (search,
 * roles, bans, mutes, kick, password reset, characters and their logs,
 * trades included), game tools (teleport, invisibility, give items and gold,
 * switches and variables, announcement), logs and database backups.
 *
 * Every action calls `/api/admin`, which checks the role again; buttons
 * reserved to administrators are only shown to them.
 */
import { formatHour, formatServerTime, t, tDynamic } from '../i18n.js';
import { hasRole, isRole } from '../../shared/roles.js';
import { BACKUP_KEEP_CHOICES } from '../../shared/settings.js';
import { el } from '../ui/dom.js';

const root = document.getElementById('admin-root')!;
const csrf = root.dataset.csrf ?? '';
const isAdmin = root.dataset.role === 'admin';
const myRole = isRole(root.dataset.role) ? root.dataset.role : 'player';
const myId = Number(root.dataset.account);

type Json = Record<string, unknown>;

/** Calls the API; throws with a translated message on error. */
async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(tDynamic(String(data.error ?? 'error.http.server'), data.params as Record<string, string>));
  return data as T;
}

/**
 * Result of an action: a message floating at the bottom of the screen (over the content, never pushing
 * it). A success goes away by itself after a few seconds; an error, or a message to keep (`persist`),
 * stays until it is closed.
 */
const status = el('div', { className: 'admin-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
let toastTimer: number | undefined;
function say(message: string, error = false, persist = error): void {
  window.clearTimeout(toastTimer);
  status.classList.toggle('error', error);
  status.classList.toggle('shown', message !== '');
  if (!message) {
    status.replaceChildren();
    return;
  }
  status.replaceChildren(
    el('span', { className: 'admin-toast-text', text: message }),
    el('button', { className: 'admin-toast-close', text: '✕', attrs: { type: 'button', 'aria-label': t('admin_panel.close_message') }, on: { click: () => say('') } }),
  );
  if (!persist) toastTimer = window.setTimeout(() => say(''), 4500);
}
/** Runs an action and reports its result (`done`: what happened, in words). */
async function act(run: () => Promise<unknown>, done: string | (() => string) = t('admin_panel.done')): Promise<boolean> {
  try {
    await run();
    say(typeof done === 'function' ? done() : done);
    return true;
  } catch (err) {
    say((err as Error).message, true);
    return false;
  }
}

const button = (label: string, onClick: () => void, className = 'button small') => el('button', { className, text: label, attrs: { type: 'button' }, on: { click: onClick } });
const input = (placeholder: string, type = 'text', value = '') => {
  const i = el('input', { attrs: { type, placeholder, 'aria-label': placeholder } });
  i.value = value;
  return i;
};
const num = (i: { value: string }) => Math.trunc(Number(i.value));
/** A control with its label shown above it (the placeholder of an input disappears once it is filled in). */
const field = (label: string, control: HTMLElement) => {
  // The label is in sight: a placeholder that only repeats it (and gets cut in a narrow field) is dropped.
  if (control instanceof HTMLInputElement && control.placeholder === label) control.placeholder = '';
  return el('label', { className: 'admin-field' }, [el('span', { text: label }), control]);
};
/**
 * Several controls under one title (buttons and a field...): a group, not a `<label>`, which would give its
 * text to the first button only, and press that button when the title is clicked.
 */
const group = (label: string, control: HTMLElement) => el('div', { className: 'admin-field', attrs: { role: 'group', 'aria-label': label } }, [el('span', { text: label, attrs: { 'aria-hidden': 'true' } }), control]);
/** Raw values of the logs (event, action, kind) in the viewer's language; anything unknown is shown as is. */
const valueLabel = (value: string): string => {
  const key = `admin_panel.log_value.${value}`;
  const text = tDynamic(key);
  return text === key ? value : text;
};
const TRANSLATED_COLUMNS = new Set(['event', 'action', 'kind']);

/** Text of one table cell: dates in the viewer's time zone, booleans as yes / no, log values translated. */
function cellText(column: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return t(value ? 'admin_panel.yes' : 'admin_panel.no');
  return TRANSLATED_COLUMNS.has(column) ? valueLabel(String(value)) : formatServerTime(String(value), 'full');
}

/** Columns the server sends for the panel's use, not to show (the account of an administration target). */
const HIDDEN_COLUMNS = new Set(['targetAccount']);

/** A number with its sign: "+3", "−3" (a real minus sign). */
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/**
 * Details of an administration line in words ("Interrupteur #1 (Coffret de Lina retrouvé) → ON"), from the
 * object the server sends with the names of the numbers it holds. Unknown details: "key : value" pairs.
 */
function detailsText(action: string, value: unknown): string {
  if (!value || typeof value !== 'object') return value === null || value === undefined ? '' : String(value);
  const d = value as Record<string, unknown>;
  const named = (id: unknown, name: unknown) => `#${String(id)}${name ? ` (${String(name)})` : ''}`;
  const until = (date: unknown) =>
    date === '9999-12-31 23:59:59' ? t('admin_panel.detail.permanent') : t('admin_panel.detail.until', { date: formatServerTime(String(date)) });
  const parts: string[] = [];
  switch (action) {
    case 'role':
      parts.push(t('admin_panel.detail.role', { role: tDynamic(`auth.role.${String(d.role)}`) }));
      break;
    case 'teleport':
      parts.push(t('admin_panel.detail.teleport', { map: String(d.mapName ?? `#${String(d.mapId)}`), x: String(d.x), y: String(d.y) }));
      break;
    case 'invisible':
      parts.push(t(d.on ? 'admin_panel.detail.invisible_on' : 'admin_panel.detail.invisible_off'));
      break;
    case 'give':
      if (typeof d.quantity === 'number' && d.quantity !== 0) parts.push(`${signed(d.quantity)} × ${String(d.itemName ?? d.id)}`);
      if (typeof d.gold === 'number' && d.gold !== 0) parts.push(`${signed(d.gold)} ${t('admin_panel.detail.gold')}`);
      if (typeof d.exp === 'number' && d.exp !== 0) parts.push(`${signed(d.exp)} ${t('admin_panel.detail.exp')}`);
      break;
    case 'progress':
      if (typeof d.switchId === 'number') parts.push(t('admin_panel.detail.switch', { switch: named(d.switchId, d.switchName), value: d.switchValue ? 'ON' : 'OFF' }));
      if (typeof d.variableId === 'number') parts.push(t('admin_panel.detail.variable', { variable: named(d.variableId, d.variableName), value: String(d.variableValue) }));
      break;
    case 'announce':
      parts.push(t('admin_panel.detail.announce', { text: String(d.text ?? '') }));
      break;
    case 'ban':
    case 'mute':
      parts.push(until(d.until));
      if (d.reason) parts.push(t('admin_panel.detail.reason', { reason: String(d.reason) }));
      break;
    case 'kick':
      if (d.reason) parts.push(t('admin_panel.detail.reason', { reason: String(d.reason) }));
      break;
    case 'backup_schedule':
      parts.push(t('admin_panel.detail.schedule', { hour: formatHour(Number(d.hour)), keep: String(d.keep) }));
      break;
    case 'test_enemy':
      parts.push(t('admin_panel.detail.test_enemy', { enemy: named(d.enemyId, d.enemyName), map: String(d.mapName ?? `#${String(d.mapId)}`) }));
      break;
    default:
      for (const [key, v] of Object.entries(d)) if (v !== null && v !== undefined && v !== '') parts.push(`${key} : ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(' · ');
}

/** Text of one cell of a line (CSV export too): the details of an administration line in words. */
function lineText(column: string, line: Json): string {
  if (column === 'details') return detailsText(String(line.action ?? ''), line.details);
  // "server", "editor": the targets that are not an account.
  if (column === 'target' && line.targetAccount === undefined && line.admin !== undefined) return valueLabel(String(line.target ?? ''));
  return cellText(column, line[column]);
}

/** One cell; it carries the name of its column, shown before the value when the table is laid out as cards (phones). */
function cell(column: string, line: Json): HTMLElement {
  const label = tDynamic(`admin_panel.col.${column}`);
  const text = lineText(column, line);
  // The account or character targeted by an administration line: its name opens the account.
  if (column === 'target' && typeof line.targetAccount === 'number') {
    const id = line.targetAccount;
    return el('td', { className: `col-${column}`, attrs: { 'data-label': label } }, [
      el('button', { className: 'link-button', text, attrs: { type: 'button', title: t('admin_panel.open_target', { name: text }) }, on: { click: () => show('accounts', id) } }),
    ]);
  }
  return el('td', { className: `col-${column}`, text, attrs: { 'data-label': label } });
}

/**
 * A table of lines. On a phone (CSS) each line becomes a card: the first column as its title, the others
 * as "Column: value" lines.
 */
function table(rows: Json[], columns?: string[]): HTMLElement {
  if (rows.length === 0) return el('p', { className: 'hint', text: t('admin_panel.empty') });
  const cols = (columns ?? Object.keys(rows[0]!)).filter((c) => !HIDDEN_COLUMNS.has(c));
  return el('div', { className: 'admin-table-wrap' }, [
    el('table', { className: 'admin-table' }, [
      el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { text: tDynamic(`admin_panel.col.${c}`), attrs: { scope: 'col' } })))]),
      el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => cell(c, r))))),
    ]),
  ]);
}

/** A section that folds (its title is the button), open or not at first. */
function section(title: string, children: (HTMLElement | null)[], open = false, extra: Record<string, string> = {}): HTMLDetailsElement {
  return el('details', { className: 'admin-section', attrs: { ...extra, ...(open ? { open: '' } : {}) } }, [
    el('summary', { text: title }),
    el('div', { className: 'admin-section-body' }, children),
  ]);
}

/** Phone-sized screen (the bar of tabs at the bottom, sections folded). */
const narrow = () => matchMedia('(max-width: 799px)').matches;

// --- Tabs ------------------------------------------------------------------------

type Tab = 'dashboard' | 'accounts' | 'tools' | 'logs' | 'backup';
const tabs: Tab[] = isAdmin ? ['dashboard', 'accounts', 'tools', 'logs', 'backup'] : ['dashboard', 'accounts', 'logs'];
const content = el('section', { className: 'window admin-content' });
let current: Tab = 'dashboard';
let refresh: number | undefined;
const nav = el('nav', { className: 'admin-tabs', attrs: { 'aria-label': t('admin_panel.title') } });
const TAB_ICONS: Record<Tab, string> = { dashboard: '📊', accounts: '👥', tools: '🛠', logs: '📜', backup: '💾' };

/**
 * Shows a tab.
 * @param accountId - Accounts tab: account whose sheet opens at once (from the dashboard).
 */
function show(tab: Tab, accountId?: number): void {
  current = tab;
  window.clearInterval(refresh);
  // Icon, full name (wide screens) and short name (the bar at the bottom of a phone).
  nav.replaceChildren(
    ...tabs.map((x) =>
      el('button', {
        className: 'admin-tab',
        attrs: { type: 'button', ...(x === current ? { 'aria-current': 'page' } : {}) },
        on: { click: () => show(x) },
      }, [
        el('span', { className: 'tab-icon', text: TAB_ICONS[x], attrs: { 'aria-hidden': 'true' } }),
        el('span', { className: 'tab-label', text: tDynamic(`admin_panel.tab.${x}`) }),
        el('span', { className: 'tab-short', text: tDynamic(`admin_panel.tab_short.${x}`), attrs: { 'aria-hidden': 'true' } }),
      ]),
    ),
  );
  window.scrollTo(0, 0);
  say('');
  if (tab === 'dashboard') {
    void dashboard();
    refresh = window.setInterval(() => void dashboard(), 5000);
  } else if (tab === 'accounts') accounts(accountId);
  else if (tab === 'tools') void tools();
  else if (tab === 'logs') logs();
  else backup();
}

// --- Dashboard ---------------------------------------------------------------------

/** Parts of the dashboard kept between two refreshes, with what they last showed. */
let dashView: { cards: HTMLElement; players: HTMLElement; maps: HTMLElement; instances: HTMLElement; shown: { players: string; maps: string; instances: string } } | null = null;
/** A finger or the mouse is pressed on the page: the refresh waits (a button must not change under it). */
let pressing = false;
document.addEventListener('pointerdown', () => (pressing = true), true);
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => (pressing = false), true);

/**
 * Players of the dashboard updated in place: the same players in the same order keep their rows and buttons,
 * only the texts that changed (map, position…) are rewritten. Tells whether it could.
 */
function updatePlayers(host: HTMLElement, players: Json[], mapNames: Map<number, string>): boolean {
  const rows = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr[data-id]')];
  if (rows.length !== players.length || rows.some((r, i) => r.dataset.id !== String(players[i]!.id))) return false;
  players.forEach((p, i) => {
    const line: Json = { ...p, mapId: mapNames.get(Number(p.mapId)) ?? p.mapId };
    for (const td of rows[i]!.querySelectorAll<HTMLElement>('td[class^="col-"]')) {
      const text = cellText(td.className.slice(4), line[td.className.slice(4)]);
      if (td.textContent !== text) td.textContent = text;
    }
  });
  return true;
}

async function dashboard(): Promise<void> {
  try {
    const d = await api<{ players: Json[]; maps: Json[]; instances: Json[]; server: Json }>('GET', '/dashboard');
    // A late answer must not overwrite the tab the administrator has moved to meanwhile.
    if (current !== 'dashboard') return;
    const s = d.server;
    const mapNames = new Map(d.maps.map((m) => [Number(m.mapId), String(m.name)]));
    const mb = (b: unknown) => t('admin_panel.megabytes', { value: Math.round(Number(b) / 1048576) });
    const rssMb = Number(s.rss) / 1048576;
    const cards = [
      card(t('admin_panel.online'), String(d.players.length)),
      card(t('admin_panel.accounts'), String(s.accounts)),
      // Green, orange or red: whether the server is at ease, busy or struggling.
      card(t('admin_panel.cpu'), `${s.cpu} %`, level(Number(s.cpu), 50, 80)),
      card(t('admin_panel.memory'), mb(s.rss), level(rssMb, 512, 1024)),
      card(t('admin_panel.lag'), `${s.lag} ms`, level(Number(s.lag), 40, 100)),
      card(t('admin_panel.uptime'), `${Math.floor(Number(s.uptime) / 3600)} h ${Math.floor((Number(s.uptime) % 3600) / 60)} min`),
    ];
    const shown = { players: JSON.stringify(d.players.map((p) => p.id)), maps: JSON.stringify(d.maps), instances: JSON.stringify(d.instances) };
    const view = dashView;
    if (view && content.contains(view.cards)) {
      // Pressed: this refresh is skipped, the next one comes in 5 seconds.
      if (pressing) return;
      view.cards.replaceChildren(...cards);
      if (shown.players !== view.shown.players || !updatePlayers(view.players, d.players, mapNames)) view.players.replaceChildren(playersTable(d.players, mapNames));
      if (shown.maps !== view.shown.maps) view.maps.replaceChildren(table(d.maps));
      if (shown.instances !== view.shown.instances) view.instances.replaceChildren(table(d.instances));
      view.shown = shown;
      return;
    }
    dashView = { cards: el('div', { className: 'admin-cards' }, cards), players: el('div', {}, [playersTable(d.players, mapNames)]), maps: el('div', {}, [table(d.maps)]), instances: el('div', {}, [table(d.instances)]), shown };
    content.replaceChildren(
      el('h2', { text: t('admin_panel.tab.dashboard') }),
      dashView.cards,
      el('p', { className: 'hint', text: t('admin_panel.health_help') }),
      el('h3', { text: t('admin_panel.players') }),
      dashView.players,
      el('h3', { text: t('admin_panel.maps') }),
      dashView.maps,
      el('h3', { text: t('admin_panel.instances') }),
      dashView.instances,
    );
  } catch (err) {
    say((err as Error).message, true);
  }
}

/** Health level of a measure: `ok` under `warn`, `warn` under `bad`, `bad` above. */
function level(value: number, warn: number, bad: number): 'ok' | 'warn' | 'bad' {
  return value >= bad ? 'bad' : value >= warn ? 'warn' : 'ok';
}

function card(label: string, value: string, health?: 'ok' | 'warn' | 'bad'): HTMLElement {
  return el('div', { className: `admin-card${health ? ` health-${health}` : ''}` }, [el('span', { text: label }), el('strong', { text: value })]);
}

/** Players online, each with the actions of the staff: open the account, go to the player, bring it here. */
function playersTable(players: Json[], mapNames: Map<number, string>): HTMLElement {
  if (players.length === 0) return el('p', { className: 'hint', text: t('admin_panel.empty') });
  const cols = ['name', 'level', 'mapId', 'instance', 'x', 'y', 'invisible'];
  return el('div', { className: 'admin-table-wrap' }, [
    el('table', { className: 'admin-table admin-players' }, [
      el('thead', {}, [el('tr', {}, [...cols.map((c) => el('th', { text: tDynamic(`admin_panel.col.${c}`), attrs: { scope: 'col' } })), el('th', { text: t('admin_panel.col.actions'), attrs: { scope: 'col' } })])]),
      el('tbody', {}, players.map((p) => {
        const row: Json = { ...p, mapId: mapNames.get(Number(p.mapId)) ?? p.mapId };
        const actions = [button(t('admin_panel.open_account'), () => show('accounts', Number(p.accountId)))];
        if (isAdmin) {
          actions.push(
            button(t('admin_panel.go_to_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: Number(p.id) }), t('admin_panel.done_go_to', { player: String(p.name) }))),
            button(t('admin_panel.summon_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: Number(p.id), toCharacterId: 'self' }), t('admin_panel.done_summon', { player: String(p.name) }))),
          );
        }
        return el('tr', { attrs: { 'data-id': String(p.id) } }, [...cols.map((c) => cell(c, row)), el('td', { className: 'admin-actions' }, actions)]);
      })),
    ]),
  ]);
}

// --- Accounts ----------------------------------------------------------------------

/**
 * Accounts: a list, and the sheet of the account chosen. On a phone the sheet replaces the list (with a
 * "← Accounts" button), like the screens of a mobile app; from 800 px wide they stand side by side.
 */
function accounts(openId?: number): void {
  const query = input(t('admin_panel.search'));
  query.type = 'search';
  const results = el('div', { className: 'admin-account-list' });
  const detail = el('div', { className: 'admin-detail' }, [el('p', { className: 'hint admin-detail-empty', text: t('admin_panel.no_account_open') })]);
  const layout = el('div', { className: 'admin-accounts' });
  let opened: number | null = null;
  const search = async () => {
    try {
      const { accounts: list } = await api<{ accounts: Json[] }>('GET', `/accounts?q=${encodeURIComponent(query.value)}`);
      results.replaceChildren(
        ...(list.length === 0 ? [el('p', { className: 'hint', text: t('admin_panel.empty') })] : []),
        ...list.map((a) =>
          // A card per account: name, role and the sanctions in force on the first line, the e-mail under it.
          el('button', {
            className: `admin-account${Number(a.id) === opened ? ' current' : ''}`,
            attrs: { type: 'button', ...(Number(a.id) === opened ? { 'aria-current': 'true' } : {}) },
            on: { click: () => openSheet(Number(a.id)) },
          }, [
            el('span', { className: 'admin-account-top' }, [
              el('strong', { className: 'admin-account-name', text: String(a.username) }),
              a.role === 'player' ? null : el('span', { className: `role-badge role-${String(a.role)}`, text: tDynamic(`auth.role.${String(a.role)}`) }),
              a.bannedUntil ? el('span', { className: 'admin-chip chip-banned', text: t('admin_panel.chip_banned') }) : null,
              a.mutedUntil ? el('span', { className: 'admin-chip chip-muted', text: t('admin_panel.chip_muted') }) : null,
            ]),
            el('span', { className: 'admin-account-mail', text: String(a.email ?? '') }),
          ]),
        ),
      );
    } catch (err) {
      say((err as Error).message, true);
    }
  };
  /** Back to the list (phones). */
  const closeSheet = () => {
    opened = null;
    layout.classList.remove('has-detail');
    detail.replaceChildren(el('p', { className: 'hint admin-detail-empty', text: t('admin_panel.no_account_open') }));
    void search();
    window.scrollTo(0, 0);
  };
  const openSheet = (id: number) => {
    opened = id;
    layout.classList.add('has-detail');
    window.scrollTo(0, 0);
    // The list marks the account open and shows the sanctions just given (refreshed after each action).
    void open(id, detail, () => void search(), closeSheet)
      .then(() => void search())
      .catch((err: Error) => say(err.message, true));
  };
  query.addEventListener('keydown', (e) => e.key === 'Enter' && void search());
  layout.replaceChildren(
    el('div', { className: 'admin-accounts-list' }, [el('div', { className: 'admin-row' }, [query, button(t('admin_panel.search_button'), () => void search())]), results]),
    detail,
  );
  content.replaceChildren(el('h2', { className: 'admin-accounts-title', text: t('admin_panel.tab.accounts') }), layout);
  if (openId) openSheet(openId);
  else void search();
}

/** Durations offered for a ban or a mute, in minutes (`permanent`: bans of administrators only). */
const DURATIONS: { minutes: number | 'permanent'; key: string }[] = [
  { minutes: 15, key: 'm15' },
  { minutes: 60, key: 'h1' },
  { minutes: 24 * 60, key: 'h24' },
  { minutes: 3 * 24 * 60, key: 'd3' },
  { minutes: 7 * 24 * 60, key: 'd7' },
  { minutes: 30 * 24 * 60, key: 'd30' },
  { minutes: 'permanent', key: 'permanent' },
];
/** Longest ban of a moderator (the server refuses longer ones): a week. */
const MODERATOR_MAX_MINUTES = 7 * 24 * 60;
/** Reasons offered in one click (the text can still be changed). */
const QUICK_REASONS = ['insults', 'cheat', 'spam', 'harassment'] as const;

/**
 * Duration and reason of a sanction: buttons for the usual durations and reasons, a field for any other
 * number of minutes, and a confirmation that says in words what is about to happen.
 */
function sanctionForm(id: number, name: string, online: boolean, reload: () => void): HTMLElement {
  let chosen: number | 'permanent' = 24 * 60;
  const custom = input(t('admin_panel.minutes'), 'number', '');
  custom.min = '1';
  const durationRow = el('div', { className: 'admin-pills', attrs: { role: 'radiogroup', 'aria-label': t('admin_panel.duration') } });
  const offered = DURATIONS.filter((d) => isAdmin || (d.minutes !== 'permanent' && d.minutes <= MODERATOR_MAX_MINUTES));
  const drawDurations = () =>
    durationRow.replaceChildren(
      ...offered.map((d) =>
        el('button', {
          className: `admin-pill${chosen === d.minutes && !custom.value ? ' selected' : ''}`,
          text: tDynamic(`admin_panel.duration_${d.key}`),
          attrs: { type: 'button', role: 'radio', 'aria-checked': String(chosen === d.minutes && !custom.value) },
          on: {
            click: () => {
              chosen = d.minutes;
              custom.value = '';
              drawDurations();
            },
          },
        }),
      ),
    );
  custom.addEventListener('input', drawDurations);
  drawDurations();
  const reason = input(t('admin_panel.reason'));
  const reasons = el('div', { className: 'admin-pills' }, QUICK_REASONS.map((r) => el('button', { className: 'admin-pill', text: tDynamic(`admin_panel.reason_${r}`), attrs: { type: 'button' }, on: { click: () => (reason.value = tDynamic(`admin_panel.reason_${r}`)) } })));
  /** Minutes chosen (a typed number wins over the buttons), or `null` when the typed number is not valid. */
  const minutes = (): number | 'permanent' | null => {
    if (!custom.value) return chosen;
    const n = num(custom);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  /** The duration in words: "24 heures", "90 minutes", "définitivement". */
  const inWords = (m: number | 'permanent'): string => {
    if (m === 'permanent') return t('admin_panel.duration_words_permanent');
    const preset = DURATIONS.find((d) => d.minutes === m);
    return preset ? tDynamic(`admin_panel.duration_${preset.key}`) : t('admin_panel.duration_words_minutes', { count: m });
  };
  const sanction = (kind: 'ban' | 'mute') => {
    const m = minutes();
    if (m === null || (kind === 'mute' && m === 'permanent')) {
      say(t('admin_panel.duration_invalid'), true);
      return;
    }
    const message = t(kind === 'ban' ? 'admin_panel.confirm_ban' : 'admin_panel.confirm_mute', { name, duration: inWords(m), reason: reason.value.trim() || t('admin_panel.no_reason') });
    if (!window.confirm(message)) return;
    const body = m === 'permanent' ? { permanent: true, reason: reason.value } : { minutes: m, reason: reason.value };
    const done =
      kind === 'mute' ? t('admin_panel.done_mute', { name, duration: inWords(m) })
      : m === 'permanent' ? t('admin_panel.done_ban_permanent', { name })
      : t('admin_panel.done_ban', { name, duration: inWords(m) });
    void act(() => api('POST', `/accounts/${id}/${kind}`, body), done).then(reload);
  };
  const kick = () => {
    // Nobody to disconnect: say so instead of a "done" that would mean someone was.
    if (!online) {
      say(t('admin_panel.kick_offline', { name }));
      return;
    }
    if (window.confirm(t('admin_panel.confirm_kick', { name }))) void act(() => api('POST', `/accounts/${id}/kick`, { reason: reason.value }), t('admin_panel.done_kick', { name })).then(reload);
  };
  return el('div', { className: 'admin-sanctions' }, [
    group(t('admin_panel.duration'), el('div', { className: 'admin-row' }, [durationRow, field(t('admin_panel.minutes'), custom)])),
    group(t('admin_panel.reason'), el('div', { className: 'admin-row' }, [reasons, field(t('admin_panel.reason_text'), reason)])),
    el('div', { className: 'admin-row' }, [
      button(t('admin_panel.ban'), () => sanction('ban'), 'button small danger'),
      button(t('admin_panel.mute'), () => sanction('mute')),
      button(t('admin_panel.kick'), kick),
      button(t('admin_panel.unban'), () => void act(() => api('POST', `/accounts/${id}/unban`), t('admin_panel.done_unban', { name })).then(reload)),
      button(t('admin_panel.unmute'), () => void act(() => api('POST', `/accounts/${id}/unmute`), t('admin_panel.done_unmute', { name })).then(reload)),
    ]),
  ]);
}

/**
 * Shows the sheet of an account.
 * @param changed - Called after each action that changes the account (the list shows its new state).
 * @param back - Back to the list (the button at the top of the sheet, on a phone).
 */
async function open(id: number, host: HTMLElement, changed?: () => void, back?: () => void): Promise<void> {
  const d = await api<{ account: Json; characters: Json[]; logs: Record<string, Json[]>; currency: string }>('GET', `/accounts/${id}`);
  const a = d.account;
  const reload = () => {
    void open(id, host, changed, back).catch((err: Error) => say(err.message, true));
    changed?.();
  };
  // The server refuses sanctions on an equal or higher rank: do not offer them.
  const outranked = isRole(a.role) && hasRole(a.role, myRole);
  const online = d.characters.some((c) => Boolean(c.online));
  const sanctions = outranked ? el('p', { className: 'hint', text: t('admin_panel.rank_locked') }) : sanctionForm(id, String(a.username), online, reload);
  const adminTools: HTMLElement[] = [];
  if (isAdmin) {
    const role = el('select', {}, ['player', 'moderator', 'admin'].map((r) => el('option', { text: tDynamic(`auth.role.${r}`), attrs: { value: r } })));
    role.value = String(a.role);
    adminTools.push(
      el('div', { className: 'admin-row' }, [
        role,
        button(t('admin_panel.set_role'), () => {
          const name = String(a.username);
          const roleName = tDynamic(`auth.role.${role.value}`);
          if (role.value === a.role) {
            say(t('admin_panel.role_same', { name, role: roleName }));
            return;
          }
          // What the new role allows, said before it is given.
          if (!window.confirm(tDynamic(`admin_panel.confirm_role_${role.value}`, { name, role: roleName }))) return;
          void act(() => api('POST', `/accounts/${id}/role`, { role: role.value }), t('admin_panel.done_role', { name, role: roleName })).then(reload);
        }),
        button(t('admin_panel.reset_password'), () => {
          if (!window.confirm(t('admin_panel.confirm_reset_password', { name: String(a.username) }))) return;
          void api<{ password: string }>('POST', `/accounts/${id}/reset-password`)
            .then((r) => {
              say('');
              passwordDialog(String(a.username), r.password);
            })
            .catch((err: Error) => say(err.message, true));
        }),
      ]),
    );
  }
  const characters = d.characters.map((c) =>
    el('div', { className: 'admin-row' }, [
      el('span', { text: `${c.name} (${t('hud.level', { level: Number(c.level) })}) — ${c.online ? t('friends.online') : t('friends.offline')} — ${c.gold} ${d.currency}` }),
      // Same rank rule as the sanctions (one's own characters excepted).
      outranked && a.id !== myId
        ? null
        : button(t('admin_panel.reset_position'), () => {
            if (window.confirm(t('admin_panel.confirm_reset_position', { name: String(c.name) }))) void act(() => api('POST', `/characters/${c.id}/reset-position`), t('admin_panel.done_reset_position', { name: String(c.name) }));
          }),
    ]),
  );
  // On a phone the sections start folded (the characters excepted): the sheet fits in a screen or two.
  const unfold = !narrow();
  host.replaceChildren(
    ...(back ? [button(t('admin_panel.back_to_accounts'), back, 'button small admin-back')] : []),
    // Summary: name, role, sanctions in force, dates.
    el('h3', { className: 'admin-sheet-title' }, [
      el('span', { text: String(a.username) }),
      el('span', { className: `role-badge role-${String(a.role)}`, text: tDynamic(`auth.role.${String(a.role)}`) }),
      a.bannedUntil ? el('span', { className: 'admin-chip chip-banned', text: t('admin_panel.chip_banned') }) : null,
      a.mutedUntil ? el('span', { className: 'admin-chip chip-muted', text: t('admin_panel.chip_muted') }) : null,
    ]),
    el('p', { className: 'hint', text: `${t('admin_panel.created')} ${formatServerTime(String(a.createdAt))} · ${t('admin_panel.last_login')} ${a.lastLogin ? formatServerTime(String(a.lastLogin)) : '—'}${a.bannedUntil ? ` · ${t('admin_panel.banned')} ${formatServerTime(String(a.bannedUntil))} (${a.banReason ?? ''})` : ''}${a.mutedUntil ? ` · ${t('admin_panel.muted')} ${formatServerTime(String(a.mutedUntil))}` : ''}` }),
    section(t('admin_panel.section_sanctions'), [sanctions], unfold || Boolean(a.bannedUntil || a.mutedUntil)),
    ...(adminTools.length ? [section(t('admin_panel.section_role'), adminTools, unfold)] : []),
    section(t('admin_panel.section_characters', { count: d.characters.length }), characters, true),
    section(
      t('admin_panel.section_logs'),
      Object.entries(d.logs).map(([type, lines]) => el('details', { className: 'admin-log', attrs: type === 'trades' && unfold ? { open: '' } : {} }, [el('summary', { text: `${tDynamic(`admin_panel.log.${type}`)} (${lines.length})` }), table(lines)])),
      unfold,
    ),
  );
}

/**
 * Shows a new password in its own window: large, with a "Copy" button and the reminder that it will not be
 * shown again. Only the administrator closes it (a message can no longer push it away).
 */
function passwordDialog(name: string, password: string): void {
  const box = el('input', { className: 'admin-password', attrs: { type: 'text', readonly: '', value: password, 'aria-label': t('admin_panel.new_password_title', { name }), spellcheck: 'false' } });
  const copy = button(t('admin_panel.copy'), () => {
    const done = () => {
      copy.textContent = t('admin_panel.copied');
      say(t('admin_panel.copied'));
    };
    // The clipboard API needs a secure page (HTTPS or this computer); otherwise the old way, from the selected field.
    const fallback = () => {
      box.select();
      if (document.execCommand('copy')) done();
      else say(t('admin_panel.copy_failed'), true);
    };
    if (navigator.clipboard) void navigator.clipboard.writeText(password).then(done, fallback);
    else fallback();
  }, 'button primary');
  const dialog = el('dialog', { className: 'admin-dialog window', attrs: { 'aria-labelledby': 'admin-dialog-title' } }, [
    el('h3', { text: t('admin_panel.new_password_title', { name }), attrs: { id: 'admin-dialog-title' } }),
    box,
    el('p', { className: 'admin-warning', text: t('admin_panel.new_password_once') }),
    el('div', { className: 'admin-row admin-dialog-buttons' }, [copy, button(t('ui.close'), () => dialog.close(), 'button')]),
  ]);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  box.select();
}

// --- Tools ------------------------------------------------------------------------

type Named = { id: number; name: string };

/** A drop-down list of `[value, label]` choices. */
function picker(options: [string, string][], label: string): HTMLSelectElement {
  const s = el('select', { attrs: { 'aria-label': label, title: label } }, options.map(([value, text]) => el('option', { text, attrs: { value } })));
  return s;
}

/**
 * Drawing of a map for the teleport tool: walkable cells light, blocked ones dark; a click on a walkable
 * cell chooses it (a blocked one is refused, so nobody lands in a wall).
 * @param onPick - Called with the chosen cell.
 */
function mapPicker(onPick: (x: number, y: number) => void): { element: HTMLElement; load(mapId: number): Promise<void>; mark(x: number, y: number): void } {
  const canvas = el('canvas', { className: 'admin-map-canvas', attrs: { 'aria-label': t('admin_panel.teleport_map_label') } });
  // The drawing scrolls in its frame (a finger slides it), so the cells can be as big as a fingertip.
  const frame = el('div', { className: 'admin-map-frame' }, [canvas]);
  const note = el('p', { className: 'hint', text: t('admin_panel.teleport_map_help') });
  let grid: { width: number; height: number; cells: string } | null = null;
  let picked: { x: number; y: number } | null = null;
  let scale = 8;
  /** Size of a cell: 4 to 40 px. */
  const setScale = (next: number) => {
    scale = Math.max(4, Math.min(40, Math.round(next)));
    if (!grid) return;
    canvas.width = grid.width * scale;
    canvas.height = grid.height * scale;
    draw();
    centre();
  };
  /** Brings the chosen cell to the middle of the frame. */
  const centre = () => {
    if (!picked) return;
    frame.scrollLeft = picked.x * scale - frame.clientWidth / 2 + scale / 2;
    frame.scrollTop = picked.y * scale - frame.clientHeight / 2 + scale / 2;
  };
  const zoom = el('div', { className: 'admin-map-zoom' }, [
    el('button', { className: 'button small', text: '−', attrs: { type: 'button', 'aria-label': t('admin_panel.map_zoom_out'), title: t('admin_panel.map_zoom_out') }, on: { click: () => setScale(scale / 1.5) } }),
    el('button', { className: 'button small', text: '+', attrs: { type: 'button', 'aria-label': t('admin_panel.map_zoom_in'), title: t('admin_panel.map_zoom_in') }, on: { click: () => setScale(scale * 1.5) } }),
  ]);
  const draw = () => {
    if (!grid) return;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        ctx.fillStyle = grid.cells[y * grid.width + x] === '1' ? '#6fa65a' : '#2b3326';
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    if (picked) {
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 2;
      ctx.strokeRect(picked.x * scale + 1, picked.y * scale + 1, scale - 2, scale - 2);
    }
  };
  canvas.addEventListener('click', (e) => {
    if (!grid) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * grid.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * grid.height);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
    if (grid.cells[y * grid.width + x] !== '1') {
      say(t('admin_panel.teleport_blocked', { x, y }), true);
      return;
    }
    picked = { x, y };
    draw();
    say(t('admin_panel.teleport_picked', { x, y }));
    onPick(x, y);
  });
  return {
    element: el('div', { className: 'admin-map' }, [zoom, frame, note]),
    async load(mapId: number) {
      grid = await api<{ width: number; height: number; cells: string }>('GET', `/tools/maps/${mapId}/grid`);
      picked = null;
      // A finger needs cells of 24 px; a mouse sees the whole map (480 px at most).
      setScale(matchMedia('(pointer: coarse)').matches ? 24 : Math.max(3, Math.min(12, Math.floor(480 / Math.max(grid.width, grid.height)))));
    },
    mark(x: number, y: number) {
      picked = grid && x < grid.width && y < grid.height ? { x, y } : null;
      draw();
      centre();
    },
  };
}

/** A list with a search box above it: the options whose text contains what is typed stay. */
function searchable(select: HTMLSelectElement, label: string): HTMLElement {
  const filter = input(label);
  const all = [...select.options].map((o) => ({ value: o.value, text: o.text }));
  filter.addEventListener('input', () => {
    const needle = filter.value.trim().toLowerCase();
    const kept = all.filter((o) => !needle || o.text.toLowerCase().includes(needle));
    const before = select.value;
    select.replaceChildren(...kept.map((o) => el('option', { text: o.text, attrs: { value: o.value } })));
    if (kept.some((o) => o.value === before)) select.value = before;
  });
  return el('div', { className: 'admin-search-select' }, [filter, select]);
}

async function tools(): Promise<void> {
  const [lookups, dash] = await Promise.all([
    api<{ maps: Named[]; item: Named[]; weapon: Named[]; armor: Named[]; switches: (Named & { global: boolean })[]; variables: (Named & { global: boolean })[] }>('GET', '/tools/lookups'),
    api<{ players: { id: number; name: string; level: number; mapId: number }[] }>('GET', '/dashboard'),
  ]).catch((err: Error) => {
    say(err.message, true);
    return [null, null] as const;
  });
  if (!lookups || !dash || current !== 'tools') return;
  // Players are picked by name among those online (the tools only act on connected characters).
  const who = picker([], t('admin_panel.player_label'));
  let online = dash.players;
  const fillPlayers = (players: typeof dash.players) => {
    online = players;
    const options: [string, string][] = players.length
      ? [['', t('admin_panel.pick_player')], ...players.map((p): [string, string] => [String(p.id), t('admin_panel.player_option', { name: p.name, level: p.level, map: lookups.maps.find((m) => m.id === p.mapId)?.name ?? p.mapId })])]
      : [['', t('admin_panel.no_players_online')]];
    who.replaceChildren(...options.map(([value, text]) => el('option', { text, attrs: { value } })));
  };
  fillPlayers(dash.players);
  const refresh = button(t('admin_panel.refresh_players'), () => void api<{ players: typeof dash.players }>('GET', '/dashboard').then((d) => fillPlayers(d.players)).catch((err: Error) => say(err.message, true)));
  const map = picker(lookups.maps.map((m) => [String(m.id), `${String(m.id).padStart(3, '0')} — ${m.name}`]), t('admin_panel.map_label'));

  const x = input(t('admin_panel.x_label'), 'number', '20');
  const y = input(t('admin_panel.y_label'), 'number', '17');
  // The destination is picked on a drawing of the map (the fields stay for exact coordinates).
  const mapView = mapPicker((cx, cy) => {
    x.value = String(cx);
    y.value = String(cy);
  });
  const loadMap = () => void mapView.load(num(map)).then(() => mapView.mark(num(x), num(y))).catch((err: Error) => say(err.message, true));
  map.addEventListener('change', loadMap);
  for (const box of [x, y]) box.addEventListener('change', () => mapView.mark(num(x), num(y)));
  loadMap();

  const kind = el('select', { attrs: { 'aria-label': t('admin_panel.kind_label') } }, ['item', 'weapon', 'armor'].map((k) => el('option', { text: tDynamic(`db.option.${k}`), attrs: { value: k } })));
  const itemId = picker([], t('admin_panel.item_label'));
  const fillItems = () => itemId.replaceChildren(...lookups[kind.value as 'item' | 'weapon' | 'armor'].map((i) => el('option', { text: `${String(i.id).padStart(3, '0')} — ${i.name}`, attrs: { value: String(i.id) } })));
  kind.addEventListener('change', fillItems);
  fillItems();
  const qty = input(t('admin_panel.quantity'), 'number', '1');
  qty.min = '1';
  const gold = input(t('admin_panel.gold'), 'number', '100');
  gold.min = '1';
  const exp = input(t('admin_panel.exp'), 'number', '100');
  exp.min = '1';
  // Switches and variables by their name in the System tab (#0001 — name), with a search box.
  const declared = (list: (Named & { global: boolean })[], kindKey: 'switch' | 'variable') =>
    picker(
      list.length ? list.map((s) => [String(s.id), `#${String(s.id).padStart(4, '0')} — ${s.name || t('admin_panel.unnamed')}${s.global ? ` (${t('admin_panel.global')})` : ''}`]) : [['', t(`admin_panel.no_${kindKey}`)]],
      t(kindKey === 'switch' ? 'admin_panel.switch_id' : 'admin_panel.variable_id'),
    );
  const switchId = declared(lookups.switches, 'switch');
  const switchOn = el('select', {}, [el('option', { text: t('ev.on'), attrs: { value: '1' } }), el('option', { text: t('ev.off'), attrs: { value: '0' } })]);
  const variableId = declared(lookups.variables, 'variable');
  const variableValue = input(t('admin_panel.value'), 'number', '0');
  const announce = el('textarea', { attrs: { rows: '3', placeholder: t('admin_panel.announce_text'), maxlength: '300' } });
  const announceMode = picker((['banner', 'chat', 'popup'] as const).map((m) => [m, tDynamic(`admin_panel.announce_mode_${m}`)]), t('admin_panel.announce_mode'));
  /** The chosen online player (an error is shown when none is chosen). */
  const target = () => {
    if (!who.value) throw new Error(t('admin_panel.need_player'));
    return num(who);
  };
  /** A positive whole number typed in a field (an error otherwise). */
  const positive = (box: HTMLInputElement) => {
    const n = num(box);
    if (!Number.isInteger(n) || n <= 0) throw new Error(t('admin_panel.need_positive'));
    return n;
  };
  /** Name of the chosen player, for the messages. */
  const targetName = () => online.find((p) => String(p.id) === who.value)?.name ?? '';
  /** Name of the chosen item without its number ("001 — Potion" gives "Potion"). */
  const itemName = () => (itemId.selectedOptions[0]?.text ?? '').replace(/^\d+ — /, '');
  /**
   * Gives (or takes) something to the chosen player: `build` checks the fields (an error is shown when one is
   * not valid) and says in words what is given; the message names the player and the thing.
   */
  const give = (build: () => { body: Json; what: string; take?: boolean }) => {
    let b: ReturnType<typeof build>;
    let characterId: number;
    try {
      characterId = target();
      b = build();
    } catch (err) {
      say((err as Error).message, true);
      return;
    }
    if (b.take && !window.confirm(t('admin_panel.confirm_take', { player: targetName(), what: b.what }))) return;
    const message = t(b.take ? 'admin_panel.done_take' : 'admin_panel.done_give', { player: targetName(), what: b.what });
    void act(() => api('POST', '/tools/give', { characterId, ...b.body }), message);
  };
  /** A block of tools: a fieldset on a wide screen; on a phone a fold of an accordion (one open at a time). */
  const block = (title: string, children: (HTMLElement | null)[]): HTMLElement =>
    matchMedia('(max-width: 600px)').matches
      ? section(title, children, title === t('admin_panel.teleport'), { name: 'tools' })
      : el('fieldset', {}, [el('legend', { text: title }), ...children]);
  content.replaceChildren(
    el('h2', { text: t('admin_panel.tab.tools') }),
    el('p', { className: 'hint', text: t('admin_panel.tools_help') }),
    el('div', { className: 'admin-row admin-target' }, [field(t('admin_panel.player_label'), who), refresh]),
    block(t('admin_panel.teleport'), [el('div', { className: 'admin-row' }, [
        button(t('admin_panel.go_to_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: target() }), () => t('admin_panel.done_go_to', { player: targetName() }))),
        button(t('admin_panel.summon_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: target(), toCharacterId: 'self' }), () => t('admin_panel.done_summon', { player: targetName() }))),
      ]),
      el('div', { className: 'admin-row' }, [field(t('admin_panel.map_label'), map), field(t('admin_panel.x_label'), x), field(t('admin_panel.y_label'), y)]),
      mapView.element,
      el('div', { className: 'admin-row' }, [
        button(t('admin_panel.teleport_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: target(), mapId: num(map), x: num(x), y: num(y) }), () => t('admin_panel.done_teleport_player', { player: targetName(), x: num(x), y: num(y) }))),
        button(t('admin_panel.teleport_self'), () => void act(() => api('POST', '/tools/teleport', { characterId: 'self', mapId: num(map), x: num(x), y: num(y) }), () => t('admin_panel.done_teleport_self', { x: num(x), y: num(y) }))),
      ]),
    ]),
    block(t('admin_panel.invisibility'), [el('div', { className: 'admin-row' }, [
      button(t('admin_panel.invisible_on'), () => void act(() => api('POST', '/tools/invisible', { on: true }), t('admin_panel.done_invisible_on'))),
      button(t('admin_panel.invisible_off'), () => void act(() => api('POST', '/tools/invisible', { on: false }), t('admin_panel.done_invisible_off'))),
    ])]),
    // Objects, gold and experience each have their own block and buttons: nothing is given by accident.
    block(t('admin_panel.give_items'), [el('div', { className: 'admin-row' }, [
      field(t('admin_panel.kind_label'), kind), group(t('admin_panel.item_label'), searchable(itemId, t('admin_panel.filter_list'))), field(t('admin_panel.quantity'), qty),
      button(t('admin_panel.add'), () => give(() => ({ body: { kind: kind.value, id: num(itemId), quantity: positive(qty) }, what: `${positive(qty)} × ${itemName()}` }))),
      button(t('admin_panel.take'), () => give(() => ({ body: { kind: kind.value, id: num(itemId), quantity: -positive(qty) }, what: `${positive(qty)} × ${itemName()}`, take: true })), 'button small danger'),
    ])]),
    block(t('admin_panel.give_gold'), [el('div', { className: 'admin-row' }, [
      field(t('admin_panel.gold'), gold),
      button(t('admin_panel.add'), () => give(() => ({ body: { gold: positive(gold) }, what: t('admin_panel.what_gold', { amount: positive(gold) }) }))),
      button(t('admin_panel.take'), () => give(() => ({ body: { gold: -positive(gold) }, what: t('admin_panel.what_gold', { amount: positive(gold) }), take: true })), 'button small danger'),
    ])]),
    block(t('admin_panel.give_exp'), [el('div', { className: 'admin-row' }, [
      field(t('admin_panel.exp'), exp),
      button(t('admin_panel.add'), () => give(() => ({ body: { exp: positive(exp) }, what: t('admin_panel.what_exp', { amount: positive(exp) }) }))),
    ])]),
    block(t('admin_panel.progress'), [el('p', { className: 'hint', text: t('admin_panel.progress_help') }),
      el('div', { className: 'admin-row' }, [
        group(t('admin_panel.switch_id'), searchable(switchId, t('admin_panel.filter_list'))), field(t('admin_panel.value'), switchOn),
        button(t('admin_panel.set_switch'), () => {
          if (!switchId.value) return;
          const label = switchId.selectedOptions[0]?.text ?? '';
          if (window.confirm(t('admin_panel.confirm_switch', { name: label, value: switchOn.selectedOptions[0]?.text ?? '' }))) void act(() => api('POST', '/tools/progress', { characterId: target(), switchId: num(switchId), switchValue: switchOn.value === '1' }), () => t('admin_panel.done_switch', { player: targetName() }));
        }),
      ]),
      el('div', { className: 'admin-row' }, [
        group(t('admin_panel.variable_id'), searchable(variableId, t('admin_panel.filter_list'))), field(t('admin_panel.value'), variableValue),
        button(t('admin_panel.set_variable'), () => {
          if (!variableId.value) return;
          const label = variableId.selectedOptions[0]?.text ?? '';
          if (window.confirm(t('admin_panel.confirm_variable', { name: label, value: num(variableValue) }))) void act(() => api('POST', '/tools/progress', { characterId: target(), variableId: num(variableId), variableValue: num(variableValue) }), () => t('admin_panel.done_variable', { player: targetName() }));
        }),
      ]),
    ]),
    block(t('admin_panel.announce'), [el('div', { className: 'admin-row' }, [
      field(t('admin_panel.announce_text'), announce),
      field(t('admin_panel.announce_mode'), announceMode),
      button(t('admin_panel.announce'), () => {
        // Say which field is missing rather than the server's "invalid values".
        if (!announce.value.trim()) {
          say(t('admin_panel.announce_empty'), true);
          announce.focus();
          return;
        }
        void act(() => api('POST', '/tools/announce', { text: announce.value, mode: announceMode.value }), t('admin_panel.done_announce'));
      }),
    ])]),
  );
  // Phone: the map was drawn while its block was folded (no size): bring the chosen cell back to the middle when it opens.
  mapView.element.closest('details')?.addEventListener('toggle', (e) => (e.currentTarget as HTMLDetailsElement).open && mapView.mark(num(x), num(y)));
}

// --- Logs --------------------------------------------------------------------------

/** A CSV field: quoted when it holds a separator, a quote or a line break; formulas are neutralised for spreadsheets. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Downloads lines as a CSV file (`;` separators, opened directly by spreadsheets in French and English). */
function downloadCsv(lines: Json[], name: string): void {
  if (lines.length === 0) return;
  const cols = Object.keys(lines[0]!).filter((c) => !HIDDEN_COLUMNS.has(c));
  const rows = [cols.map((c) => csvField(tDynamic(`admin_panel.col.${c}`))).join(';'), ...lines.map((l) => cols.map((c) => csvField(lineText(c, l))).join(';'))];
  // The byte order mark tells spreadsheets the file is UTF-8 (accents).
  const url = URL.createObjectURL(new Blob(['﻿', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { attrs: { href: url, download: name } });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lines of a log asked at a time (the next ones with "Load more"). */
const LOG_PAGE = 50;

/** A moment as SQLite writes it, in UTC ("2026-11-07 23:00:00"). */
const sqlUtc = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

function logs(): void {
  const type = el('select', {}, ['connections', 'trades', 'sales', 'drops', 'reports', 'admin'].map((x) => el('option', { text: tDynamic(`admin_panel.log.${x}`), attrs: { value: x } })));
  // An account is named by its name or the name of one of its characters (a number still works).
  const who = input(t('admin_panel.log_who'));
  // One day, in the viewer's time zone (empty: every day).
  const day = el('input', { attrs: { type: 'date', 'aria-label': t('admin_panel.log_day') } });
  const out = el('div');
  const more = button(t('admin_panel.load_more'), () => load(true), 'button admin-more');
  const count = el('p', { className: 'hint admin-log-count', attrs: { 'aria-live': 'polite' } });
  let lines: Json[] = [];
  const load = (next = false) => {
    const query = who.value.trim();
    const params = new URLSearchParams({ limit: String(LOG_PAGE) });
    if (/^\d+$/.test(query)) params.set('account', query);
    else if (query) params.set('name', query);
    if (day.value) {
      const from = new Date(`${day.value}T00:00:00`);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      params.set('from', sqlUtc(from));
      params.set('to', sqlUtc(to));
    }
    if (next && lines.length > 0) params.set('before', String(lines.at(-1)!.id));
    void api<{ lines: Json[] }>('GET', `/logs/${type.value}?${params.toString()}`)
      .then((r) => {
        lines = next ? [...lines, ...r.lines] : r.lines;
        out.replaceChildren(query && lines.length === 0 ? el('p', { className: 'hint', text: t('admin_panel.log_nobody', { name: query }) }) : table(lines));
        // A full page may have more behind it.
        more.hidden = r.lines.length < LOG_PAGE;
        count.textContent = lines.length === 0 ? '' : r.lines.length < LOG_PAGE ? t('admin_panel.log_end', { count: lines.length }) : t('admin_panel.log_count', { count: lines.length });
      })
      .catch((err: Error) => say(err.message, true));
  };
  type.addEventListener('change', () => load());
  day.addEventListener('change', () => load());
  who.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  const exportButton = button(t('admin_panel.export_csv'), () => {
    if (lines.length === 0) say(t('admin_panel.empty'), true);
    else downloadCsv(lines, `brindiwanko-${type.value}-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  content.replaceChildren(
    el('h2', { text: t('admin_panel.tab.logs') }),
    el('div', { className: 'admin-row admin-log-filters' }, [
      field(t('admin_panel.tab.logs'), type),
      field(t('admin_panel.log_who'), who),
      field(t('admin_panel.log_day'), day),
      button(t('admin_panel.show'), () => load()),
      exportButton,
    ]),
    out,
    count,
    more,
  );
  load();
}

// --- Backups -------------------------------------------------------------------------

/**
 * Backups: download one; the daily automatic ones; then restoring, with one warning above every restore
 * button (a backup of the server or a file); the details folded in "Help".
 */
function backup(): void {
  const file = el('input', { attrs: { type: 'file', accept: '.db,application/octet-stream', 'aria-label': t('admin_panel.restore_file') } });
  // A restoration replaces the whole game: the administrator's password is asked again, whatever is put back
  // (a backup of the server or a file). One field serves both.
  const password = el('input', { attrs: { type: 'password', autocomplete: 'current-password', 'aria-label': t('admin_panel.restore_password') } });
  const auto = el('section', { className: 'admin-auto-backups' }, [el('h3', { text: t('admin_panel.auto_backup') })]);
  const serverBackups = el('div', { className: 'admin-server-backups' });
  const help = section(t('admin_panel.help'), [el('p', { className: 'hint', text: t('admin_panel.restore_help') }), el('p', { className: 'hint', text: t('admin_panel.restore_auto_help') }), el('p', { className: 'hint', text: t('admin_panel.resources_help') })]);
  content.replaceChildren(
    el('h2', { text: t('admin_panel.tab.backup') }),
    el('p', { text: t('admin_panel.backup_help') }),
    el('a', { className: 'button primary', text: t('admin_panel.download_backup'), attrs: { href: '/api/admin/backup' } }),
    auto,
    el('h3', { text: t('admin_panel.restore') }),
    el('p', { className: 'admin-warning', text: t('admin_panel.restore_warning') }),
    field(t('admin_panel.restore_password'), password),
    serverBackups,
    el('h4', { text: t('admin_panel.restore_from_file') }),
    el('div', { className: 'admin-row' }, [
      file,
      button(t('admin_panel.restore'), () => {
        const f = file.files?.[0];
        if (!f || !passwordTyped(password) || !window.confirm(t('admin_panel.confirm_restore_file', { name: f.name }))) return;
        void act(async () => {
          const res = await fetch('/api/admin/restore', {
            method: 'POST',
            // The body holds the file: the password goes in a header, URI-encoded (a header only carries Latin-1 text).
            headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf, 'x-confirm-password': encodeURIComponent(password.value) },
            body: f,
          });
          const data = (await res.json().catch(() => ({}))) as Json;
          if (!res.ok) throw new Error(tDynamic(String(data.error ?? 'error.http.server'), data.params as Record<string, string>));
        }, t('admin_panel.restore_scheduled')).then(() => (password.value = ''));
      }, 'button small danger'),
    ]),
    help,
  );
  void autoBackups(auto, serverBackups, help, password);
}

/** Tells whether the administrator typed its password to restore a backup; otherwise says so and goes to its field. */
function passwordTyped(password: HTMLInputElement): boolean {
  if (password.value) return true;
  say(t('admin_panel.restore_password_needed'), true);
  password.focus();
  return false;
}

/**
 * Daily automatic backups: hour and number kept (in `box`), and the copies already on the server, each
 * with its restore button (in `list`); the folder they are in goes to the help. `password` is the field of
 * the administrator's password, shared with the restoration of a file.
 */
async function autoBackups(box: HTMLElement, listHost: HTMLElement, help: HTMLElement, password: HTMLInputElement): Promise<void> {
  type Backups = { schedule: { hour: number; keep: number }; folder: string; backups: { name: string; at: string }[] };
  let d: Backups;
  try {
    d = await api<Backups>('GET', '/backups');
  } catch (err) {
    say((err as Error).message, true);
    return;
  }
  const hour = el('select', { attrs: { 'aria-label': t('admin_panel.backup_hour') } }, Array.from({ length: 24 }, (_, h) => el('option', { text: formatHour(h), attrs: { value: String(h) } })));
  hour.value = String(d.schedule.hour);
  const keep = el('select', { attrs: { 'aria-label': t('admin_panel.backup_keep') } }, BACKUP_KEEP_CHOICES.map((n) => el('option', { text: n === 1 ? t('admin_panel.backup_keep_one') : t('admin_panel.backup_keep_days', { count: n }), attrs: { value: String(n) } })));
  keep.value = String(d.schedule.keep);
  /** Puts a backup of the server back at the next start. */
  const restoreBackup = (name: string, at: string) => {
    if (!passwordTyped(password) || !window.confirm(t('admin_panel.confirm_restore_backup', { when: formatServerTime(at, 'full') }))) return;
    void act(() => api('POST', `/backups/${encodeURIComponent(name)}/restore`, { password: password.value }), t('admin_panel.restore_scheduled')).then(() => (password.value = ''));
  };
  const list = d.backups.length
    ? el('ul', { className: 'admin-backup-list' }, d.backups.map((b) => el('li', {}, [
        el('span', { text: `${formatServerTime(b.at, 'full')} — ${b.name}` }),
        button(t('admin_panel.restore_this'), () => restoreBackup(b.name, b.at), 'button small danger'),
      ])))
    : el('p', { className: 'hint', text: t('admin_panel.no_server_backup') });
  box.append(
    el('p', { text: t('admin_panel.auto_backup_help') }),
    el('div', { className: 'admin-row' }, [
      field(t('admin_panel.backup_hour'), hour),
      field(t('admin_panel.backup_keep'), keep),
      button(t('common.save'), () => void act(() => api('POST', '/backups/schedule', { hour: Number(hour.value), keep: Number(keep.value) }), t('admin_panel.backup_schedule_saved'))),
    ]),
  );
  listHost.append(
    el('h4', { text: t('admin_panel.server_backups', { count: d.backups.length }) }),
    list,
  );
  help.querySelector('.admin-section-body')?.append(el('p', { className: 'hint', text: t('admin_panel.backup_folder', { folder: d.folder }) }));
}

/**
 * One compact bar, kept at the top of the screen: the title, the tabs (moved to the bottom of the screen
 * on a phone, see site.css) and a menu button. The account bar and the language switch of the page move
 * into that menu (same links, same logout form), instead of taking a third of a phone's screen above the
 * content; the link to this very page is dropped.
 */
function buildBar(): HTMLElement {
  const menu = el('div', { className: 'admin-menu', attrs: { id: 'admin-menu', hidden: '' } });
  const accountBar = document.querySelector('.account-bar');
  accountBar?.querySelector('a[href="/admin"]')?.remove();
  for (const part of [accountBar, document.querySelector('.lang-switch')]) if (part) menu.append(part);
  menu.append(el('a', { className: 'button small', text: t('admin_panel.back_to_game'), attrs: { href: '/characters' } }));
  const toggle = el('button', {
    className: 'admin-menu-button',
    text: '☰',
    attrs: { type: 'button', 'aria-label': t('admin_panel.menu'), 'aria-expanded': 'false', 'aria-controls': 'admin-menu' },
  });
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(Boolean(menu.hidden)));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== toggle) setOpen(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  return el('header', { className: 'admin-bar' }, [el('h1', { text: t('admin_panel.title') }), nav, toggle, menu]);
}

root.replaceChildren(buildBar(), content, status);
document.body.classList.add('admin-ready');
show('dashboard');
