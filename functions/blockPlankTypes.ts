// 由 scripts/sync-functions.mjs 从 src/physics/blockPlankTypes.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
export type PostCommonForce = {
  blockForceXN: number;
  plankForceXN: number;
  durationSeconds: number;
};

export type BlockPlankStage = {
  kind: 'block_plank';
  blockBodyId: string;
  plankBodyId: string;
  plankLengthM: number;
  kineticFrictionCoefficient: number;
  staticFrictionCoefficient?: number | null;
  groundFrictionless: true;
  postCommonForce?: PostCommonForce | null;
  postCommonDurationSeconds?: number | null;
};

export type PlankGeometry = {
  blockBodyId: string;
  plankBodyId: string;
  plankLengthM: number;
};
