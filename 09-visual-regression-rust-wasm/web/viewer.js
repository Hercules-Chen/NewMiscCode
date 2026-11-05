// viewer.js - comparison viewer shared by the browser UI and the self-contained HTML report.
// Modes: side (side-by-side), slider (wipe), onion (onion skin), diff (diff image only).
// No imports: the report generator inlines this file into a <script type="module">.

export const VIEW_MODES = ['slider', 'side', 'onion', 'diff'];

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function boxesSvg(boxes, width, height) {
  const rects = (boxes || []).map(b =>
    `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" fill="none" stroke="#e6141e" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join('');
  return `<svg class="vr-boxes" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
}

/**
 * Render a viewer into `el`.
 * @param {HTMLElement} el
 * @param {{baseline:string,current:string,diff:string,boxes:Array,width:number,height:number,mode?:string,t:(k:string)=>string}} o
 */
export function mountViewer(el, o) {
  const t = o.t || (k => k);
  let mode = VIEW_MODES.includes(o.mode) ? o.mode : 'slider';
  const w = o.width || 1;
  const h = o.height || 1;
  const stageStyle = `max-width:${w}px;aspect-ratio:${w}/${h}`;

  function html() {
    const tabs = VIEW_MODES.map(m =>
      `<button type="button" class="vr-mode${m === mode ? ' active' : ''}" data-mode="${m}" aria-pressed="${m === mode}">${t('mode.' + m)}</button>`).join('');
    let body = '';
    if (mode === 'side') {
      body = `<div class="vr-side">
        <figure><figcaption>${t('img.baseline')}</figcaption><img src="${escAttr(o.baseline)}" alt="${escAttr(t('img.baseline'))}"></figure>
        <figure><figcaption>${t('img.current')}</figcaption><img src="${escAttr(o.current)}" alt="${escAttr(t('img.current'))}"></figure>
        <figure><figcaption>${t('img.diff')}</figcaption><img src="${escAttr(o.diff)}" alt="${escAttr(t('img.diff'))}"></figure></div>`;
    } else if (mode === 'slider') {
      body = `<div class="vr-stage" style="${stageStyle}">
          <img class="vr-under" src="${escAttr(o.current)}" alt="${escAttr(t('img.current'))}">
          <img class="vr-over" src="${escAttr(o.baseline)}" alt="${escAttr(t('img.baseline'))}" style="clip-path:inset(0 50% 0 0)">
          <div class="vr-divider" style="left:50%"></div>${boxesSvg(o.boxes, w, h)}</div>
        <label class="vr-range">${t('img.baseline')} <input type="range" min="0" max="100" value="50" data-role="wipe" aria-label="${escAttr(t('mode.slider'))}"> ${t('img.current')}</label>`;
    } else if (mode === 'onion') {
      body = `<div class="vr-stage" style="${stageStyle}">
          <img class="vr-under" src="${escAttr(o.baseline)}" alt="${escAttr(t('img.baseline'))}">
          <img class="vr-over" src="${escAttr(o.current)}" alt="${escAttr(t('img.current'))}" style="opacity:0.5">${boxesSvg(o.boxes, w, h)}</div>
        <label class="vr-range">${t('img.baseline')} <input type="range" min="0" max="100" value="50" data-role="onion" aria-label="${escAttr(t('mode.onion'))}"> ${t('img.current')}</label>`;
    } else {
      body = `<div class="vr-diffonly"><img src="${escAttr(o.diff)}" alt="${escAttr(t('img.diff'))}"></div>`;
    }
    return `<div class="vr-modes" role="group">${tabs}</div><div class="vr-body" data-mode="${mode}">${body}</div>`;
  }

  function render() {
    el.innerHTML = html();
    el.querySelectorAll('.vr-mode').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
    const wipe = el.querySelector('[data-role=wipe]');
    if (wipe) wipe.addEventListener('input', () => {
      const v = Number(wipe.value);
      el.querySelector('.vr-over').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
      el.querySelector('.vr-divider').style.left = v + '%';
    });
    const onion = el.querySelector('[data-role=onion]');
    if (onion) onion.addEventListener('input', () => { el.querySelector('.vr-over').style.opacity = String(Number(onion.value) / 100); });
  }

  render();
  return {
    setMode(m) { if (VIEW_MODES.includes(m)) { mode = m; render(); } },
    get mode() { return mode; },
    rerender: render,
  };
}

export const VIEWER_CSS = `
.vr-modes{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.vr-mode{border:1px solid var(--line,#ccc);background:var(--card,#fff);color:inherit;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit}
.vr-mode.active{background:#e6141e;border-color:#e6141e;color:#fff}
.vr-stage{position:relative;width:100%;border:1px solid var(--line,#ccc);background:#fff;overflow:hidden}
.vr-stage img{position:absolute;inset:0;width:100%;height:100%;display:block}
.vr-divider{position:absolute;top:0;bottom:0;width:2px;background:#e6141e;transform:translateX(-1px);pointer-events:none}
.vr-boxes{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.vr-range{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
.vr-range input{flex:1;min-width:120px}
.vr-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.vr-side figure{margin:0}
.vr-side figcaption{font-size:.85em;opacity:.8;margin-bottom:4px}
.vr-side img,.vr-diffonly img{max-width:100%;height:auto;border:1px solid var(--line,#ccc);display:block}
`;
