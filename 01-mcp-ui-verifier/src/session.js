// VerifierSession: one browser + one page + a recorded list of steps, console messages and screenshots.
// Shared by the MCP server and the CLI. Everything is async.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { Logger } from './logger.js';
import { t } from './i18n.js';
import { writeReport } from './report.js';

const OVERLAY_ID = '__uiv_overlay__';

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

function slug(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'shot';
}

export class VerifierSession {
  /**
   * @param {object} opts  resolved options (see config.resolveOptions)
   * @param {object} [meta] { name: scenario/session name, runDir: explicit run dir }
   */
  constructor(opts, meta = {}) {
    this.opts = { ...opts };
    this.lang = opts.lang;
    this.name = meta.name || 'interactive';
    this.runDir = meta.runDir || path.join(opts.outDir, `run-${stamp()}-${slug(this.name)}`);
    this.shotDir = path.join(this.runDir, 'screenshots');
    this.logFile = path.join(this.runDir, 'log.jsonl');
    this.tracePath = null;
    this.steps = [];
    this.console = [];
    this.consoleCursor = 0;
    this.screenshots = [];
    this.pageTimings = [];
    this.startedAt = null;
    this.endedAt = null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.browserVersion = '';
    this.log = new Logger({ file: this.logFile, level: opts.logLevel, stderr: Boolean(opts.debug), base: { session: this.name } });
  }

  async start() {
    if (this.browser) return;
    this.startedAt = new Date();
    await fsp.mkdir(this.shotDir, { recursive: true });
    const args = [];
    if (this.opts.devtools) args.push('--auto-open-devtools-for-tabs');
    if (this.opts.cdpPort) args.push(`--remote-debugging-port=${this.opts.cdpPort}`);
    const launchOpts = { headless: !this.opts.headed, slowMo: this.opts.slowMo || 0, args };
    if (this.opts.browserPath) launchOpts.executablePath = this.opts.browserPath;
    this.log.info('browser.launch', { launchOpts, runDir: this.runDir, platform: os.platform() });
    this.browser = await chromium.launch(launchOpts);
    this.browserVersion = `Chromium ${this.browser.version()}`;
    this.context = await this.browser.newContext({ viewport: this.opts.viewport, locale: this.lang === 'en' ? 'en-US' : 'zh-TW' });
    this.context.setDefaultTimeout(this.opts.timeout);
    if (this.opts.trace) {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: this.name });
      this.log.info('trace.start');
    }
    this.page = await this.context.newPage();
    this._hookPage(this.page);
  }

  _hookPage(page) {
    const push = (entry) => {
      const e = { at: new Date().toISOString(), url: page.url(), ...entry };
      this.console.push(e);
      this.log.log(e.severity === 'error' ? 'warn' : 'debug', 'page.console', e);
    };
    page.on('console', (msg) => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') {
        this.log.debug('page.console', { type, text: msg.text() });
        return;
      }
      const loc = msg.location();
      push({ type, severity: type === 'error' ? 'error' : 'warning', text: msg.text(), location: loc && loc.url ? `${loc.url}:${loc.lineNumber + 1}:${loc.columnNumber + 1}` : '' });
    });
    page.on('pageerror', (err) => {
      push({ type: 'pageerror', severity: 'error', text: `${err.name}: ${err.message}`, location: (err.stack || '').split('\n').slice(1, 2).join('').trim() });
    });
    page.on('requestfailed', (req) => {
      push({ type: 'requestfailed', severity: 'error', text: `${req.method()} ${req.url()} — ${req.failure()?.errorText || 'failed'}`, location: req.url() });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        push({ type: 'http', severity: 'error', text: `HTTP ${res.status()} ${res.request().method()} ${res.url()}`, location: res.url() });
      }
    });
  }

  resolveUrl(url) {
    const base = this.opts.baseUrl;
    if (base && !/^[a-z]+:/i.test(url)) return new URL(url, base.endsWith('/') ? base : base + '/').toString();
    return url;
  }

  /** Run one declarative step and record it. Never throws for assertion failures. */
  async runStep(step) {
    const no = this.steps.length + 1;
    const action = step.action;
    const target = step.selector || step.url || (step.selectors ? step.selectors.join(', ') : '') || '';
    const rec = { no, action, target, args: publicArgs(step), status: 'pass', message: '', durationMs: 0, startedAt: new Date().toISOString(), screenshot: null };
    const t0 = performance.now();
    this.log.info('step.start', { no, action, target });
    try {
      if (action !== 'open' && action !== 'wait' && !this.page) await this.start();
      const r = await this._dispatch(step, rec);
      if (['click', 'fill', 'press'].includes(action)) this.lastInteracted = step.selector;
      rec.status = r.ok ? 'pass' : 'fail';
      rec.message = r.message;
      if (r.data) rec.data = r.data;
      if (r.shot) rec.screenshot = r.shot;
    } catch (err) {
      rec.status = 'fail';
      rec.message = cleanError(err);
      this.log.error('step.exception', { no, action, error: String(err && err.stack || err) });
    }
    rec.durationMs = Math.round(performance.now() - t0);
    // Evidence: annotate the problem element on failure.
    if (rec.status === 'fail' && !rec.screenshot && this.page && step.screenshotOnFail !== false) {
      try {
        let sels = step.selector ? [step.selector] : [];
        let labels;
        // For console errors, highlight the element that was interacted with last (likely culprit).
        if (action === 'check_console_errors' && this.lastInteracted) {
          sels = [this.lastInteracted];
          labels = [`${t(this.lang, 'annot.lastAction')}: ${this.lastInteracted}`];
        }
        const notes = action === 'check_console_errors' ? rec.data?.errors?.slice(0, 6).map((e) => `${e.type}: ${e.text}`) : [];
        const shot = await this.annotate(sels, `#${no} ${t(this.lang, 'report.fail')}: ${rec.message}`, { stepNo: no, action, notes, labels, title: action === 'check_console_errors' ? t(this.lang, 'annot.consoleErrors') : undefined });
        rec.screenshot = shot.rel;
      } catch (e) {
        this.log.warn('step.failShot', { error: String(e) });
      }
    }
    this.steps.push(rec);
    this.log.log(rec.status === 'pass' ? 'info' : 'warn', 'step.end', { no, action, status: rec.status, durationMs: rec.durationMs, message: rec.message });
    return rec;
  }

  async _dispatch(step, rec) {
    const L = this.lang;
    const timeout = step.timeout ?? this.opts.timeout;
    const page = this.page;
    switch (step.action) {
      case 'open': {
        await this.start();
        const url = this.resolveUrl(step.url);
        const resp = await this.page.goto(url, { waitUntil: step.waitUntil || 'load', timeout: Math.max(timeout, 15000) });
        const title = await this.page.title();
        const timing = await this.page.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          if (!n) return null;
          return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
        }).catch(() => null);
        if (timing) this.pageTimings.push({ url, ...timing });
        const status = resp ? resp.status() : 0;
        return { ok: !resp || status < 400, message: t(L, 'msg.opened', { url, status, title }), data: { url, status, title, timing } };
      }
      case 'click': {
        await page.locator(step.selector).first().click({ timeout });
        if (step.waitAfter) await page.waitForTimeout(step.waitAfter);
        else await page.waitForTimeout(100); // let handlers / console errors flush
        return { ok: true, message: t(L, 'msg.clicked', { selector: step.selector }) };
      }
      case 'fill': {
        const text = String(step.text ?? step.value ?? '');
        await page.locator(step.selector).first().fill(text, { timeout });
        return { ok: true, message: t(L, 'msg.filled', { selector: step.selector, length: [...text].length }) };
      }
      case 'press': {
        await page.locator(step.selector).first().press(step.key, { timeout });
        return { ok: true, message: t(L, 'msg.pressed', { selector: step.selector, key: step.key }) };
      }
      case 'wait': {
        const ms = Number(step.ms ?? 500);
        if (page) await page.waitForTimeout(ms);
        else await new Promise((r) => setTimeout(r, ms));
        return { ok: true, message: t(L, 'msg.waited', { ms }) };
      }
      case 'wait_for':
      case 'assert_visible': {
        try {
          await page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
          return { ok: true, message: t(L, 'msg.visible', { selector: step.selector }) };
        } catch {
          return { ok: false, message: t(L, 'msg.notVisible', { selector: step.selector, timeout }) };
        }
      }
      case 'assert_hidden': {
        try {
          await page.locator(step.selector).first().waitFor({ state: 'hidden', timeout });
          return { ok: true, message: t(L, 'msg.hidden', { selector: step.selector }) };
        } catch {
          return { ok: false, message: t(L, 'msg.stillVisible', { selector: step.selector, timeout }) };
        }
      }
      case 'assert_text': {
        const mode = step.mode || (step.exact ? 'equals' : 'contains');
        const expected = String(step.expected ?? '');
        const loc = page.locator(step.selector).first();
        const matches = (actual) => {
          const a = normalizeWs(actual);
          if (mode === 'equals') return a === normalizeWs(expected);
          if (mode === 'regex') return new RegExp(expected).test(actual);
          return a.includes(normalizeWs(expected));
        };
        const deadline = Date.now() + timeout;
        let actual = null;
        for (;;) {
          if ((await loc.count()) > 0) {
            actual = (await loc.innerText({ timeout: 1000 }).catch(() => null)) ?? (await loc.textContent().catch(() => ''));
            if (actual !== null && matches(actual)) {
              return { ok: true, message: t(L, 'msg.textOk', { selector: step.selector, actual: truncate(normalizeWs(actual), 120) }) };
            }
          }
          if (Date.now() >= deadline) break;
          await page.waitForTimeout(150);
        }
        if (actual === null) return { ok: false, message: t(L, 'msg.textNotFound', { selector: step.selector, expected }) };
        return { ok: false, message: t(L, 'msg.textMismatch', { selector: step.selector, expected, actual: truncate(normalizeWs(actual), 120), mode: t(L, `msg.mode.${mode}`) }), data: { expected, actual } };
      }
      case 'check_console_errors': {
        if (step.settleMs !== 0) await page.waitForTimeout(step.settleMs ?? 200);
        const pool = step.all ? this.console : this.console.slice(this.consoleCursor);
        this.consoleCursor = this.console.length;
        const ignore = (step.ignore || []).map((p) => new RegExp(p, 'i'));
        const errors = pool.filter((e) => e.severity === 'error' && !ignore.some((re) => re.test(e.text)));
        const expectNone = step.expectNone !== false;
        if (errors.length === 0) return { ok: true, message: t(L, 'msg.consoleNone'), data: { errors } };
        if (!expectNone) return { ok: true, message: t(L, 'msg.consoleFoundAllowed', { count: errors.length }), data: { errors } };
        return { ok: false, message: t(L, 'msg.consoleFound', { count: errors.length, first: truncate(errors[0].text, 160) }), data: { errors } };
      }
      case 'screenshot_annotate': {
        const sels = step.selectors || (step.selector ? [step.selector] : []);
        const shot = await this.annotate(sels, step.label || '', { stepNo: rec.no, action: 'annotate', fullPage: step.fullPage, labels: step.labels });
        const missing = shot.missing.length ? t(L, 'msg.annotMissing', { count: shot.missing.length, list: shot.missing.join(', ') }) : '';
        // Annotation itself passes; set failOnMissing to treat missing elements as a failure.
        const ok = !(step.failOnMissing && shot.missing.length);
        return { ok, message: t(L, 'msg.annotated', { found: shot.found.length, missing }), shot: shot.rel, data: { found: shot.found, missing: shot.missing, file: shot.file } };
      }
      default:
        return { ok: false, message: t(L, 'msg.unknownAction', { action: step.action }) };
    }
  }

  /**
   * Draw red boxes + labels around every element matched by `selectors`, take a screenshot, remove the overlay.
   * Elements that are missing / hidden are listed in a red banner.
   * @returns {{file:string, rel:string, found:string[], missing:string[]}}
   */
  async annotate(selectors, label, { stepNo, action = 'annotate', fullPage = true, notes = [], title, labels } = {}) {
    if (!this.page) throw new Error(t(this.lang, 'msg.noPage'));
    const page = this.page;
    const boxes = [];
    const found = [];
    const missing = [];
    let idx = 0;
    for (const [i, sel] of selectors.entries()) {
      let count = 0;
      try { count = await page.locator(sel).count(); } catch { count = 0; }
      let any = false;
      for (let k = 0; k < Math.min(count, 10); k++) {
        const box = await page.locator(sel).nth(k).boundingBox({ timeout: 1000 }).catch(() => null);
        if (box && box.width > 0 && box.height > 0) {
          idx++;
          any = true;
          boxes.push({ ...box, idx, label: (labels && labels[i]) || sel });
        }
      }
      (any ? found : missing).push(sel);
    }
    const bannerLines = [];
    if (label) bannerLines.push(label);
    for (const m of missing) bannerLines.push(`${t(this.lang, 'annot.notFound')}: ${m}`);
    for (const n of notes || []) bannerLines.push(n);
    await page.evaluate(({ id, boxes, bannerLines, title }) => {
      document.getElementById(id)?.remove();
      const root = document.createElement('div');
      root.id = id;
      root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      const sx = window.scrollX, sy = window.scrollY;
      for (const b of boxes) {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${b.x + sx - 4}px;top:${b.y + sy - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:3px solid #e60000;box-sizing:border-box;border-radius:3px;box-shadow:0 0 0 2px rgba(255,255,255,.85),0 0 10px rgba(230,0,0,.6);`;
        const tag = document.createElement('div');
        const above = b.y + sy > 24;
        tag.textContent = `${b.idx}. ${b.label}`;
        tag.style.cssText = `position:absolute;left:-3px;${above ? 'bottom:100%;margin-bottom:2px' : 'top:100%;margin-top:2px'};background:#e60000;color:#fff;font:bold 12px/1.4 "Microsoft JhengHei","Noto Sans CJK TC",sans-serif;padding:1px 6px;border-radius:3px;white-space:nowrap;`;
        d.appendChild(tag);
        root.appendChild(d);
      }
      if (bannerLines.length) {
        const ban = document.createElement('div');
        const docW = document.documentElement.scrollWidth;
        root.style.width = docW + 'px';
        const right = Math.max(8, docW - (sx + window.innerWidth) + 8);
        ban.style.cssText = `position:absolute;top:${sy + 8}px;right:${right}px;max-width:46vw;background:rgba(200,0,0,.93);color:#fff;font:13px/1.5 "Microsoft JhengHei","Noto Sans CJK TC",sans-serif;padding:8px 12px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:pre-wrap;word-break:break-word;`;
        ban.textContent = (title ? `【${title}】\n` : '') + bannerLines.join('\n');
        root.appendChild(ban);
      }
      document.documentElement.appendChild(root);
    }, { id: OVERLAY_ID, boxes, bannerLines, title });
    const n = stepNo ?? this.steps.length + 1;
    const fname = `${String(n).padStart(2, '0')}-${slug(action)}-${this.screenshots.length + 1}.png`;
    const file = path.join(this.shotDir, fname);
    try {
      await page.screenshot({ path: file, fullPage: fullPage !== false });
    } finally {
      await page.evaluate((id) => document.getElementById(id)?.remove(), OVERLAY_ID).catch(() => {});
    }
    const rel = `screenshots/${fname}`;
    this.screenshots.push({ file, rel, stepNo: n, label: label || selectors.join(', '), found, missing });
    this.log.info('screenshot', { file, found, missing });
    return { file, rel, found, missing };
  }

  /** Run a list of declarative steps. */
  async runSteps(steps, { stopOnFailure = false, onStep } = {}) {
    let failed = false;
    for (const step of steps) {
      if (failed && stopOnFailure) {
        const rec = { no: this.steps.length + 1, action: step.action, target: step.selector || step.url || '', args: publicArgs(step), status: 'skip', message: t(this.lang, 'msg.skippedAfterFail'), durationMs: 0, startedAt: new Date().toISOString(), screenshot: null };
        this.steps.push(rec);
        if (onStep) await onStep(rec);
        continue;
      }
      const rec = await this.runStep(step);
      if (rec.status === 'fail') failed = true;
      if (onStep) await onStep(rec);
    }
    return this.summary();
  }

  summary() {
    const s = { total: this.steps.length, passed: 0, failed: 0, skipped: 0 };
    for (const r of this.steps) {
      if (r.status === 'pass') s.passed++;
      else if (r.status === 'fail') s.failed++;
      else s.skipped++;
    }
    s.ok = s.failed === 0;
    s.consoleErrors = this.console.filter((e) => e.severity === 'error').length;
    s.durationMs = (this.endedAt || new Date()) - (this.startedAt || new Date());
    return s;
  }

  /** Stop tracing (if any). Safe to call more than once. */
  async stopTrace() {
    if (this.opts.trace && this.context && !this.tracePath) {
      const p = path.join(this.runDir, 'trace.zip');
      await this.context.tracing.stop({ path: p }).catch((e) => this.log.warn('trace.stop', { error: String(e) }));
      this.tracePath = p;
      this.log.info('trace.saved', { path: p });
    }
  }

  async generateReport({ file } = {}) {
    this.endedAt = new Date();
    await fsp.mkdir(this.runDir, { recursive: true });
    const out = file || path.join(this.runDir, 'report.html');
    await writeReport(this, out);
    this.reportPath = out;
    this.log.info('report.written', { path: out });
    await this.log.flush();
    return out;
  }

  async close() {
    await this.stopTrace();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.log.info('browser.closed');
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    await this.log.flush();
  }
}

function publicArgs(step) {
  const a = { ...step };
  delete a.action;
  if (a.secret && a.text !== undefined) a.text = '******';
  return a;
}

function normalizeWs(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function cleanError(err) {
  const m = String(err && err.message ? err.message : err);
  // Playwright messages contain a long "Call log:" section; keep the first lines.
  return m.split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ').replace(/\x1b\[[0-9;]*m/g, '');
}
