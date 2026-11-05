// Error types visible to workflow code and to operators.

/** Thrown into workflow code when replay diverges from recorded history (code changed incompatibly). */
export class NonDeterminismError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'NonDeterminismError'; this.details = details; }
}

/** Throw (or set err.nonRetryable = true) inside an activity to fail immediately without retries. */
export class NonRetryableError extends Error {
  constructor(message, details) { super(message); this.name = 'NonRetryableError'; this.nonRetryable = true; this.details = details; }
}

/** Thrown by ctx.step() when the activity failed permanently (retries exhausted or non-retryable). */
export class StepFailedError extends Error {
  constructor(stepName, cause, attempts) {
    super(`step "${stepName}" failed after ${attempts} attempt(s): ${cause && cause.message}`);
    this.name = 'StepFailedError';
    this.stepName = stepName;
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** Thrown by ctx.waitForSignal() when the timeout elapses before the signal arrives. */
export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; }
}

/** Thrown at the next ctx call after the run was cancelled; catch it to run compensation. */
export class CancelledError extends Error {
  constructor(message = 'workflow run was cancelled') { super(message); this.name = 'CancelledError'; }
}

export function serializeError(err) {
  if (!err) return null;
  const o = { name: err.name || 'Error', message: String(err.message ?? err) };
  if (err.nonRetryable) o.nonRetryable = true;
  if (err.stepName) o.stepName = err.stepName;
  if (err.details) o.details = err.details;
  if (err.cause && err.cause !== err) o.cause = serializeError(err.cause);
  if (err.stack) o.stack = String(err.stack).split('\n').slice(0, 6).join('\n');
  return o;
}

export function deserializeError(o) {
  if (!o) return new Error('unknown error');
  const e = new Error(o.message);
  e.name = o.name;
  if (o.nonRetryable) e.nonRetryable = true;
  if (o.details) e.details = o.details;
  return e;
}
