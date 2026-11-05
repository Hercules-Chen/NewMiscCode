/* Shared by the page (<script>) and the Service Worker (importScripts).
 * IndexedDB local store + outbox queue + replay (sync) protocol.
 * Exposes self.OutboxCore. Classic script on purpose (SW importScripts).
 */
(function (global) {
  'use strict';
  var DB_NAME = 'pwa-offline-sync';
  var DB_VERSION = 1;
  var CHANNEL = 'pwa-sync';
  var LOG_MAX = 200;
  var dbPromise = null;
  var bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  var listeners = [];
  if (bc) bc.onmessage = function (e) { listeners.forEach(function (fn) { fn(e.data); }); };

  function emit(msg) {
    // local listeners (same context) + other contexts (pages <-> SW)
    listeners.forEach(function (fn) { try { fn(msg); } catch (e) { /* ignore */ } });
    if (bc) bc.postMessage(msg);
  }

  function reqP(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) {
          var ob = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
          ob.createIndex('byRecord', 'recordId', { unique: false });
        }
        if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'seq', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; reject(req.error); };
      req.onblocked = function () { /* another tab holds an old version; wait */ };
    });
    return dbPromise;
  }

  /** Run fn(stores) inside one transaction; resolves with fn's result after commit. */
  function tx(names, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(names, mode);
        var stores = {};
        [].concat(names).forEach(function (n) { stores[n] = t.objectStore(n); });
        var result;
        Promise.resolve(fn(stores)).then(function (r) { result = r; }, function (e) { try { t.abort(); } catch (x) { /* */ } reject(e); });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      });
    });
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function getMeta(k) { return tx('meta', 'readonly', function (s) { return reqP(s.meta.get(k)); }).then(function (r) { return r ? r.v : undefined; }); }
  function setMeta(k, v) { return tx('meta', 'readwrite', function (s) { return reqP(s.meta.put({ k: k, v: v })); }); }

  function clientId() {
    return getMeta('clientId').then(function (id) {
      if (id) return id;
      id = 'c-' + uuid().slice(0, 8);
      return setMeta('clientId', id).then(function () { return id; });
    });
  }

  function addLog(level, msg, data, source) {
    var entry = { ts: new Date().toISOString(), level: level, msg: msg, data: data || null, source: source || 'page' };
    return tx('log', 'readwrite', function (s) {
      return reqP(s.log.add(entry)).then(function () { return reqP(s.log.count()); }).then(function (n) {
        if (n <= LOG_MAX) return;
        // trim oldest
        return new Promise(function (res) {
          var excess = n - LOG_MAX;
          s.log.openCursor().onsuccess = function (e) {
            var c = e.target.result;
            if (c && excess-- > 0) { c.delete(); c.continue(); } else res();
          };
        });
      });
    }).catch(function () { /* logging must never break sync */ }).then(function () {
      emit({ type: 'log', entry: entry });
      return entry;
    });
  }

  function getLog() { return tx('log', 'readonly', function (s) { return reqP(s.log.getAll()); }); }
  function clearLog() { return tx('log', 'readwrite', function (s) { return reqP(s.log.clear()); }); }

  function counts() {
    return tx(['outbox', 'conflicts', 'records'], 'readonly', function (s) {
      return Promise.all([reqP(s.outbox.count()), reqP(s.conflicts.count()), reqP(s.records.getAll())]);
    }).then(function (a) { return { pending: a[0], conflicts: a[1], records: a[2].filter(function (r) { return !r.deleted; }).length }; });
  }

  function listRecords() { return tx('records', 'readonly', function (s) { return reqP(s.records.getAll()); }); }
  function listOutbox() { return tx('outbox', 'readonly', function (s) { return reqP(s.outbox.getAll()); }); }
  function listConflicts() { return tx('conflicts', 'readonly', function (s) { return reqP(s.conflicts.getAll()); }); }

  var FIELDS = ['title', 'location', 'note', 'status', 'photo'];
  function pick(r) { var o = {}; FIELDS.forEach(function (f) { if (r[f] !== undefined) o[f] = r[f]; }); return o; }

  /**
   * Local write + enqueue in ONE IndexedDB transaction.
   * kind: 'create' | 'update' | 'delete'. data: record fields.
   */
  function saveLocal(kind, id, data) {
    var now = new Date().toISOString();
    var item = null;
    return tx(['records', 'outbox'], 'readwrite', function (s) {
      return reqP(s.records.get(id || '')).then(function (existing) {
        var rec;
        if (kind === 'create') {
          id = id || uuid();
          rec = Object.assign({ id: id, version: 0, createdAt: now, status: 'ok', location: '', note: '', photo: null }, pick(data), { updatedAt: now, pending: true, deleted: false });
          item = { method: 'POST', url: '/api/records', recordId: id, kind: kind, body: Object.assign({ id: id }, pick(rec)) };
        } else {
          if (!existing) throw new Error('record not found: ' + id);
          if (existing.conflict) throw new Error('record has an unresolved conflict');
          rec = Object.assign({}, existing, pick(data || {}), { updatedAt: now, pending: true });
          if (kind === 'delete') rec.deleted = true;
          item = kind === 'delete'
            ? { method: 'DELETE', url: '/api/records/' + encodeURIComponent(id), recordId: id, kind: kind, body: {} }
            : { method: 'PUT', url: '/api/records/' + encodeURIComponent(id), recordId: id, kind: kind, body: pick(rec) };
        }
        item.key = uuid();            // Idempotency-Key: fixed at enqueue time, reused on every retry
        item.createdAt = now;
        item.attempts = 0;
        s.records.put(rec);
        return reqP(s.outbox.add(item)).then(function (seq) { item.seq = seq; return rec; });
      });
    }).then(function (rec) {
      emit({ type: 'changed', reason: 'enqueue', recordId: rec.id });
      addLog('info', 'enqueued', { kind: kind, recordId: rec.id, key: item.key, seq: item.seq });
      return rec;
    });
  }

  /** Merge server records into the local store. Never overwrites records with pending ops or conflicts. */
  function mergeServer(records) {
    var changed = 0;
    return tx(['records', 'outbox'], 'readwrite', function (s) {
      return Promise.all(records.map(function (srv) {
        return Promise.all([reqP(s.records.get(srv.id)), reqP(s.outbox.index('byRecord').count(srv.id))]).then(function (a) {
          var local = a[0], pendingOps = a[1];
          if (pendingOps > 0 || (local && local.conflict)) return;
          if (local && local.version > srv.version) return;           // stale (e.g. SWR cached) response
          if (local && local.version === srv.version && !!local.deleted === !!srv.deleted) return;
          if (srv.deleted && !local) return;                         // never seen it; no tombstone needed
          // deleted records are kept as tombstones (deleted:true + version) so a stale cached list cannot resurrect them
          s.records.put(Object.assign({}, srv, { pending: false, conflict: false }));
          changed++;
        });
      }));
    }).then(function () {
      if (changed) emit({ type: 'changed', reason: 'merge', count: changed });
      return changed;
    });
  }

  /** Apply a server ack for one outbox item: remove the item, store the server copy. */
  function applyAck(item, serverRecord) {
    return tx(['records', 'outbox'], 'readwrite', function (s) {
      s.outbox.delete(item.seq);
      return Promise.all([reqP(s.outbox.index('byRecord').getAllKeys(item.recordId)), reqP(s.records.get(item.recordId))]).then(function (a) {
        var remaining = a[0].filter(function (k) { return k !== item.seq; }).length;
        var local = a[1];
        if (!serverRecord) return;
        // More ops queued for this record: keep the newer local field values, only advance the base version.
        // Otherwise store the server copy (a deleted record stays as a tombstone so stale caches cannot resurrect it).
        var next = remaining > 0 ? Object.assign({}, local || {}, { version: serverRecord.version, createdAt: serverRecord.createdAt })
          : Object.assign({}, serverRecord, { pending: false, conflict: false });
        s.records.put(next);
      });
    });
  }

  function moveToConflict(item, serverRecord) {
    return tx(['records', 'outbox', 'conflicts'], 'readwrite', function (s) {
      return Promise.all([reqP(s.records.get(item.recordId)), reqP(s.outbox.index('byRecord').getAllKeys(item.recordId))]).then(function (a) {
        var local = a[0] || Object.assign({ id: item.recordId }, item.body);
        a[1].forEach(function (k) { s.outbox.delete(k); }); // superseded by "mine" snapshot
        s.conflicts.put({ id: item.recordId, mine: Object.assign({}, local, { pending: false }), theirs: serverRecord || null, kind: item.kind, at: new Date().toISOString() });
        s.records.put(Object.assign({}, local, { pending: false, conflict: true }));
      });
    });
  }

  function dropItem(item, reason) {
    return tx(['records', 'outbox'], 'readwrite', function (s) {
      s.outbox.delete(item.seq);
      return reqP(s.records.get(item.recordId)).then(function (r) { if (r) s.records.put(Object.assign({}, r, { pending: false, error: reason })); });
    });
  }

  function bumpAttempt(item, err) {
    return tx('outbox', 'readwrite', function (s) {
      item.attempts = (item.attempts || 0) + 1;
      item.lastError = String(err).slice(0, 300);
      item.lastAttempt = new Date().toISOString();
      return reqP(s.outbox.put(item));
    });
  }

  function getRecord(id) { return tx('records', 'readonly', function (s) { return reqP(s.records.get(id)); }); }

  var running = null;
  /**
   * Replay the outbox in order. Safe to call concurrently from pages and the SW:
   * Web Locks serialise it, and Idempotency-Key makes a re-sent request harmless.
   * Resolves { sent, ok, conflicts, rejected, remaining, networkError }.
   */
  function replay(opts) {
    opts = opts || {};
    var source = opts.source || 'page';
    var run = function () { return doReplay(source, opts); };
    if (global.navigator && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('pwa-outbox-replay', run);
    }
    if (running) return running;
    running = run().finally(function () { running = null; });
    return running;
  }

  function doReplay(source, opts) {
    var res = { sent: 0, ok: 0, conflicts: 0, rejected: 0, remaining: 0, networkError: null, source: source };
    var cid;
    return clientId().then(function (id) { cid = id; return listOutbox(); }).then(function (items) {
      if (!items.length) return;
      addLog('info', 'replay-start', { items: items.length }, source);
      var i = 0;
      function next() {
        if (i >= items.length) return Promise.resolve();
        var item = items[i++];
        // the item may have been removed by a conflict on an earlier item for the same record
        return tx('outbox', 'readonly', function (s) { return reqP(s.outbox.get(item.seq)); }).then(function (cur) {
          if (!cur) return next();
          return sendOne(cur).then(function (stop) { return stop ? undefined : next(); });
        });
      }
      function sendOne(item) {
        return (item.method === 'POST' ? Promise.resolve(null) : getRecord(item.recordId)).then(function (local) {
          var body = Object.assign({}, item.body);
          // baseVersion is resolved at send time from the last server-acknowledged version
          if (item.method !== 'POST') body.baseVersion = local ? local.version : 0;
          res.sent++;
          return fetch(item.url, {
            method: item.method,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.key, 'X-Client-Id': cid },
            body: JSON.stringify(body),
            cache: 'no-store',
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j, replayed: r.headers.get('Idempotent-Replayed') === 'true' }; });
          }, function (err) { return { networkError: err }; });
        }).then(function (r) {
          if (r.networkError) {
            res.networkError = String(r.networkError.message || r.networkError);
            addLog('warn', 'network-error', { key: item.key, error: res.networkError }, source);
            return bumpAttempt(item, res.networkError).then(function () { return true; });
          }
          if (r.status >= 200 && r.status < 300) {
            res.ok++;
            addLog('info', 'acked', { kind: item.kind, recordId: item.recordId, status: r.status, version: r.body.record && r.body.record.version, replayed: r.replayed, key: item.key }, source);
            return applyAck(item, r.body.record).then(function () { return false; });
          }
          if (r.status === 409) {
            res.conflicts++;
            addLog('warn', 'conflict', { recordId: item.recordId, serverVersion: r.body.server && r.body.server.version, key: item.key }, source);
            return moveToConflict(item, r.body.server).then(function () { return false; });
          }
          if (r.status >= 500 || r.status === 408 || r.status === 429) {
            res.networkError = 'HTTP ' + r.status;
            addLog('warn', 'server-error', { status: r.status, key: item.key }, source);
            return bumpAttempt(item, 'HTTP ' + r.status).then(function () { return true; });
          }
          res.rejected++;
          addLog('error', 'rejected', { status: r.status, error: r.body.error, message: r.body.message, recordId: item.recordId }, source);
          return dropItem(item, r.body.error || ('HTTP ' + r.status)).then(function () { return false; });
        });
      }
      return next();
    }).then(function () { return counts(); }).then(function (c) {
      res.remaining = c.pending;
      if (res.sent) {
        addLog(res.networkError ? 'warn' : 'info', 'replay-done', { sent: res.sent, ok: res.ok, conflicts: res.conflicts, rejected: res.rejected, remaining: res.remaining }, source);
        emit({ type: 'changed', reason: 'replay', result: res });
      }
      return res;
    });
  }

  /** Conflict resolution. choice: 'mine' | 'theirs' */
  function resolveConflict(id, choice) {
    var out = null;
    return tx(['records', 'outbox', 'conflicts'], 'readwrite', function (s) {
      return reqP(s.conflicts.get(id)).then(function (c) {
        if (!c) throw new Error('no conflict for ' + id);
        s.conflicts.delete(id);
        var theirs = c.theirs;
        if (choice === 'theirs') {
          if (!theirs) s.records.delete(id);
          else s.records.put(Object.assign({}, theirs, { pending: false, conflict: false }));
          out = { choice: choice };
          return;
        }
        // keep mine: rebase onto the server version and queue a new write (new Idempotency-Key)
        var now = new Date().toISOString();
        var mine = Object.assign({}, c.mine, { version: theirs ? theirs.version : 0, pending: true, conflict: false, updatedAt: now });
        var item;
        if (!theirs) item = { method: 'POST', url: '/api/records', kind: 'create', body: Object.assign({ id: id }, pick(mine)) };
        else if (mine.deleted) item = { method: 'DELETE', url: '/api/records/' + encodeURIComponent(id), kind: 'delete', body: {} };
        else item = { method: 'PUT', url: '/api/records/' + encodeURIComponent(id), kind: 'update', body: Object.assign(pick(mine), { deleted: false }) };
        if (theirs && theirs.deleted && !mine.deleted) item.body.deleted = false; // resurrect
        item.recordId = id; item.key = uuid(); item.createdAt = now; item.attempts = 0;
        s.records.put(mine);
        s.outbox.add(item);
        out = { choice: choice, key: item.key };
      });
    }).then(function () {
      addLog('info', 'conflict-resolved', { recordId: id, choice: choice });
      emit({ type: 'changed', reason: 'resolve', recordId: id });
      return out;
    });
  }

  function resetAll() {
    return tx(['records', 'outbox', 'conflicts', 'log'], 'readwrite', function (s) {
      s.records.clear(); s.outbox.clear(); s.conflicts.clear(); s.log.clear();
    }).then(function () { emit({ type: 'changed', reason: 'reset' }); });
  }

  global.OutboxCore = {
    DB_NAME: DB_NAME, CHANNEL: CHANNEL, openDB: openDB, tx: tx, uuid: uuid, clientId: clientId,
    saveLocal: saveLocal, mergeServer: mergeServer, replay: replay, resolveConflict: resolveConflict,
    counts: counts, listRecords: listRecords, listOutbox: listOutbox, listConflicts: listConflicts, getRecord: getRecord,
    addLog: addLog, getLog: getLog, clearLog: clearLog, resetAll: resetAll, getMeta: getMeta, setMeta: setMeta,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    emit: emit,
  };
})(self);
