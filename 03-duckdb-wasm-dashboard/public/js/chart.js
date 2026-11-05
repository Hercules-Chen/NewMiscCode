/* Minimal hand-written SVG chart (bar / line, single series) with hover tooltip. Attaches `MiniChart`. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = (count * step0) / span;
    let step = step0;
    if (err <= 0.15) step = step0 * 10; else if (err <= 0.35) step = step0 * 5; else if (err <= 0.75) step = step0 * 2;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }

  function fmtNum(v) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Number(v.toFixed(2)));
  }

  /**
   * render(container, {type:'bar'|'line', labels:[], values:[], xName, yName})
   */
  function render(container, spec) {
    container.innerHTML = '';
    const width = Math.max(320, container.clientWidth || 640);
    const height = 320;
    const m = { top: 16, right: 16, bottom: 64, left: 56 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const vals = spec.values;
    const n = vals.length;
    const minV = Math.min(0, ...vals);
    const maxV = Math.max(0, ...vals);
    const ticks = niceTicks(minV, maxV, 5);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const sy = (v) => m.top + ih - ((v - y0) / (y1 - y0)) * ih;

    const svg = el('svg', { id: 'chartSvg', viewBox: `0 0 ${width} ${height}`, width: width, height: height, role: 'img', 'aria-label': spec.yName + ' by ' + spec.xName, class: 'chart-svg' }, container);
    const grid = el('g', { class: 'chart-grid' }, svg);
    ticks.forEach((tv) => {
      const y = sy(tv);
      el('line', { x1: m.left, x2: width - m.right, y1: y, y2: y }, grid);
      const tx = el('text', { x: m.left - 6, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' }, grid);
      tx.textContent = fmtNum(tv);
    });
    el('line', { x1: m.left, x2: width - m.right, y1: sy(0), y2: sy(0), class: 'chart-baseline' }, svg);

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
    function showTip(i, x, y) {
      tip.textContent = '';
      const a = document.createElement('div'); a.className = 'chart-tip-x'; a.textContent = spec.labels[i];
      const b = document.createElement('div'); b.textContent = spec.yName + ': ' + vals[i].toLocaleString();
      tip.appendChild(a); tip.appendChild(b);
      tip.hidden = false;
      const left = Math.min(Math.max(0, x - 60), width - 140);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, y - 52) + 'px';
    }
    function hideTip() { tip.hidden = true; }

    const band = iw / Math.max(1, n);
    const cx = (i) => m.left + band * i + band / 2;
    const marks = el('g', { class: 'chart-marks' }, svg);
    if (spec.type === 'line') {
      const pts = vals.map((v, i) => `${cx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
      el('polyline', { points: pts, class: 'chart-line', fill: 'none' }, marks);
      const cross = el('line', { class: 'chart-cross', y1: m.top, y2: m.top + ih, x1: 0, x2: 0, visibility: 'hidden' }, svg);
      const dot = el('circle', { r: 4, class: 'chart-dot', visibility: 'hidden' }, svg);
      const hit = el('rect', { x: m.left, y: m.top, width: iw, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const px = ((ev.clientX - rect.left) / rect.width) * width;
        const i = Math.max(0, Math.min(n - 1, Math.floor((px - m.left) / band)));
        cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i)); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', cx(i)); dot.setAttribute('cy', sy(vals[i])); dot.setAttribute('visibility', 'visible');
        showTip(i, cx(i), sy(vals[i]));
      });
      hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
    } else {
      const bw = Math.max(1, Math.min(48, band - 2));
      vals.forEach((v, i) => {
        const yv = sy(v); const yb = sy(0);
        const top = Math.min(yv, yb); const h = Math.max(1, Math.abs(yb - yv));
        const g = el('g', { class: 'chart-bar-g' }, marks);
        el('rect', { x: cx(i) - band / 2, y: m.top, width: band, height: ih, fill: 'transparent' }, g); // hit target
        el('rect', { x: cx(i) - bw / 2, y: top, width: bw, height: h, rx: Math.min(4, bw / 2), class: 'chart-bar' }, g);
        g.addEventListener('mouseenter', () => { g.classList.add('hover'); showTip(i, cx(i), top); });
        g.addEventListener('mouseleave', () => { g.classList.remove('hover'); hideTip(); });
      });
    }

    // x labels: show at most ~12
    const every = Math.max(1, Math.ceil(n / 12));
    const xl = el('g', { class: 'chart-xlabels' }, svg);
    for (let i = 0; i < n; i += every) {
      const lab = String(spec.labels[i]);
      const short = lab.length > 16 ? lab.slice(0, 15) + '…' : lab;
      const tx = el('text', { x: cx(i), y: m.top + ih + 14, 'text-anchor': 'end', transform: `rotate(-30 ${cx(i)} ${m.top + ih + 14})`, class: 'chart-tick' }, xl);
      tx.textContent = short;
    }
    const yt = el('text', { x: 12, y: m.top + ih / 2, transform: `rotate(-90 12 ${m.top + ih / 2})`, 'text-anchor': 'middle', class: 'chart-axis-title' }, svg);
    yt.textContent = spec.yName;
    return svg;
  }

  root.MiniChart = { render };
})(typeof globalThis !== 'undefined' ? globalThis : window);
