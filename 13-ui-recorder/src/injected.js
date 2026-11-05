// In-page recorder. pageRecorder() is serialized with Function.prototype.toString and injected via
// page.addInitScript, so it must be self-contained browser JavaScript (no imports, no outer variables).
// It talks to Node through three bindings created with page.exposeBinding:
//   __uirecEmit(event) -> { count }   one recorded event (click / fill / press / assert / annotate)
//   __uirecState(patch) -> state       read/update shared state (paused, lang) that survives navigations
//   __uirecStop()                      user pressed "Stop & save"

export function pageRecorder(cfg) {
  if (window.top !== window || window.__uirec) return;
  var HOST_ID = '__uirec_root';
  var S = cfg.strings;
  var st = { paused: false, lang: cfg.lang, count: 0, stopped: false };
  var mode = null; // null | 'assert' | 'annotate'
  var picks = [];
  var pending = new Map(); // element -> timer id (debounced fill)
  var lastEnterAt = 0;
  var ui = null;

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function q(s) { return JSON.stringify(s); }
  function tr(key, n) { var v = (S[st.lang] || S.en)[key] || key; return v.replace('{n}', String(n == null ? '' : n)); }
  function isOurs(e) {
    var p = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < p.length; i++) if (p[i] && p[i].id === HOST_ID) return true;
    return false;
  }
  function countCss(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }
  function isTextField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'password', 'email', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].indexOf(t) >= 0;
  }

  // ---------- accessible role / name (simplified ARIA, enough for common controls) ----------
  function roleOf(el) {
    var r = el.getAttribute && el.getAttribute('role');
    if (r) return r.split(' ')[0];
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'IMG' && el.getAttribute('alt')) return 'img';
    if (tag === 'INPUT') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].indexOf(t) >= 0) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (['text', 'email', 'tel', 'url', ''].indexOf(t) >= 0) return 'textbox';
    }
    return null;
  }
  function accName(el) {
    var v = el.getAttribute('aria-label');
    if (v && norm(v)) return norm(v);
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var txt = lb.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.textContent : ''; }).join(' ');
      if (norm(txt)) return norm(txt);
    }
    if (el.labels && el.labels.length) { var l = norm(Array.prototype.map.call(el.labels, function (x) { return x.textContent; }).join(' ')); if (l) return l; }
    if (el.tagName === 'IMG') return norm(el.getAttribute('alt'));
    if (el.tagName === 'INPUT') {
      var t = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'reset'].indexOf(t) >= 0) return norm(el.value);
      if (el.getAttribute('placeholder')) return norm(el.getAttribute('placeholder'));
    }
    if (['BUTTON', 'A', 'SUMMARY'].indexOf(el.tagName) >= 0 || /^H[1-6]$/.test(el.tagName) || el.getAttribute('role')) return norm(el.textContent);
    return norm(el.getAttribute('title'));
  }
  function countRole(role, name) {
    var n = 0;
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) if (roleOf(all[i]) === role && accName(all[i]) === name) n++;
    return n;
  }
  function countText(txt) {
    var n = 0;
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.closest('#' + HOST_ID) || ['SCRIPT', 'STYLE'].indexOf(e.tagName) >= 0) continue;
      if (norm(e.innerText) !== txt) continue;
      var deeper = false;
      for (var k = 0; k < e.children.length; k++) if (norm(e.children[k].innerText) === txt) { deeper = true; break; }
      if (!deeper) n++;
    }
    return n;
  }
  function stableId(id) { return id && !/^\d|\d{4,}|[:\s]|^(ember|react|vue|mui|radix)/i.test(id); }

  // Candidate selectors in priority order. Node verifies each with page.locator(sel).count().
  function candidates(el) {
    var out = [];
    var tag = el.tagName.toLowerCase();
    if (stableId(el.id)) { var s1 = '#' + CSS.escape(el.id); out.push({ kind: 'id', sel: s1, unique: countCss(s1) === 1 }); }
    ['data-testid', 'data-test-id', 'data-test', 'data-cy'].forEach(function (a) {
      var v = el.getAttribute(a);
      if (v) { var s = '[' + a + '=' + q(v) + ']'; out.push({ kind: 'testid', sel: s, unique: countCss(s) === 1 }); }
    });
    var nm = el.getAttribute('name');
    if (nm) { var s2 = tag + '[name=' + q(nm) + ']'; out.push({ kind: 'name', sel: s2, unique: countCss(s2) === 1 }); }
    var role = roleOf(el);
    var an = role ? accName(el) : '';
    if (role && an && an.length <= 80) out.push({ kind: 'role', sel: 'role=' + role + '[name=' + q(an) + ']', unique: countRole(role, an) === 1 });
    var txt = norm(el.innerText);
    if (txt && txt.length <= 40 && !isTextField(el)) out.push({ kind: 'text', sel: 'text=' + q(txt), unique: countText(txt) === 1 });
    out.push({ kind: 'css', sel: cssPath(el), unique: true });
    return out;
  }
  function cssPath(el) {
    var parts = [];
    var cur = el;
    for (var depth = 0; cur && cur.nodeType === 1 && depth < 8; depth++) {
      if (cur !== el && stableId(cur.id) && countCss('#' + CSS.escape(cur.id)) === 1) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      var tag = cur.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
      var part = tag;
      var cls = Array.prototype.filter.call(cur.classList || [], function (c) { return /^[a-zA-Z][\w-]{1,30}$/.test(c) && !/\d{3,}|^(css|sc|jsx)-/.test(c); })[0];
      if (cls) part += '.' + CSS.escape(cls);
      var p = cur.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === cur.tagName; });
        var sameCls = cls ? same.filter(function (c) { return c.classList.contains(cls); }) : same;
        if (sameCls.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (countCss(parts.join(' > ')) === 1 && parts.length >= 2) break;
      cur = p;
    }
    return parts.join(' > ');
  }
  function clickTarget(el) {
    var c = el.closest && el.closest('button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],input,select,textarea,summary,label');
    return c || el;
  }
  function shortText(el) {
    var v = isTextField(el) ? (el.getAttribute('placeholder') || el.name || el.id) : el.innerText;
    v = norm(v);
    return v.length > 30 ? v.slice(0, 29) + '…' : v;
  }

  // ---------- emit ----------
  function emit(ev) {
    if (typeof window.__uirecEmit !== 'function') return Promise.resolve();
    ev.url = location.href;
    return window.__uirecEmit(ev).then(function (r) { if (r && typeof r.count === 'number') { st.count = r.count; render(); } }, function () {});
  }
  function flushEl(el) {
    var tm = pending.get(el);
    if (tm === undefined) return Promise.resolve();
    clearTimeout(tm);
    pending.delete(el);
    if (!el.isConnected && !el.value) return Promise.resolve();
    return emit({ type: 'fill', cands: candidates(el), text: el.value, secret: (el.getAttribute('type') || '').toLowerCase() === 'password' });
  }
  function flushAll() {
    var ps = [];
    Array.from(pending.keys()).forEach(function (el) { ps.push(flushEl(el)); });
    return Promise.all(ps);
  }

  // ---------- event capture (window, capture phase, so page handlers cannot hide events) ----------
  window.addEventListener('click', function (e) {
    if (isOurs(e) || st.stopped) return;
    if (mode) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      pick(e.target);
      return;
    }
    if (st.paused) return;
    var el = clickTarget(e.target);
    if (el.tagName === 'LABEL' && el.control) return; // the browser re-dispatches the click on the control
    if (isTextField(el) || el.tagName === 'SELECT') return; // focusing a field: the fill step covers it
    if (e.detail === 0 && Date.now() - lastEnterAt < 300) return; // implicit form submission after Enter
    var cands = candidates(el);
    flushAll().then(function () { return emit({ type: 'click', cands: cands }); });
  }, true);
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit'].forEach(function (type) {
    window.addEventListener(type, function (e) { if (mode && !isOurs(e)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } }, true);
  });
  window.addEventListener('input', function (e) {
    if (isOurs(e) || st.stopped || st.paused || mode) return;
    var el = e.target;
    if (!isTextField(el)) return;
    if (pending.has(el)) clearTimeout(pending.get(el));
    pending.set(el, setTimeout(function () { flushEl(el); }, cfg.debounceMs));
  }, true);
  window.addEventListener('change', function (e) {
    if (isOurs(e) || st.stopped || st.paused || mode) return;
    if (isTextField(e.target)) flushEl(e.target);
  }, true);
  window.addEventListener('keydown', function (e) {
    if (isOurs(e) || st.stopped || st.paused || mode) return;
    if (e.key !== 'Enter' || e.isComposing) return; // Enter that commits an IME composition is not a press
    var el = e.target;
    if (!el || !el.tagName || el.tagName === 'TEXTAREA' || !(isTextField(el) || roleOf(el))) return;
    lastEnterAt = Date.now();
    var cands = candidates(el);
    flushEl(el).then(function () { return emit({ type: 'press', key: 'Enter', cands: cands }); });
  }, true);
  window.addEventListener('pagehide', function () { flushAll(); });
  document.addEventListener('mouseover', function (e) {
    if (!mode || !ui || isOurs(e)) return;
    var r = e.target.getBoundingClientRect();
    var hl = ui.hl.style;
    hl.display = 'block'; hl.left = r.left + 'px'; hl.top = r.top + 'px'; hl.width = r.width + 'px'; hl.height = r.height + 'px';
  }, true);

  function pick(el) {
    if (mode === 'assert') {
      var text = norm(el.innerText);
      if (text.length > 100) text = text.slice(0, 100);
      emit({ type: 'assert', cands: candidates(el), text: isTextField(el) ? '' : text });
      setMode(null);
    } else if (mode === 'annotate') {
      picks.push({ cands: candidates(el), label: shortText(el), el: el, prev: el.style.outline });
      el.style.outline = '3px solid #d32f2f';
      render();
    }
  }
  function setMode(m) {
    if (mode === 'annotate' && m !== 'annotate' && picks.length) {
      var items = picks.map(function (p) { p.el.style.outline = p.prev; return { cands: p.cands, label: p.label }; });
      picks = [];
      emit({ type: 'annotate', items: items, label: tr('annotLabel') });
    }
    mode = m;
    if (ui && !m) ui.hl.style.display = 'none';
    render();
  }

  // ---------- toolbar (shadow DOM, excluded from recording) ----------
  function build() {
    if (ui || !document.body) return;
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-uirec', 'toolbar');
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      ':host{all:initial}' +
      '.bar{position:fixed;right:8px;bottom:8px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-width:calc(100vw - 16px);box-sizing:border-box;' +
      'background:#1d2330;color:#fff;font:13px/1.3 "Segoe UI","Microsoft JhengHei","Noto Sans CJK TC",sans-serif;padding:6px 8px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
      'button{font:inherit;border:0;border-radius:5px;padding:4px 8px;cursor:pointer;background:#3a4256;color:#fff}' +
      'button.on{background:#f9a825;color:#000}button[data-uirec-act=stop]{background:#c62828}' +
      '.st{padding:0 4px;white-space:nowrap}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e53935;margin-right:4px}.paused .dot{background:#9e9e9e}' +
      '.hl{position:fixed;pointer-events:none;border:2px dashed #f9a825;background:rgba(249,168,37,.12);z-index:2147483646;display:none}' +
      '</style><div class="hl"></div><div class="bar" role="toolbar">' +
      '<span class="st"><span class="dot"></span><b data-uirec-part="title"></b> <span data-uirec-part="status"></span></span>' +
      '<button data-uirec-act="toggle"></button><button data-uirec-act="assert"></button><button data-uirec-act="annotate"></button>' +
      '<button data-uirec-act="stop"></button><button data-uirec-act="lang"></button></div>';
    ui = { host: host, root: root, bar: root.querySelector('.bar'), hl: root.querySelector('.hl') };
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || st.stopped) return;
      var act = b.getAttribute('data-uirec-act');
      if (act === 'toggle') { st.paused = !st.paused; setMode(null); sync({ paused: st.paused }); }
      else if (act === 'assert') setMode(mode === 'assert' ? null : 'assert');
      else if (act === 'annotate') setMode(mode === 'annotate' ? null : 'annotate');
      else if (act === 'lang') { st.lang = st.lang === 'en' ? 'zh-TW' : 'en'; sync({ lang: st.lang }); }
      else if (act === 'stop') {
        setMode(null);
        flushAll().then(function () { st.stopped = true; render(); if (window.__uirecStop) window.__uirecStop(); });
      }
      render();
    });
    document.documentElement.appendChild(host);
    render();
  }
  function render() {
    if (!ui) return;
    var r = ui.root;
    r.querySelector('[data-uirec-part=title]').textContent = tr('title');
    r.querySelector('[data-uirec-part=status]').textContent = st.stopped ? tr('saved') : (st.paused ? tr('paused') : tr('recording')) + ' · ' + tr('steps', st.count);
    ui.bar.classList.toggle('paused', st.paused || st.stopped);
    r.querySelector('[data-uirec-act=toggle]').textContent = st.paused ? tr('resume') : tr('pause');
    var a = r.querySelector('[data-uirec-act=assert]');
    a.textContent = mode === 'assert' ? tr('assertOn') : tr('assert');
    a.classList.toggle('on', mode === 'assert');
    var n = r.querySelector('[data-uirec-act=annotate]');
    n.textContent = mode === 'annotate' ? tr('annotateOn', picks.length) : tr('annotate');
    n.classList.toggle('on', mode === 'annotate');
    r.querySelector('[data-uirec-act=stop]').textContent = tr('stop');
    r.querySelector('[data-uirec-act=lang]').textContent = tr('lang');
    ui.host.setAttribute('lang', st.lang);
  }
  function sync(patch) {
    if (typeof window.__uirecState === 'function') window.__uirecState(patch).then(function (s) { if (s) { st.paused = s.paused; st.lang = s.lang; st.count = s.count; render(); } }, function () {});
  }

  window.__uirec = { flush: flushAll, state: function () { return { paused: st.paused, lang: st.lang, mode: mode, count: st.count }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  sync({});
}
