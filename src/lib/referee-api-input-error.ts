type RefereeApiErrorStatus = 400 | 404 | 408 | 409 | 413 | 415 | 429;

export class RefereeApiInputError extends Error {
  constructor(message: string, readonly status: RefereeApiErrorStatus = 400) {
    super(message);
    this.name = "RefereeApiInputError";
  }
}
