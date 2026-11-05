// Binds a Y.Text to a plain <textarea>.
//  - local edits: diff old/new textarea value -> one delete + insert on Y.Text
//  - IME (Chinese/Japanese input): nothing is written while composing; remote changes that arrive
//    during composition are queued (as Yjs deltas) and the local diff is transformed through them
//    on compositionend, so the candidate window is never disturbed.
//  - remote edits keep the local caret/selection in place (mapped through the delta).
import { diffText, mapIndexThroughDelta, mapIndexThroughDeltas } from '../shared/textdiff.js';

export class TextareaBinding {
  constructor(ytext, textarea, { origin, onChange, dbg = () => {} }) {
    this.ytext = ytext;
    this.ta = textarea;
    this.origin = origin;
    this.onChange = onChange || (() => {});
    this.dbg = dbg;
    this.composing = false;
    this.pending = []; // remote deltas received while composing
    this.synced = ytext.toString();
    this.ta.value = this.synced;

    this._observer = (event, tr) => {
      if (tr.origin === this.origin) return;
      if (this.composing) {
        this.pending.push(event.delta);
        this.dbg('binding.remote_deferred', { ops: event.delta.length });
        return;
      }
      this.applyRemote([event.delta]);
    };
    ytext.observe(this._observer);

    this._onCompStart = () => { this.composing = true; this.dbg('ime.compositionstart'); };
    this._onCompEnd = () => { this.composing = false; this.dbg('ime.compositionend', { pending: this.pending.length }); this.flush(); };
    this._onInput = e => { if (e.isComposing || this.composing) return; this.flush(); };
    textarea.addEventListener('compositionstart', this._onCompStart);
    textarea.addEventListener('compositionend', this._onCompEnd);
    textarea.addEventListener('input', this._onInput);
  }

  /** push the textarea's current value into Y.Text */
  flush() {
    const value = this.ta.value;
    const d = diffText(this.synced, value);
    const deltas = this.pending;
    this.pending = [];
    if (d.remove === 0 && d.insert === '') {
      // nothing typed (e.g. composition cancelled with Esc): just catch up with queued remote changes
      if (deltas.length) this.applyRemote(deltas);
      return;
    }
    let start = d.index;
    let end = d.index + d.remove;
    if (deltas.length) {
      start = mapIndexThroughDeltas(deltas, start, false);
      end = Math.max(start, mapIndexThroughDeltas(deltas, end, false));
    }
    if (end > start || d.insert) {
      this.ytext.doc.transact(() => {
        if (end > start) this.ytext.delete(start, end - start);
        if (d.insert) this.ytext.insert(start, d.insert);
      }, this.origin);
      this.dbg('binding.local', { index: start, remove: end - start, insert: d.insert.length });
    }
    const now = this.ytext.toString();
    this.synced = now;
    if (now !== value) {
      // remote changes were merged under a finished composition: re-render, caret after our insert
      const caret = start + d.insert.length;
      this.ta.value = now;
      this.ta.setSelectionRange(caret, caret);
    }
    this.onChange();
  }

  applyRemote(deltas) {
    const ta = this.ta;
    const focused = document.activeElement === ta;
    let s = ta.selectionStart;
    let e = ta.selectionEnd;
    const dir = ta.selectionDirection;
    const scroll = ta.scrollTop;
    s = mapIndexThroughDeltas(deltas, s, false);
    e = mapIndexThroughDeltas(deltas, e, false);
    const now = this.ytext.toString();
    this.synced = now;
    if (ta.value !== now) {
      ta.value = now;
      if (focused) ta.setSelectionRange(s, Math.max(s, e), dir);
      ta.scrollTop = scroll;
    }
    this.dbg('binding.remote', { length: now.length });
    this.onChange();
  }

  destroy() {
    this.ytext.unobserve(this._observer);
    this.ta.removeEventListener('compositionstart', this._onCompStart);
    this.ta.removeEventListener('compositionend', this._onCompEnd);
    this.ta.removeEventListener('input', this._onInput);
  }
}

export { mapIndexThroughDelta };
