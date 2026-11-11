/**
 * @file Builds the Express application: view engine, static files, sessions,
 * locale handling and page routes.
 *
 * Kept separate from `index.ts` so tests can create the app without opening a
 * network port. Socket.io is attached to the HTTP server in `net/socket.ts`.
 */
import { securityHeaders } from './http/security.js';
import { adminRouter } from './admin/admin-routes.js';
import compression from 'compression';
import express from 'express';
import type { Express } from 'express';
import { isLocale } from '../shared/i18n.js';
import { currentAccount, loadAccount, requireRole } from './auth/middleware.js';
import { editorRouter } from './admin/editor-routes.js';
import { accountRouter } from './auth/account-routes.js';
import { authRouter } from './auth/routes.js';
import type { ServerContext } from './context.js';
import { characterRouter } from './game/character-routes.js';
import { SECURE_COOKIES, safeRedirectPath } from './http/cookies.js';
import { exposeCsrf } from './http/csrf.js';
import { dictionaryVersion, getDictionary, localeMiddleware, setLocaleCookie } from './i18n.js';
import { PATHS } from './paths.js';

/** Pages anyone may open, listed in the sitemap. */
const PUBLIC_PAGES = ['/', '/login', '/register'];
/** Paths search engines are asked to leave alone (personal, administrative or technical). */
const PRIVATE_PATHS = ['/admin', '/api/', '/account', '/characters', '/game', '/dev/', '/lang/', '/forgot-password', '/reset-password'];

/** HTTP status of an error raised by the request parsers (4xx), 500 for anything else. */
function clientErrorStatus(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

/**
 * Creates the Express application.
 * @param ctx - Server context.
 */
export function createApp(ctx: ServerContext): Express {
  const app = express();
  app.disable('x-powered-by');
  // Cookies set outside the session (CSRF, language) follow this server's configuration, not the process's.
  app.set(SECURE_COOKIES, ctx.config.production);
  if (ctx.config.trustProxy) app.set('trust proxy', 1);
  else {
    // Behind a proxy without TRUST_PROXY=1, every player seems to come from the proxy's
    // address: the login limiter would then lock everybody out at once.
    let warned = false;
    app.use((req, _res, next) => {
      if (!warned && req.headers['x-forwarded-for'] !== undefined) {
        warned = true;
        console.warn('[brindiwanko] requests come through a proxy (X-Forwarded-For) but TRUST_PROXY is not set: set TRUST_PROXY=1');
      }
      next();
    });
  }
  app.use(securityHeaders(ctx.config.production));
  // Text answers (pages, scripts, styles, the SVG graphics, JSON) are sent compressed: the SVG sheets and scripts
  // weigh about five times less, which is what a phone on a mobile network waits for when it enters the game.
  // Images, sounds and downloads that are already compressed are left alone (by media type).
  // Pages are sent as they are: they hold the anti-CSRF token next to text taken from the request (the
  // address, typed values), and the size of a compressed answer would let a spy on the network guess the
  // token a character at a time ("BREACH"). They weigh little next to the scripts and graphics.
  app.use(compression({ filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').startsWith('text/html') && compression.filter(req, res) }));

  app.set('view engine', 'ejs');
  app.set('views', PATHS.views);

  // Static files. Generated/imported graphics keep the standard sheet folder layout under /img.
  const staticOptions = { maxAge: ctx.config.production ? '1d' : 0 };
  // The game's own scripts and styles keep fixed names: browsers must revalidate them (ETag, cheap 304)
  // so an update reaches players at once. Only the content-hashed chunks may be cached for long.
  app.use('/build', express.static(`${PATHS.public}/build`, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (ctx.config.production && /[\\/]chunks[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.use('/img', express.static(`${PATHS.assets}/img`, staticOptions));
  app.use('/audio', express.static(PATHS.audio, staticOptions));
  // Uploaded files come from administrators, but are still served inert: no
  // scripts, no plugins, no styles, no content sniffing, even if opened directly.
  // (This policy applies to a file opened as a page only: the game draws an uploaded SVG as an image, styles included.)
  app.use('/uploads', express.static(PATHS.uploads, {
    ...staticOptions,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use(express.static(PATHS.public, staticOptions));

  // Dictionaries for the browser client: loaded by every page (see `dictionaryUrl`), and for a language
  // switch without reload. Asked for with the current version, the file never changes: browsers keep it.
  // Without a version (or an outdated one), they check it again each time (ETag, cheap 304).
  app.get('/locales/:locale.json', (req, res) => {
    const { locale } = req.params;
    if (!isLocale(locale)) {
      res.status(404).json({ error: 'error.http.not_found' });
      return;
    }
    const current = req.query.v === dictionaryVersion(locale);
    res.setHeader('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.json(getDictionary(locale));
  });

  // Browsers ask for this path by themselves: answer with the game icon instead of an error page.
  app.get('/favicon.ico', (_req, res) => {
    res.redirect(301, '/img/system/AppIcon.svg');
  });

  // Search engines may index the public pages, not the game, the accounts or the administration.
  // The sitemap needs the public address of the game (PUBLIC_URL): without it, there is none.
  app.get('/robots.txt', (_req, res) => {
    const lines = ['User-agent: *', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), 'Allow: /'];
    if (ctx.config.publicUrl) lines.push(`Sitemap: ${ctx.config.publicUrl}/sitemap.xml`);
    res.type('text/plain').send(`${lines.join('\n')}\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const origin = ctx.config.publicUrl;
    if (!origin) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // Health probes, never cached. Liveness: the process answers. Readiness: it can take players (not shutting
  // down, database answering); a load balancer stops sending players to a server that fails it.
  app.get('/livez', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });
  const readiness: express.RequestHandler = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let ready = !ctx.stopping && ctx.db.open;
    if (ready) {
      try {
        ctx.db.prepare('SELECT 1').pluck().get();
      } catch {
        ready = false;
      }
    }
    res.status(ready ? 200 : 503).json({ ok: ready });
  };
  app.get('/readyz', readiness);
  app.get('/healthz', readiness);

  // Everything below needs the session (static files and health checks above do not).
  // These answers depend on who asks: no cache (browser or shared proxy) may keep them.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(ctx.sessionMiddleware);
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(loadAccount(ctx.accounts));
  app.use(localeMiddleware);
  app.use(exposeCsrf);
  // The editor API parses its own (larger) JSON bodies.
  app.use('/api/editor', editorRouter(ctx));
  app.use('/api/admin', adminRouter(ctx));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.locals.gameTitle = ctx.settings.get('gameTitle', 'Brindiwanko');
    // Absolute links of the link previews (OpenGraph), when the public address is known.
    res.locals.publicUrl = ctx.config.publicUrl ?? '';
    // Used by the language selector to come back to the same page.
    res.locals.currentPath = req.originalUrl;
    next();
  });

  // Language selector target: remembers the choice (cookie + account) and returns
  // to the previous page. Works without JavaScript; the client can also call it with fetch.
  // A link followed from another site changes the page's language only, not the account.
  app.get('/lang/:locale', (req, res) => {
    const { locale } = req.params;
    const next = safeRedirectPath(req.query.next);
    const account = currentAccount(res);
    const crossSite = req.get('sec-fetch-site') === 'cross-site';
    if (isLocale(locale)) {
      setLocaleCookie(res, locale);
      if (account && !crossSite) {
        ctx.accounts.setLocale(account.id, locale);
        req.session.locale = locale;
      }
    }
    res.redirect(303, next);
  });

  app.get('/', (_req, res) => {
    res.render('index');
  });

  app.use(authRouter(ctx));
  app.use(accountRouter(ctx));

  // Resource manifest for the client and the editor.
  app.get('/api/resources', (_req, res, next) => {
    // A script call (not a page): answer 401 in JSON instead of redirecting to the login page.
    if (currentAccount(res)) next();
    else res.status(401).json({ error: 'error.http.unauthorized' });
  }, (_req, res) => {
    res.json({ tileSize: ctx.settings.get('tileSize', 48), resources: ctx.resources.all() });
  });

  // Administration panel (moderators and administrators; the API checks each action again).
  app.get('/admin', requireRole('moderator'), (_req, res) => {
    res.render('admin');
  });

  // Visual check of every generated/imported resource (administrators only).
  app.get('/dev/assets', requireRole('admin'), (_req, res) => {
    const groups = new Map<string, ReturnType<typeof ctx.resources.all>>();
    for (const r of ctx.resources.all()) {
      if (!r.mime.startsWith('image/')) continue;
      groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
    }
    res.render('dev-assets', { groups: [...groups] });
  });

  app.use(characterRouter(ctx));

  app.use((_req, res) => {
    res.status(404).render('error', { code: 404, messageKey: 'error.http.not_found' });
  });

  // Last-resort error handler: log the details, show a generic translated page.
  // It also catches body-parser errors (too large, malformed), raised before the
  // locale and the page variables exist: it sets them up itself.
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = clientErrorStatus(err);
    if (status === 500) console.error('[brindiwanko] unhandled route error', err);
    if (res.headersSent) {
      next(err);
      return;
    }
    const messageKey = status === 413 ? 'error.http.too_large' : status === 500 ? 'error.http.server' : 'error.http.bad_request';
    if (req.path.startsWith('/api/')) {
      res.status(status).json({ error: messageKey });
      return;
    }
    if (res.locals.t === undefined) localeMiddleware(req, res, () => undefined);
    res.locals.gameTitle ??= ctx.settings.get('gameTitle', 'Brindiwanko');
    res.locals.currentPath ??= '/';
    res.status(status).render('error', { code: status, messageKey }, (renderError, html) => {
      if (renderError) {
        console.error('[brindiwanko] error page failed', renderError);
        res.type('text/plain').send(String(status));
      } else res.send(html);
    });
  });

  return app;
}
