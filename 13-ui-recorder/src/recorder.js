// Node side of the recorder: exposes bindings, injects the page script, turns events into
// 01-mcp-ui-verifier scenario steps. Public API: startRecorder(page, options) -> Recorder.
import { pageRecorder } from './injected.js';
import { toolbarStrings, normalizeLang } from './i18n.js';
import { nullLogger } from './logger.js';

export const VERSION = '0.1.0';
/** Same action list as 01-mcp-ui-verifier/src/scenario.js ACTIONS (the recorder only emits a subset). */
export const EMITTED_ACTIONS = ['open', 'click', 'fill', 'press', 'assert_text', 'assert_visible', 'screenshot_annotate', 'check_console_errors'];

const IGNORED_URL = /^(about:|data:|chrome-error:|chrome:|devtools:)/;
const NAV_AFTER_ACTION_MS = 2000; // a navigation this soon after a click/press is caused by it -> not recorded as "open"

export class Recorder {
  constructor(page, opts = {}) {
    this.page = page;
    this.lang = normalizeLang(opts.lang);
    this.log = opts.logger || nullLogger;
    this.name = opts.name;
    this.debounceMs = opts.debounceMs ?? 400;
    this.checkConsole = Boolean(opts.checkConsole);
    this.baseUrl = opts.baseUrl || null;
    this.navGraceMs = opts.navGraceMs ?? NAV_AFTER_ACTION_MS;
    this.steps = [];
    this.paused = false;
    this.stopped = false;
    this.lastActionAt = 0;
    this.queue = Promise.resolve();
    this.stopReason = null;
    this._stopPromise = new Promise((r) => { this._resolveStop = r; });
  }

  async attach() {
    const page = this.page;
    await page.exposeBinding('__uirecEmit', (_src, ev) => this._enqueue(() => this._onEvent(ev)));
    await page.exposeBinding('__uirecState', (_src, patch) => this._onState(patch || {}));
    await page.exposeBinding('__uirecStop', () => this._enqueue(() => this.stop('toolbar')));
    const cfg = { lang: this.lang, strings: toolbarStrings(), debounceMs: this.debounceMs };
    this.script = `(${pageRecorder.toString()})(${JSON.stringify(cfg)});`;
    await page.addInitScript({ content: this.script });
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) this._enqueue(() => this._onNav(frame.url())); });
    page.on('close', () => { this._enqueue(() => this.stop('page-closed')); });
    // Page already showing something: record it as the first "open" and inject now.
    const cur = page.url();
    if (cur && !IGNORED_URL.test(cur)) {
      this._onNav(cur);
      await page.evaluate(this.script).catch((e) => this.log.warn('inject.failed', { message: e.message }));
    }
    this.log.info('recorder.attached', { lang: this.lang, url: cur });
    return this;
  }

  _enqueue(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch((e) => this.log.error('recorder.event.error', { message: e.message, stack: e.stack }));
    return p;
  }

  _onState(patch) {
    if (typeof patch.paused === 'boolean') { this.paused = patch.paused; this.log.info(patch.paused ? 'recorder.paused' : 'recorder.resumed'); }
    if (patch.lang) { this.lang = normalizeLang(patch.lang); this.log.info('recorder.lang', { lang: this.lang }); }
    return { paused: this.paused, lang: this.lang, count: this.steps.length };
  }

  _relUrl(url) {
    try {
      const u = new URL(url);
      if (!this.baseUrl) this.baseUrl = `${u.origin}/`;
      const b = new URL(this.baseUrl);
      if (u.origin === b.origin) return (u.pathname || '/') + u.search + u.hash;
      return url;
    } catch { return url; }
  }

  _onNav(url) {
    if (this.stopped || !url || IGNORED_URL.test(url)) return;
    const rel = this._relUrl(url);
    const first = !this.steps.some((s) => s.action === 'open');
    if (!first && (this.paused || Date.now() - this.lastActionAt < this.navGraceMs)) {
      this.log.debug('nav.skipped', { url, reason: this.paused ? 'paused' : 'caused-by-action' });
      return;
    }
    const last = this.steps[this.steps.length - 1];
    if (last && last.action === 'open' && last.url === rel) return;
    this._push({ action: 'open', url: rel });
  }

  /** Pick the first candidate that matches exactly one element (checked with Playwright), else the best in-page guess. */
  async _choose(cands = []) {
    for (const c of cands) {
      try {
        const n = await Promise.race([this.page.locator(c.sel).count(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
        if (n === 1) { this.log.debug('selector.chosen', { sel: c.sel, kind: c.kind, verified: true }); return c.sel; }
        this.log.debug('selector.rejected', { sel: c.sel, kind: c.kind, count: n });
      } catch (e) {
        this.log.debug('selector.unverified', { sel: c.sel, kind: c.kind, message: e.message.split('\n')[0] });
      }
    }
    const best = cands.find((c) => c.unique) || cands[0];
    if (best) this.log.warn('selector.fallback', { sel: best.sel, kind: best.kind });
    return best ? best.sel : null;
  }

  async _onEvent(ev) {
    if (this.stopped) return { count: this.steps.length };
    if (this.paused && ['click', 'fill', 'press'].includes(ev.type)) return { count: this.steps.length };
    if (ev.url) this._relUrl(ev.url);
    if (ev.type === 'annotate') {
      const selectors = [];
      const labels = [];
      for (const it of ev.items || []) {
        const sel = await this._choose(it.cands);
        if (sel) { selectors.push(sel); labels.push(it.label || sel); }
      }
      if (selectors.length) this._push({ action: 'screenshot_annotate', selectors, labels, label: ev.label || 'annotate' });
      return { count: this.steps.length };
    }
    const selector = await this._choose(ev.cands);
    if (!selector) return { count: this.steps.length };
    if (ev.type === 'click') { this.lastActionAt = Date.now(); this._push({ action: 'click', selector }); }
    else if (ev.type === 'press') { this.lastActionAt = Date.now(); this._push({ action: 'press', selector, key: ev.key || 'Enter' }); }
    else if (ev.type === 'fill') {
      const step = { action: 'fill', selector, text: String(ev.text ?? '') };
      if (ev.secret) step.secret = true;
      const last = this.steps[this.steps.length - 1];
      if (last && last.action === 'fill' && last.selector === selector) { Object.assign(last, step); this.log.debug('step.merged', redact(step)); }
      else this._push(step);
    } else if (ev.type === 'assert') {
      if (ev.text) this._push({ action: 'assert_text', selector, expected: ev.text });
      else this._push({ action: 'assert_visible', selector });
    }
    return { count: this.steps.length };
  }

  _push(step) {
    this.steps.push(step);
    this.log.info('step.recorded', { no: this.steps.length, ...redact(step) });
  }

  /** Flush pending (debounced) fills in the page and wait until every queued event is processed. */
  async flush() {
    if (!this.page.isClosed()) await this.page.evaluate(() => window.__uirec && window.__uirec.flush()).catch(() => {});
    await this.queue;
  }

  /** Stop recording (toolbar button, page close, or programmatic). Idempotent. */
  async stop(reason = 'api') {
    if (this.stopped) return this.scenario();
    if (reason === 'api') await this.flush();
    this.stopped = true;
    this.stopReason = reason;
    this.log.info('recorder.stopped', { reason, steps: this.steps.length });
    this._resolveStop(reason);
    return this.scenario();
  }

  /** Resolves with the stop reason ('toolbar' | 'page-closed' | 'api'). */
  waitForStop() { return this._stopPromise; }

  /** Build the scenario object (format of 01-mcp-ui-verifier). */
  scenario() {
    const steps = this.steps.map((s) => ({ ...s }));
    if (this.checkConsole) steps.push({ action: 'check_console_errors' });
    const host = this.baseUrl ? new URL(this.baseUrl).host : 'page';
    return {
      name: this.name || `recorded-${host.replace(/[^\w.-]+/g, '_')}`,
      description: `由 13-ui-recorder 錄製 Recorded by 13-ui-recorder v${VERSION}`,
      baseUrl: this.baseUrl || undefined,
      stopOnFailure: false,
      recordedAt: new Date().toISOString(),
      steps,
    };
  }
}

/** Never write secret values to logs. */
export function redact(step) {
  return step.secret ? { ...step, text: '******' } : step;
}

/**
 * Attach a recorder to a Playwright page. Call before page.goto() (or after: the current URL becomes the first "open").
 * @param {import('playwright').Page} page
 * @param {{lang?:string, name?:string, logger?:object, debounceMs?:number, checkConsole?:boolean, baseUrl?:string, navGraceMs?:number}} [opts]
 */
export async function startRecorder(page, opts) {
  const r = new Recorder(page, opts);
  await r.attach();
  return r;
}
