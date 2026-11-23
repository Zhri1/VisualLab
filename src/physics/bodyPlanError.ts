export class BodyPlanError extends Error {
  readonly path: string;
  readonly missing: boolean;
  constructor(path: string, message: string, missing = false) { super(message); this.path = path; this.missing = missing; }
}
