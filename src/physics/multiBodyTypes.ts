import type { Point } from './geometryTypes.ts';

export type BodyDefinition = { bodyId: string; massKg: number };
export type BodyState = BodyDefinition & {
  xM: number; yM: number; vxMps: number; vyMps: number; springCompressionM: number;
  status: 'moving' | 'resting' | 'turning' | 'landed' | 'model_boundary';
  constraintId?: string; groupId?: string;
};
export type StringState = {
  kind: 'pendulum_string' | 'pulley_string'; constraintId: string; bodyIds: string[]; pivot: Point; lengthM: number;
  state: 'taut' | 'slack'; tensionN: number; angleDeg?: number; angularVelocityRadps?: number;
};
export type BodySnapshot = { bodies: Record<string, BodyState>; constraints: Record<string, StringState> };
export type MotionStatus = { state: 'complete' | 'range_end' | 'model_limit'; reason: string; message: string; bodyIds: string[] };
export type PendulumEnd = 'lowest_point' | 'first_turn' | 'first_return_lowest' | 'scene_end';
export type PendulumStage = {
  kind: 'pendulum_swing'; bodyIds?: string[]; lengthM?: number; initialAngleDeg?: number;
  initialStringState?: 'taut' | 'released_at_length'; pivotFixed?: true; lightInextensibleString?: true;
  airResistanceNegligible?: true; inheritFromStageIndex?: number;
  inheritFromBodyId?: string;
  end: { kind: PendulumEnd }; slackContinuation?: { kind: 'free_flight_until_retaut' };
};
export type CollisionStage = {
  kind: 'collision_1d'; bodyIds: [string, string]; mode: 'elastic' | 'perfectly_inelastic'; normalXM: 1 | -1;
  contact: { kind: 'pendulum_lowest'; pendulumStageIndex: number };
  targetApproach: { kind: 'uniform_horizontal'; velocityXMps: number; endsAtContact: true; initialXM?: number };
  externalImpulseNegligible: true;
};
export type BodyTrackStage = PendulumStage
  | { kind: 'horizontal_slide'; kineticFrictionCoefficient: number; end: { kind: 'distance'; distanceM: number } | { kind: 'stop' } | { kind: 'scene_end' } }
  | { kind: 'projectile'; landingPlaneYM: number; supportAbsentAtStart?: true; supportBoundary?: {edgeXM:number;supportedSide:'left'|'right'} };
export type ParallelStage = {
  kind: 'parallel_motion'; tracks: { bodyIds: string[]; stages: BodyTrackStage[] }[];
  end: { kind: 'all_finite_tracks' } | { kind: 'pendulum_turn'; bodyId: string };
};
export type BodyStage = PendulumStage | CollisionStage | ParallelStage | import('./horizontalTypes.ts').HorizontalApproach | import('./horizontalTypes.ts').HorizontalCollision | import('./blockPlankTypes.ts').BlockPlankStage | import('./pulleyTypes.ts').PulleyStage;
export type BodyGeometry = {
  bodies?: BodyDefinition[];
  pendulums?: { constraintId: string; bodyIds: string[]; definitionStageIndex: number; pivot: Point; lowestPoint: Point; lengthM: number; initialPosition: Point }[];
  bodyTracks?: { bodyIds: string[]; stagePath: string; horizontal?: { start: Point; plannedEnd: Point | null }; projectile?: { launch: Point; landingPlane?: { yM: number } } }[];
  plank?: import('./blockPlankTypes.ts').PlankGeometry;
  pulley?: import('./pulleyTypes.ts').PulleyGeometry;
};
