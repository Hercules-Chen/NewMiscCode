// Remote carets/selections drawn over a <textarea> using a transparent "mirror" element with
// identical typography. Positions are exchanged as Y.RelativePosition (stable under concurrent edits).
import * as Y from 'yjs';

const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'wordSpacing'];

export class RemoteCursors {
  constructor({ textarea, layer, ytext, awareness }) {
    this.ta = textarea;
    this.layer = layer; // absolutely positioned container, sibling of textarea
    this.ytext = ytext;
    this.doc = ytext.doc;
    this.awareness = awareness;
    this.inner = document.createElement('div');
    this.inner.className = 'mirror-inner';
    layer.appendChild(this.inner);
    this.render = this.render.bind(this);
    this.syncScroll = () => { this.inner.style.transform = `translateY(${-this.ta.scrollTop}px)`; };
    textarea.addEventListener('scroll', this.syncScroll);
    awareness.on('change', this.render);
    ytext.observe(this.render);
    this.ro = new ResizeObserver(() => { this.copyStyle(); this.render(); });
    this.ro.observe(textarea);
    this.copyStyle();
  }

  copyStyle() {
    const cs = getComputedStyle(this.ta);
    for (const k of COPY) this.inner.style[k] = cs[k];
    this.layer.style.left = `${this.ta.offsetLeft + parseFloat(cs.borderLeftWidth)}px`;
    this.layer.style.top = `${this.ta.offsetTop + parseFloat(cs.borderTopWidth)}px`;
    this.layer.style.width = `${this.ta.clientWidth}px`;
    this.layer.style.height = `${this.ta.clientHeight}px`;
  }

  /** local selection -> awareness */
  publishLocal() {
    const ta = this.ta;
    const anchor = Y.createRelativePositionFromTypeIndex(this.ytext, Math.min(ta.selectionStart, this.ytext.length));
    const head = Y.createRelativePositionFromTypeIndex(this.ytext, Math.min(ta.selectionEnd, this.ytext.length));
    const cur = this.awareness.getLocalState()?.cursor;
    const next = { anchor: Y.relativePositionToJSON(anchor), head: Y.relativePositionToJSON(head) };
    if (cur && JSON.stringify(cur) === JSON.stringify(next)) return;
    this.awareness.setLocalStateField('cursor', next);
  }

  remotes() {
    const out = [];
    const me = this.awareness.clientID;
    this.awareness.getStates().forEach((st, id) => {
      if (id === me || !st?.cursor || !st.user) return;
      try {
        const a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(st.cursor.anchor), this.doc);
        const h = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(st.cursor.head), this.doc);
        if (!a || !h || a.type !== this.ytext || h.type !== this.ytext) return;
        out.push({ id, user: st.user, from: Math.min(a.index, h.index), to: Math.max(a.index, h.index), head: h.index });
      } catch { /* positions referring to unknown items are skipped */ }
    });
    return out;
  }

  render() {
    const text = this.ta.value;
    const rs = this.remotes();
    const inner = this.inner;
    inner.textContent = '';
    if (!rs.length) return;
    const points = new Set([0, text.length]);
    for (const r of rs) { points.add(Math.min(r.from, text.length)); points.add(Math.min(r.to, text.length)); points.add(Math.min(r.head, text.length)); }
    const sorted = [...points].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      for (const r of rs) {
        if (Math.min(r.head, text.length) !== p) continue;
        const caret = document.createElement('span');
        caret.className = 'remote-caret';
        caret.style.setProperty('--c', r.user.color);
        caret.dataset.user = r.user.name;
        const label = document.createElement('span');
        label.className = 'remote-label';
        label.textContent = r.user.name;
        caret.appendChild(label);
        inner.appendChild(caret);
      }
      const next = sorted[i + 1];
      if (next == null) break;
      const seg = text.slice(p, next);
      const cover = rs.find(r => r.from <= p && r.to >= next && r.to > r.from);
      if (cover) {
        const m = document.createElement('mark');
        m.style.setProperty('--c', cover.user.color);
        m.textContent = seg;
        inner.appendChild(m);
      } else {
        inner.appendChild(document.createTextNode(seg));
      }
    }
    inner.appendChild(document.createTextNode('​'));
    this.syncScroll();
  }

  destroy() {
    this.awareness.off('change', this.render);
    this.ytext.unobserve(this.render);
    this.ro.disconnect();
  }
}
