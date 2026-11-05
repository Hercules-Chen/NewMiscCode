// Loads csrules.json and merges it over the built-in defaults.
import { readFile, access, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

export const SEVERITIES = ['error', 'warning', 'note'];

export const DEFAULT_CONFIG = {
  language: 'zh-TW',
  include: ['**/*.cs'],
  exclude: ['**/bin/**', '**/obj/**', '**/node_modules/**', '**/.git/**', '**/.vs/**'],
  rules: {
    R1: {
      enabled: true, severity: 'error',
      // Sync-over-async is allowed in unit test projects and Startup/Program.
      allow: {
        paths: ['**/*.Tests/**', '**/*.UnitTests/**', '**/*Tests.cs', '**/Startup.cs'],
        attributes: ['Fact', 'Theory', 'Test', 'TestMethod', 'TestCase', 'TestClass', 'TestFixture'],
        classes: ['Startup', '*Tests'],
      },
      taskNamePattern: '(^|_)task$|Task$',
      strictResult: false,
    },
    R2: {
      enabled: true, severity: 'warning',
      allow: { paths: [], attributes: [], classes: [] },
      asyncVoid: true,
      syncIo: true,
      publicOnly: true,
      syncIoCalls: [
        { call: 'File.ReadAllText', async: 'File.ReadAllTextAsync' },
        { call: 'File.ReadAllBytes', async: 'File.ReadAllBytesAsync' },
        { call: 'File.ReadAllLines', async: 'File.ReadAllLinesAsync' },
        { call: 'File.WriteAllText', async: 'File.WriteAllTextAsync' },
        { call: 'File.WriteAllBytes', async: 'File.WriteAllBytesAsync' },
        { call: 'File.WriteAllLines', async: 'File.WriteAllLinesAsync' },
        { call: 'File.AppendAllText', async: 'File.AppendAllTextAsync' },
        { method: 'ExecuteReader', async: 'ExecuteReaderAsync' },
        { method: 'ExecuteNonQuery', async: 'ExecuteNonQueryAsync' },
        { method: 'ExecuteScalar', async: 'ExecuteScalarAsync' },
        { method: 'ReadToEnd', async: 'ReadToEndAsync' },
        { method: 'SaveChanges', async: 'SaveChangesAsync' },
        { method: 'DownloadString', async: 'HttpClient.GetStringAsync' },
        { method: 'Send', receiver: '(?:http|client)', async: 'SendAsync' },
        { method: 'Open', receiver: '(?:conn|connection)$', async: 'OpenAsync' },
      ],
    },
    R3: {
      enabled: true, severity: 'warning',
      allow: { paths: [], attributes: ['DllImport', 'LibraryImport'], classes: [] },
      ignoreTryPattern: true,
      ignoreOverrides: true,
      ignoreDeconstruct: true,
      ignoreExtern: true,
    },
    R4: {
      enabled: true, severity: 'error',
      allow: { paths: [], attributes: [], classes: [] },
      httpClient: true,
      threadSleep: true,
    },
    R5: {
      enabled: true, severity: 'error',
      allow: { paths: [], attributes: [], classes: [] },
      ignoreExceptionTypes: ['OperationCanceledException', 'TaskCanceledException'],
      loggingPatterns: [
        '(^|\\.)Log(Trace|Debug|Information|Warning|Error|Critical)?$',
        '(^|\\.)_?[Ll]og(ger)?\\.\\w+$',
        '(^|\\.)(TrackException|CaptureException|TraceError|TraceWarning)$',
        '^Console\\.Error\\.Write(Line)?$',
      ],
    },
    R6: {
      enabled: true, severity: 'error',
      allow: { paths: [] },
      asciiOnly: ['.bat', '.cmd'],
      bomIfNonAscii: ['.ps1', '.psm1', '.psd1'],
      utf8: ['.cs', '.md', '.csproj', '.json'],
      bomForbidden: ['.md'],
    },
  },
};

const clone = o => JSON.parse(JSON.stringify(o));

function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export class ConfigError extends Error {}

export function validateConfig(cfg) {
  const errs = [];
  for (const [id, r] of Object.entries(cfg.rules || {})) {
    if (!DEFAULT_CONFIG.rules[id]) errs.push(`unknown rule "${id}"`);
    if (r.severity && !SEVERITIES.includes(r.severity)) errs.push(`${id}.severity must be one of ${SEVERITIES.join('|')}`);
  }
  if (cfg.language && !['zh-TW', 'en'].includes(cfg.language)) errs.push('language must be zh-TW or en');
  if (errs.length) throw new ConfigError(errs.join('; '));
  return cfg;
}

const exists = p => access(p).then(() => true, () => false);

/** Find csrules.json: explicit path, else the target dir (a file's folder) and its parents, else cwd. */
export async function loadConfig({ configPath, searchDirs = [] } = {}) {
  let file = null;
  if (configPath) {
    file = resolve(configPath);
    if (!(await exists(file))) throw new ConfigError(`config not found: ${file}`);
  } else {
    const candidates = [];
    for (const d of searchDirs) {
      let dir = resolve(d);
      try { if ((await stat(dir)).isFile()) dir = dirname(dir); } catch { /* missing target: reported later */ }
      for (;;) { candidates.push(dir); const up = dirname(dir); if (up === dir) break; dir = up; }
    }
    candidates.push(process.cwd());
    for (const d of candidates) {
      const f = join(d, 'csrules.json');
      if (await exists(f)) { file = f; break; }
    }
  }
  let user = {};
  if (file) {
    let text = await readFile(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    try { user = JSON.parse(text); } catch (e) { throw new ConfigError(`invalid JSON in ${file}: ${e.message}`); }
  }
  delete user.$schema;
  const cfg = validateConfig(deepMerge(clone(DEFAULT_CONFIG), user));
  return { config: cfg, file, baseDir: file ? dirname(file) : null };
}
