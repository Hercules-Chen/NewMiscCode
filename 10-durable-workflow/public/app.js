/* Durable Workflow dashboard - vanilla JS, no build step. */
(function () {
  'use strict';
  var I18N = {
    'zh-TW': {
      appTitle: 'Durable Workflow 儀表板', navRuns: '執行清單', navDebug: '除錯', autoRefresh: '自動更新',
      runs: '工作流程執行 (Runs)', all: '全部', status: '狀態', workflow: '工作流程', created: '建立時間', updated: '更新時間', id: 'Run ID',
      noRuns: '目前沒有執行紀錄。用右側表單啟動一個示範流程。', startNew: '啟動新的執行', input: '輸入 (JSON)', runIdOpt: 'Run ID（選填）', start: '啟動',
      back: '← 回清單', summary: '摘要', result: '結果', error: '錯誤', waitingOn: '等待中', timeline: '事件歷程 (History)', timers: '計時器', signals: '訊號',
      none: '（無）', sendSignal: '送出訊號', signalName: '訊號名稱', payload: '內容 (JSON)', send: '送出', cancel: '取消執行', retry: '以相同輸入重試',
      approve: '核准', reject: '駁回', confirmCancel: '確定要取消這個執行？', started: '已啟動', signalSent: '訊號已送出', cancelReq: '已要求取消', retried: '已建立重試執行',
      ndTitle: '偵測到非決定性 (Non-determinism)', ndBody: '重播 (replay) 時程式碼呼叫的步驟與歷程記錄不一致，通常是流程程式碼在執行途中被修改。請改用 ctx.patched() 或新的工作流程版本。',
      codeChanged: '注意：此執行開始後，工作流程程式碼已變更（code hash 不同）。重播時若步驟順序不同將會失敗。', version: '版本', codeHash: '程式碼雜湊',
      kind: '種類', fireAt: '觸發時間', name: '名稱', seq: 'seq', time: '時間', data: '資料', task: '工作佇列', leaseOwner: '租約持有者', visibleAt: '可見時間',
      logs: '最近日誌（伺服器程序）', level: '等級', workers: 'Worker', heartbeat: '心跳', pendingTimers: '待觸發計時器', host: '主機', stoppedAt: '已停止',
      'st-pending': '等待排程', 'st-running': '執行中', 'st-waiting': '等待中', 'st-completed': '已完成', 'st-failed': '失敗', 'st-cancelled': '已取消',
      'k-timer': '計時器', 'k-signal': '訊號', 'k-retry': '重試退避', untilTime: '直到', badJson: 'JSON 格式錯誤', notFound: '找不到此執行', loading: '載入中…',
      'theme-auto': '主題：自動', 'theme-light': '主題：淺色', 'theme-dark': '主題：深色',
      debugHint: '提示：伺服器加上 --debug 會輸出 debug 等級日誌；完整 JSONL 日誌在 logs 資料夾。瀏覽器 DevTools 隨時可開。', retryOf: '重試自'
    },
    en: {
      appTitle: 'Durable Workflow Dashboard', navRuns: 'Runs', navDebug: 'Debug', autoRefresh: 'Auto refresh',
      runs: 'Workflow runs', all: 'All', status: 'Status', workflow: 'Workflow', created: 'Created', updated: 'Updated', id: 'Run ID',
      noRuns: 'No runs yet. Use the form to start a demo workflow.', startNew: 'Start a new run', input: 'Input (JSON)', runIdOpt: 'Run ID (optional)', start: 'Start',
      back: '← Back to runs', summary: 'Summary', result: 'Result', error: 'Error', waitingOn: 'Waiting on', timeline: 'Event history', timers: 'Timers', signals: 'Signals',
      none: '(none)', sendSignal: 'Send signal', signalName: 'Signal name', payload: 'Payload (JSON)', send: 'Send', cancel: 'Cancel run', retry: 'Retry with same input',
      approve: 'Approve', reject: 'Reject', confirmCancel: 'Cancel this run?', started: 'Started', signalSent: 'Signal sent', cancelReq: 'Cancellation requested', retried: 'Retry run created',
      ndTitle: 'Non-determinism detected', ndBody: 'During replay the workflow code issued commands that do not match the recorded history - usually the code was changed while runs were in flight. Use ctx.patched() or a new workflow version.',
      codeChanged: 'Note: the workflow code changed since this run started (different code hash). Replay fails if the command order differs.', version: 'Version', codeHash: 'Code hash',
      kind: 'Kind', fireAt: 'Fires at', name: 'Name', seq: 'seq', time: 'Time', data: 'Data', task: 'Task queue', leaseOwner: 'Lease owner', visibleAt: 'Visible at',
      logs: 'Recent logs (server process)', level: 'Level', workers: 'Workers', heartbeat: 'Heartbeat', pendingTimers: 'Pending timers', host: 'Host', stoppedAt: 'Stopped',
      'st-pending': 'pending', 'st-running': 'running', 'st-waiting': 'waiting', 'st-completed': 'completed', 'st-failed': 'failed', 'st-cancelled': 'cancelled',
      'k-timer': 'timer', 'k-signal': 'signal', 'k-retry': 'retry backoff', untilTime: 'until', badJson: 'Invalid JSON', notFound: 'Run not found', loading: 'Loading…',
      'theme-auto': 'Theme: auto', 'theme-light': 'Theme: light', 'theme-dark': 'Theme: dark',
      debugHint: 'Tip: start the server with --debug for debug-level logs; full JSONL logs are in the logs folder. Browser DevTools are never blocked.', retryOf: 'Retry of'
    }
  };
  var STATUSES = ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'];
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  var qs = new URLSearchParams(location.search);
  var state = { lang: qs.get('lang') || store.get('wf.lang', 'zh-TW'), theme: store.get('wf.theme', 'auto'), filter: store.get('wf.filter', ''), workflows: [], timer: null, debug: qs.get('debug') === '1' };
  if (!I18N[state.lang]) state.lang = 'zh-TW';
  var app = document.getElementById('app');

  function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || I18N['zh-TW'][k] || k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(ts) { if (!ts) return '-'; var d = new Date(ts); return d.toLocaleString(state.lang === 'en' ? 'en-US' : 'zh-TW', { hour12: false }); }
  function fmtShort(ts) { var d = new Date(ts); return d.toLocaleTimeString(state.lang === 'en' ? 'en-US' : 'zh-TW', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
  function badge(s) { return '<span class="badge st-' + esc(s) + '" data-status="' + esc(s) + '">' + esc(t('st-' + s)) + '</span>'; }
  function json(v) { return esc(JSON.stringify(v, null, 2)); }
  function dbg() { if (state.debug) console.debug.apply(console, ['[wf]'].concat([].slice.call(arguments))); }
  function toast(msg) { var el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('show'); }, 2200); }

  function api(method, path, body) {
    dbg(method, path, body);
    return fetch(path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || r.statusText); e.status = r.status; throw e; } return j; }); });
  }

  function applyChrome() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-TW';
    if (state.theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', state.theme);
    document.getElementById('langBtn').textContent = state.lang === 'en' ? '中文' : 'EN';
    document.getElementById('themeBtn').textContent = t('theme-' + state.theme);
    document.getElementById('themeBtn').title = 'theme: ' + state.theme;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('appTitle');
  }

  // ---------------- views ----------------
  function route() {
    var h = location.hash || '#/';
    document.querySelectorAll('.views a').forEach(function (a) { a.classList.toggle('active', (h.indexOf('#/debug') === 0) === (a.getAttribute('data-view') === 'debug')); });
    if (h.indexOf('#/run/') === 0) return { view: 'run', id: decodeURIComponent(h.slice(6)) };
    if (h.indexOf('#/debug') === 0) return { view: 'debug' };
    return { view: 'runs' };
  }

  function render(full) {
    var r = route();
    var p = r.view === 'run' ? renderRun(r.id, full) : r.view === 'debug' ? renderDebug() : renderRuns(full);
    return p.catch(function (e) { app.innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; });
  }

  function renderRuns(full) {
    var q = state.filter ? '?status=' + encodeURIComponent(state.filter) : '';
    return Promise.all([api('GET', '/api/runs' + q), api('GET', '/api/stats')]).then(function (res) {
      var runs = res[0], stats = res[1].byStatus || {};
      var total = Object.keys(stats).reduce(function (a, k) { return a + stats[k]; }, 0);
      var chips = '<button type="button" class="chip' + (state.filter ? '' : ' active') + '" data-filter="">' + esc(t('all')) + ' ' + total + '</button>' +
        STATUSES.map(function (s) { return '<button type="button" class="chip' + (state.filter === s ? ' active' : '') + '" data-filter="' + s + '" data-testid="filter-' + s + '">' + esc(t('st-' + s)) + ' ' + (stats[s] || 0) + '</button>'; }).join('');
      var rows = runs.map(function (r) {
        return '<tr class="clickable" data-run="' + esc(r.id) + '" data-testid="run-row"><td class="mono break">' + esc(r.id) + '</td><td>' + esc(r.workflow) + '</td><td>' + badge(r.status) + '</td><td class="hide-sm small">' + esc(fmt(r.created_at)) + '</td><td class="hide-sm small">' + esc(fmt(r.updated_at)) + '</td></tr>';
      }).join('');
      var listHtml = '<section class="card" data-testid="runs-card"><h2>' + esc(t('runs')) + '</h2><div class="chips" style="margin-bottom:8px">' + chips + '</div>' +
        (runs.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('id')) + '</th><th>' + esc(t('workflow')) + '</th><th>' + esc(t('status')) + '</th><th class="hide-sm">' + esc(t('created')) + '</th><th class="hide-sm">' + esc(t('updated')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">' + esc(t('noRuns')) + '</p>') + '</section>';
      var startCard = document.getElementById('startCard');
      if (full || !startCard) {
        var opts = state.workflows.map(function (w) { return '<option value="' + esc(w.name) + '">' + esc(w.name + ' - ' + ((w.title && w.title[state.lang]) || '')) + '</option>'; }).join('');
        app.innerHTML = '<div class="grid2 wide-left"><div id="listHost"></div><section class="card" id="startCard"><h2>' + esc(t('startNew')) + '</h2><form id="startForm" class="form-grid">' +
          '<label>' + esc(t('workflow')) + '<select id="wfSel" data-testid="start-workflow">' + opts + '</select></label>' +
          '<label>' + esc(t('input')) + '<textarea id="wfInput" rows="9" data-testid="start-input"></textarea></label>' +
          '<label>' + esc(t('runIdOpt')) + '<input id="wfRunId" placeholder="order-001"></label>' +
          '<div class="row"><button class="primary" type="submit" data-testid="start-btn">' + esc(t('start')) + '</button></div></form></section></div>';
        var sel = document.getElementById('wfSel');
        var fill = function () { var w = state.workflows.filter(function (x) { return x.name === sel.value; })[0]; document.getElementById('wfInput').value = JSON.stringify(w ? w.sampleInput : {}, null, 2); };
        sel.addEventListener('change', fill); fill();
        document.getElementById('startForm').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var input; try { input = JSON.parse(document.getElementById('wfInput').value || '{}'); } catch (e) { return toast(t('badJson')); }
          api('POST', '/api/runs', { workflow: sel.value, input: input, runId: document.getElementById('wfRunId').value.trim() || undefined })
            .then(function (run) { toast(t('started') + ': ' + run.id); location.hash = '#/run/' + encodeURIComponent(run.id); })
            .catch(function (e) { toast(e.message); });
        });
      }
      document.getElementById('listHost').innerHTML = listHtml;
      document.querySelectorAll('[data-filter]').forEach(function (b) { b.addEventListener('click', function () { state.filter = b.getAttribute('data-filter'); store.set('wf.filter', state.filter); render(); }); });
      document.querySelectorAll('tr[data-run]').forEach(function (tr) { tr.addEventListener('click', function () { location.hash = '#/run/' + encodeURIComponent(tr.getAttribute('data-run')); }); });
    });
  }

  function evClass(type) {
    if (/Completed|Received|Fired|WorkflowStarted/.test(type)) return 'ev-ok';
    if (/Failed|Cancel/.test(type)) return /AttemptFailed/.test(type) ? 'ev-warn' : 'ev-err';
    if (/TimedOut/.test(type)) return 'ev-warn';
    if (/WaitStarted|TimerStarted/.test(type)) return 'ev-wait';
    return 'ev-info';
  }

  function waitText(w) {
    return t('k-' + w.kind) + (w.name ? ' "' + w.name + '"' : '') + ' (seq ' + w.seq + ')' + (w.until ? ' ' + t('untilTime') + ' ' + fmt(w.until) : '');
  }

  function renderRun(id, full) {
    return api('GET', '/api/runs/' + encodeURIComponent(id)).then(function (d) {
      var r = d.run;
      var def = state.workflows.filter(function (w) { return w.name === r.workflow; })[0] || {};
      var terminal = ['completed', 'failed', 'cancelled'].indexOf(r.status) >= 0;
      var nd = r.error && r.error.name === 'NonDeterminismError';
      var sigNames = (def.signals && def.signals.length ? def.signals : []).concat((r.waiting_on || []).filter(function (w) { return w.kind === 'signal'; }).map(function (w) { return w.name; }));
      sigNames = sigNames.filter(function (n, i) { return sigNames.indexOf(n) === i; });
      var html = '<p><a href="#/" data-testid="back">' + esc(t('back')) + '</a></p>';
      if (nd) html += '<div class="banner" data-testid="nd-banner"><b>' + esc(t('ndTitle')) + '</b><br>' + esc(t('ndBody')) + '<pre>' + esc(r.error.message) + '</pre></div>';
      else if (d.codeChanged && !terminal) html += '<div class="banner warn">' + esc(t('codeChanged')) + '</div>';
      html += '<div class="grid2"><div>';
      html += '<section class="card"><h2>' + esc(t('summary')) + '</h2><dl class="kv">' +
        '<dt>' + esc(t('id')) + '</dt><dd class="mono" data-testid="run-id">' + esc(r.id) + '</dd>' +
        '<dt>' + esc(t('workflow')) + '</dt><dd>' + esc(r.workflow) + ' <span class="muted">' + esc(t('version')) + ' ' + esc(r.version) + ' · ' + esc(t('codeHash')) + ' ' + esc(r.code_hash) + '</span></dd>' +
        '<dt>' + esc(t('status')) + '</dt><dd data-testid="run-status">' + badge(r.status) + (r.cancel_requested && !terminal ? ' <span class="muted">(cancel requested)</span>' : '') + '</dd>' +
        '<dt>' + esc(t('created')) + '</dt><dd>' + esc(fmt(r.created_at)) + '</dd>' +
        '<dt>' + esc(t('updated')) + '</dt><dd>' + esc(fmt(r.updated_at)) + '</dd>' +
        (r.retry_of ? '<dt>' + esc(t('retryOf')) + '</dt><dd><a href="#/run/' + encodeURIComponent(r.retry_of) + '">' + esc(r.retry_of) + '</a></dd>' : '') +
        (r.waiting_on && r.waiting_on.length ? '<dt>' + esc(t('waitingOn')) + '</dt><dd data-testid="waiting-on">' + r.waiting_on.map(function (w) { return esc(waitText(w)); }).join('<br>') + '</dd>' : '') +
        '</dl>' +
        '<details><summary class="muted small">' + esc(t('input')) + '</summary><pre>' + json(r.input) + '</pre></details>' +
        (r.result !== undefined && r.result !== null ? '<h2 style="margin-top:10px">' + esc(t('result')) + '</h2><pre data-testid="run-result">' + json(r.result) + '</pre>' : '') +
        (r.error ? '<h2 style="margin-top:10px">' + esc(t('error')) + '</h2><pre>' + esc(r.error.name + ': ' + r.error.message) + '</pre>' : '') +
        '<div class="row" style="margin-top:10px">' +
        (!terminal ? '<button type="button" class="danger" id="cancelBtn" data-testid="cancel-btn">' + esc(t('cancel')) + '</button>' : '') +
        (terminal ? '<button type="button" id="retryBtn" data-testid="retry-btn">' + esc(t('retry')) + '</button>' : '') +
        '</div></section>';
      if (!terminal) {
        var isApproval = sigNames.indexOf('approval') >= 0;
        html += '<section class="card" id="signalCard"><h2>' + esc(t('sendSignal')) + '</h2>' +
          (isApproval ? '<div class="row" style="margin-bottom:8px"><button type="button" class="ok" id="approveBtn" data-testid="approve-btn">✔ ' + esc(t('approve')) + '</button><button type="button" class="danger" id="rejectBtn" data-testid="reject-btn">✖ ' + esc(t('reject')) + '</button></div>' : '') +
          '<form id="sigForm" class="form-grid"><label>' + esc(t('signalName')) + '<input id="sigName" list="sigList" value="' + esc(sigNames[0] || '') + '" data-testid="signal-name"></label>' +
          '<datalist id="sigList">' + sigNames.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
          '<label>' + esc(t('payload')) + '<textarea id="sigPayload" rows="3" data-testid="signal-payload">{}</textarea></label>' +
          '<div class="row"><button class="primary" type="submit" data-testid="signal-send">' + esc(t('send')) + '</button></div></form></section>';
      }
      var timerRows = d.timers.map(function (x) { return '<tr><td>' + x.seq + '</td><td>' + esc(x.kind) + '</td><td class="small">' + esc(fmt(x.fire_at)) + '</td><td>' + esc(x.status) + '</td></tr>'; }).join('');
      var sigRows = d.signals.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="mono small break">' + esc(JSON.stringify(x.payload)) + '</td><td>' + esc(x.status) + (x.consumed_seq ? ' (seq ' + x.consumed_seq + ')' : '') + '</td></tr>'; }).join('');
      html += '<section class="card" data-testid="timers-card"><h2>' + esc(t('timers')) + '</h2>' + (timerRows ? '<div class="table-wrap"><table><thead><tr><th>seq</th><th>' + esc(t('kind')) + '</th><th>' + esc(t('fireAt')) + '</th><th>' + esc(t('status')) + '</th></tr></thead><tbody>' + timerRows + '</tbody></table></div>' : '<p class="muted">' + esc(t('none')) + '</p>') + '</section>';
      html += '<section class="card" data-testid="signals-card"><h2>' + esc(t('signals')) + '</h2>' + (sigRows ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('name')) + '</th><th>' + esc(t('payload')) + '</th><th>' + esc(t('status')) + '</th></tr></thead><tbody>' + sigRows + '</tbody></table></div>' : '<p class="muted">' + esc(t('none')) + '</p>') + '</section>';
      if (d.task) html += '<section class="card"><h2>' + esc(t('task')) + '</h2><dl class="kv small"><dt>' + esc(t('visibleAt')) + '</dt><dd>' + esc(fmt(d.task.visible_at)) + '</dd><dt>' + esc(t('leaseOwner')) + '</dt><dd class="mono break">' + esc(d.task.lease_owner || '-') + '</dd><dt>attempts</dt><dd>' + d.task.attempts + '</dd></dl></section>';
      html += '</div><section class="card" data-testid="timeline"><h2>' + esc(t('timeline')) + ' <span class="muted small">(' + d.events.length + ')</span></h2><ol class="timeline">' +
        d.events.map(function (e) {
          var data = e.data && Object.keys(e.data).length ? '<details><summary>' + esc(t('data')) + '</summary><pre>' + json(e.data) + '</pre></details>' : '';
          return '<li class="' + evClass(e.type) + '" data-testid="event" data-type="' + esc(e.type) + '"><div class="ev-head"><span class="ev-type">' + esc(e.type) + '</span>' + (e.name ? '<span class="mono">' + esc(e.name) + '</span>' : '') + '<span class="muted small">seq ' + (e.seq == null ? '-' : e.seq) + ' · #' + e.id + ' · ' + esc(fmtShort(e.ts)) + '</span></div>' + data + '</li>';
        }).join('') + '</ol></section></div>';
      // keep form state while auto-refreshing
      var keepName = document.getElementById('sigName'), keepPayload = document.getElementById('sigPayload');
      var saved = keepName && !full ? { n: keepName.value, p: keepPayload.value, focus: document.activeElement && document.activeElement.id } : null;
      app.innerHTML = html;
      if (saved && document.getElementById('sigName')) { document.getElementById('sigName').value = saved.n; document.getElementById('sigPayload').value = saved.p; if (saved.focus && document.getElementById(saved.focus)) document.getElementById(saved.focus).focus(); }
      var after = function (msg) { return function () { toast(msg); render(true); }; };
      var fail = function (e) { toast(e.message); };
      var sendSig = function (name, payload) { return api('POST', '/api/runs/' + encodeURIComponent(r.id) + '/signal', { name: name, payload: payload }).then(after(t('signalSent'))).catch(fail); };
      var el;
      if ((el = document.getElementById('approveBtn'))) el.addEventListener('click', function () { sendSig('approval', { approved: true, by: 'dashboard', comment: t('approve') }); });
      if ((el = document.getElementById('rejectBtn'))) el.addEventListener('click', function () { sendSig('approval', { approved: false, by: 'dashboard', comment: t('reject') }); });
      if ((el = document.getElementById('sigForm'))) el.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var payload; try { payload = JSON.parse(document.getElementById('sigPayload').value || 'null'); } catch (e) { return toast(t('badJson')); }
        sendSig(document.getElementById('sigName').value.trim(), payload);
      });
      if ((el = document.getElementById('cancelBtn'))) el.addEventListener('click', function () { if (confirm(t('confirmCancel'))) api('POST', '/api/runs/' + encodeURIComponent(r.id) + '/cancel').then(after(t('cancelReq'))).catch(fail); });
      if ((el = document.getElementById('retryBtn'))) el.addEventListener('click', function () { api('POST', '/api/runs/' + encodeURIComponent(r.id) + '/retry').then(function (nr) { toast(t('retried')); location.hash = '#/run/' + encodeURIComponent(nr.id); }).catch(fail); });
    }, function (e) {
      if (e.status === 404) { app.innerHTML = '<p><a href="#/">' + esc(t('back')) + '</a></p><div class="banner">' + esc(t('notFound')) + ': ' + esc(id) + '</div>'; return; }
      throw e;
    });
  }

  function renderDebug() {
    var lv = state.logLevel || '';
    return Promise.all([api('GET', '/api/logs?limit=200' + (lv ? '&level=' + lv : '')), api('GET', '/api/stats')]).then(function (res) {
      var logs = res[0].slice().reverse(), st = res[1];
      var workers = (st.workers || []).map(function (w) { return '<tr><td class="mono break">' + esc(w.id) + '<div class="muted small">' + esc((w.workflows || []).join(', ')) + '</div></td><td>' + esc(w.pid) + '</td><td class="small">' + esc(fmt(w.heartbeat_at)) + '</td><td class="small">' + esc(w.stopped_at ? fmt(w.stopped_at) : '-') + '</td></tr>'; }).join('');
      var timers = (st.pendingTimers || []).map(function (x) { return '<tr><td class="mono break"><a href="#/run/' + encodeURIComponent(x.run_id) + '">' + esc(x.run_id) + '</a></td><td>' + x.seq + '</td><td>' + esc(x.kind) + '</td><td class="small">' + esc(fmt(x.fire_at)) + '</td></tr>'; }).join('');
      app.innerHTML = '<p class="muted small">' + esc(t('debugHint')) + '</p><div class="grid2"><div>' +
        '<section class="card"><h2>' + esc(t('workers')) + '</h2><div class="table-wrap"><table><thead><tr><th>id</th><th>pid</th><th>' + esc(t('heartbeat')) + '</th><th>' + esc(t('stoppedAt')) + '</th></tr></thead><tbody>' + workers + '</tbody></table></div></section>' +
        '<section class="card"><h2>' + esc(t('pendingTimers')) + '</h2>' + (timers ? '<div class="table-wrap"><table><thead><tr><th>run</th><th>seq</th><th>' + esc(t('kind')) + '</th><th>' + esc(t('fireAt')) + '</th></tr></thead><tbody>' + timers + '</tbody></table></div>' : '<p class="muted">' + esc(t('none')) + '</p>') + '</section>' +
        '<section class="card"><h2>stats</h2><pre>' + json({ byStatus: st.byStatus, tasks: st.tasks, embeddedWorker: st.embeddedWorker }) + '</pre></section></div>' +
        '<section class="card" data-testid="logs-card"><h2>' + esc(t('logs')) + '</h2><div class="row" style="margin-bottom:6px"><label class="small muted">' + esc(t('level')) + ' <select id="lvSel"><option value="">*</option><option>debug</option><option>info</option><option>warn</option><option>error</option></select></label></div>' +
        logs.map(function (l) {
          var extra = Object.keys(l).filter(function (k) { return ['ts', 'level', 'msg', 'comp', 'pid'].indexOf(k) < 0; }).reduce(function (o, k) { o[k] = l[k]; return o; }, {});
          return '<div class="log-line lv-' + esc(l.level) + '">' + esc(l.ts.slice(11, 23) + ' ' + l.level.toUpperCase() + ' [' + l.comp + '] ' + l.msg) + (Object.keys(extra).length ? ' <span class="muted">' + esc(JSON.stringify(extra)) + '</span>' : '') + '</div>';
        }).join('') + '</section></div>';
      var sel = document.getElementById('lvSel'); sel.value = lv;
      sel.addEventListener('change', function () { state.logLevel = sel.value; render(); });
    });
  }

  // ---------------- boot ----------------
  document.getElementById('langBtn').addEventListener('click', function () { state.lang = state.lang === 'en' ? 'zh-TW' : 'en'; store.set('wf.lang', state.lang); applyChrome(); render(true); });
  document.getElementById('themeBtn').addEventListener('click', function () { state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme] || 'auto'; store.set('wf.theme', state.theme); applyChrome(); });
  window.addEventListener('hashchange', function () { render(true); });
  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      var busy = document.activeElement && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.id !== 'autoRefresh';
      var p = document.getElementById('autoRefresh').checked && !busy && !document.hidden ? render(false) : Promise.resolve();
      p.then(schedule, schedule);
    }, 1500);
  }
  applyChrome();
  api('GET', '/api/workflows').then(function (w) { state.workflows = w; }, function () { state.workflows = []; }).then(function () { return render(true); }).then(schedule);
  window.wfDashboard = { state: state, render: render };
})();
