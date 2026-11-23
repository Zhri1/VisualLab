// 由 scripts/sync-functions.mjs 从 src/physics/bodyPlanError.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
export class BodyPlanError extends Error {
  readonly path: string;
  readonly missing: boolean;
  constructor(path: string, message: string, missing = false) { super(message); this.path = path; this.missing = missing; }
}
