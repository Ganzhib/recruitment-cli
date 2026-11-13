export type ErrorCode =
  | 'INPUT'
  | 'AUTH'
  | 'UNSUPPORTED'
  | 'BUSY'
  | 'NETWORK'
  | 'PLATFORM'
  | 'INDETERMINATE'
  | 'NOT_FOUND';

export class RecruitmentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RecruitmentError';
  }
}
