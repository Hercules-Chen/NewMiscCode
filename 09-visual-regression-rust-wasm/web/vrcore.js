// vrcore.js - thin async wrapper around vr_core.wasm (raw extern "C" exports, no wasm-bindgen).
// Isomorphic: used by the browser UI (web/app.js) and by Node (src/core.js).
//
// Rust <-> JS boundary:
//   vr_alloc(len) -> ptr        JS copies input bytes into wasm memory at ptr
//   vr_compare(aPtr,aLen,bPtr,bLen,optPtr,optLen,render) -> 0 ok / 1 error  (Rust frees inputs)
//   vr_out_json_ptr/len         UTF-8 JSON stats       vr_out_png_ptr/len   diff PNG bytes
//   vr_out_clear()              release outputs         vr_version_ptr/len   crate version

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

/** Build the option string understood by Rust `Options::parse`. */
export function optionString(opts = {}) {
  const parts = [];
  if (opts.threshold != null) parts.push(`threshold=${Number(opts.threshold)}`);
  if (opts.includeAA != null) parts.push(`aa=${opts.includeAA ? 1 : 0}`);
  if (opts.gap != null) parts.push(`gap=${Math.max(0, Math.floor(opts.gap))}`);
  if (opts.minPixels != null) parts.push(`minPixels=${Math.max(0, Math.floor(opts.minPixels))}`);
  if (opts.fade != null) parts.push(`fade=${Number(opts.fade)}`);
  if (opts.overlay != null) parts.push(`overlay=${Number(opts.overlay)}`);
  const ig = (opts.ignore || []).map(r => (Array.isArray(r) ? r : [r.x, r.y, r.w, r.h]).map(n => Math.max(0, Math.floor(n))).join(','));
  if (ig.length) parts.push(`ignore=${ig.join('|')}`);
  return parts.join(';');
}

/** Parse "x,y,w,h" into {x,y,w,h}; throws on bad input. */
export function parseRect(s) {
  const n = String(s).split(',').map(t => Number(t.trim()));
  if (n.length !== 4 || n.some(v => !Number.isInteger(v) || v < 0)) throw new Error(`bad rect "${s}" (expected x,y,w,h)`);
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

/**
 * Instantiate the core from wasm bytes (ArrayBuffer/Uint8Array) or a compiled WebAssembly.Module.
 * Returns { version, compare(aBytes, bBytes, opts, {render}) -> Promise<{stats, diffPng, ms}> }.
 */
export async function createCore(source) {
  const instance = source instanceof WebAssembly.Module
    ? await WebAssembly.instantiate(source, {})
    : (await WebAssembly.instantiate(source, {})).instance;
  const x = instance.exports;
  const mem = () => new Uint8Array(x.memory.buffer);
  const put = (bytes) => {
    const p = x.vr_alloc(bytes.length);
    mem().set(bytes, p); // re-read buffer: memory may have grown during alloc
    return p;
  };
  const read = (p, len) => mem().slice(p, p + len);
  const version = dec.decode(read(x.vr_version_ptr(), x.vr_version_len()));
  let busy = Promise.resolve();

  function compareSync(a, b, opts = {}, { render = true } = {}) {
    const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
    const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
    const uo = enc.encode(typeof opts === 'string' ? opts : optionString(opts));
    const t0 = (globalThis.performance || Date).now();
    const pa = put(ua); const pb = put(ub); const po = put(uo);
    const code = x.vr_compare(pa, ua.length, pb, ub.length, po, uo.length, render ? 1 : 0);
    const stats = JSON.parse(dec.decode(read(x.vr_out_json_ptr(), x.vr_out_json_len())));
    const diffPng = code === 0 && render ? read(x.vr_out_png_ptr(), x.vr_out_png_len()) : null;
    x.vr_out_clear();
    const ms = (globalThis.performance || Date).now() - t0;
    if (code !== 0 || !stats.ok) {
      const err = new Error(stats.error || `vr_compare failed (${code})`);
      err.code = 'VR_CORE';
      throw err;
    }
    return { stats, diffPng, ms };
  }

  return {
    version,
    exports: x,
    compareSync,
    /** Serialized async compare (the wasm instance is single-threaded). */
    compare(a, b, opts, flags) {
      const run = busy.then(() => compareSync(a, b, opts, flags));
      busy = run.catch(() => {});
      return run;
    },
  };
}
