// OTLP/HTTP JSON decoding helpers (spec: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding).
// Converts ExportTraceServiceRequest / ExportLogsServiceRequest JSON into flat rows for the store.

const HEX_RE = /^[0-9a-f]*$/i;

/** OTLP JSON uses lowercase hex ids; some producers send base64 (proto3 JSON mapping). Accept both. */
export function normalizeId(id) {
  if (!id) return '';
  if (typeof id !== 'string') return '';
  if (HEX_RE.test(id) && (id.length === 32 || id.length === 16)) return id.toLowerCase();
  try {
    const hex = Buffer.from(id, 'base64').toString('hex');
    if (hex.length === 32 || hex.length === 16) return hex;
  } catch { /* fall through */ }
  return id.toLowerCase();
}

/** Decode an OTLP AnyValue into a plain JS value. */
export function anyValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('boolValue' in v) return Boolean(v.boolValue);
  if ('intValue' in v) { const n = Number(v.intValue); return Number.isSafeInteger(n) ? n : String(v.intValue); }
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(anyValue);
  if ('kvlistValue' in v) return attrs(v.kvlistValue?.values);
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}

export function attrs(list) {
  const out = {};
  for (const kv of list || []) if (kv && kv.key) out[kv.key] = anyValue(kv.value);
  return out;
}

/** Nanosecond timestamp (string or number) -> integer microseconds (safe for JS numbers). */
export function nanosToMicros(ns) {
  if (ns === undefined || ns === null || ns === '') return 0;
  try { return Number(BigInt(String(ns).split('.')[0]) / 1000n); } catch { return Math.round(Number(ns) / 1000); }
}

/** @returns {Array<object>} span rows */
export function decodeTraces(payload) {
  const rows = [];
  for (const rs of payload?.resourceSpans || []) {
    const resource = attrs(rs.resource?.attributes);
    const service = String(resource['service.name'] || 'unknown_service');
    for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) {
      const scope = ss.scope || ss.instrumentationLibrary || {};
      for (const s of ss.spans || []) {
        const start = nanosToMicros(s.startTimeUnixNano);
        const end = nanosToMicros(s.endTimeUnixNano) || start;
        rows.push({
          trace_id: normalizeId(s.traceId),
          span_id: normalizeId(s.spanId),
          parent_span_id: normalizeId(s.parentSpanId),
          service,
          name: String(s.name || ''),
          kind: Number(s.kind || 0),
          start_us: start,
          end_us: end,
          duration_us: Math.max(0, end - start),
          status_code: Number(s.status?.code || 0),
          status_message: String(s.status?.message || ''),
          attributes: attrs(s.attributes),
          events: (s.events || []).map((e) => ({ name: e.name, time_us: nanosToMicros(e.timeUnixNano), attributes: attrs(e.attributes) })),
          links: (s.links || []).map((l) => ({ trace_id: normalizeId(l.traceId), span_id: normalizeId(l.spanId), attributes: attrs(l.attributes) })),
          resource,
          scope: [scope.name, scope.version].filter(Boolean).join('@'),
        });
      }
    }
  }
  return rows.filter((r) => r.trace_id && r.span_id);
}

/** @returns {Array<object>} log rows */
export function decodeLogs(payload) {
  const rows = [];
  for (const rl of payload?.resourceLogs || []) {
    const resource = attrs(rl.resource?.attributes);
    const service = String(resource['service.name'] || 'unknown_service');
    for (const sl of rl.scopeLogs || []) {
      for (const r of sl.logRecords || []) {
        const body = anyValue(r.body);
        rows.push({
          time_us: nanosToMicros(r.timeUnixNano || r.observedTimeUnixNano),
          trace_id: normalizeId(r.traceId),
          span_id: normalizeId(r.spanId),
          service,
          severity: String(r.severityText || severityName(r.severityNumber)),
          severity_number: Number(r.severityNumber || 0),
          body: typeof body === 'string' ? body : JSON.stringify(body),
          attributes: attrs(r.attributes),
        });
      }
    }
  }
  return rows;
}

function severityName(n) {
  n = Number(n || 0);
  if (n >= 17) return 'ERROR';
  if (n >= 13) return 'WARN';
  if (n >= 9) return 'INFO';
  if (n >= 5) return 'DEBUG';
  return n ? 'TRACE' : 'UNSPECIFIED';
}
