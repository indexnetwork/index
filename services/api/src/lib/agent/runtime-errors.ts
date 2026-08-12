export type RuntimeErrorCode = 'runtime_invalid' | 'runtime_not_found' | 'runtime_conflict';

/** Sanitized runtime-domain failure safe to expose through the owner API. */
export abstract class RuntimeDomainError extends Error {
  protected constructor(
    readonly code: RuntimeErrorCode,
    readonly status: 400 | 404 | 409,
    readonly clientMessage: string,
  ) {
    super(clientMessage);
    this.name = new.target.name;
  }
}

export class RuntimeValidationError extends RuntimeDomainError {
  constructor() {
    super('runtime_invalid', 400, 'The runtime request is invalid');
  }
}

export class RuntimeNotFoundError extends RuntimeDomainError {
  constructor() {
    super('runtime_not_found', 404, 'The requested runtime installation was not found');
  }
}

export class RuntimeConflictError extends RuntimeDomainError {
  constructor() {
    super('runtime_conflict', 409, 'The runtime binding changed; retry with the current setup generation');
  }
}
