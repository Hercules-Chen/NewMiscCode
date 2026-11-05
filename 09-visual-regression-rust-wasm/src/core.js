// core.js - load vr_core.wasm in Node (async) and expose the shared vrcore.js API.
import { readFile } from 'node:fs/promises';
import { WASM_PATH } from './paths.js';
import { createCore } from '../web/vrcore.js';

let corePromise = null;

/** Lazily instantiate the wasm core once per process. */
export function loadCore(wasmPath = WASM_PATH) {
  if (!corePromise) {
    corePromise = readFile(wasmPath)
      .then(bytes => createCore(bytes))
      .catch(err => {
        corePromise = null;
        err.message = `cannot load wasm core (${wasmPath}): ${err.message}. Run: npm run build:wasm`;
        throw err;
      });
  }
  return corePromise;
}
