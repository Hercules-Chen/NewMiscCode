'use strict';
// OpenTelemetry SDK bootstrap. MUST be required before node:http is loaded by the service.
// Exports spans with OTLP/HTTP (JSON encoding) to the local collector.
process.env.OTEL_METRICS_EXPORTER = process.env.OTEL_METRICS_EXPORTER || 'none';
process.env.OTEL_LOGS_EXPORTER = process.env.OTEL_LOGS_EXPORTER || 'none';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

/**
 * @param {{serviceName: string, collectorUrl: string, debug?: boolean}} opts
 * @returns {NodeSDK}
 */
function startTracing({ serviceName, collectorUrl, debug = false }) {
  if (debug) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  const exporter = new OTLPTraceExporter({ url: `${collectorUrl}/v1/traces` });
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: '0.1.0',
      'deployment.environment.name': 'local-demo',
    }),
    // Short delay so the viewer shows traces almost immediately in the demo.
    spanProcessors: [new BatchSpanProcessor(exporter, { scheduledDelayMillis: 300 })],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/healthz',
      }),
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}

module.exports = { startTracing };
