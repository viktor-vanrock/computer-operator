export type ModerationStage = 'oauth' | 'chat' | 'transport' | 'timeout' | 'response';

export interface ModerationDiagnostic {
  stage: ModerationStage;
  status?: number;
  reason?: string;
}

export class ModerationUnavailableError extends Error {
  constructor(
    message: string,
    readonly diagnostic: ModerationDiagnostic,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ModerationUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
