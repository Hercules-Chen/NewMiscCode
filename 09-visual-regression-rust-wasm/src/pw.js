// pw.js - locate Playwright: local node_modules first, then global (NODE_PATH) via createRequire.
import { createRequire } from 'node:module';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      return createRequire(import.meta.url)('playwright');
    } catch (err) {
      const e = new Error('Playwright not found. Install with: npm install playwright && npx playwright install chromium');
      e.cause = err;
      throw e;
    }
  }
}
