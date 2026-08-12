export class RuntimeError extends Error {
  constructor(message, { code = "RUNTIME_ERROR", cause, details } = {}) {
    super(message, { cause });
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends RuntimeError {
  constructor(message, options = {}) {
    super(message, { code: "PROVIDER_ERROR", ...options });
    this.name = "ProviderError";
  }
}

export class ValidationError extends RuntimeError {
  constructor(message, options = {}) {
    super(message, { code: "VALIDATION_ERROR", ...options });
    this.name = "ValidationError";
  }
}
