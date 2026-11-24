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
