import type { BodyDefinition, BodySnapshot, BodyGeometry, BodyTrackStage, ParallelStage } from './multiBodyTypes.ts';
import type { ConveyorBeltStage } from './conveyorBelt.ts';
export type InitialBody = { bodyId: string; xM: number; vxMps: number; constraint?: {kind:'pendulum_string';pivotXM:number;lengthM:number;pivotFixed:true;lightInextensibleString:true;airResistanceNegligible:true;initialStringState:'taut'} };
export type HorizontalInitial = { bodies: InitialBody[] };
export type UpstreamSpring = {
  bodyId: string;
  springConstantNpm: number | null;
  initialCompressionM: number | null;
  frictionless: true;
  unattached: true;
};
export type HorizontalApproach = {
  kind:'horizontal_approach';
  upstreamSpring?: UpstreamSpring;
  tracks:{bodyId:string;kineticFrictionCoefficient:number}[];
  end:{kind:'contact_or_rest'}|{kind:'time_limit';durationSeconds:number};
};
export type ConveyorApproach = ConveyorBeltStage & { bodyId?: string };
export type HorizontalCollision = {
  kind:'collision_1d';
  bodyIds:[string,string];
  mode:'elastic'|'perfectly_inelastic'|'specified_post_velocity';
  knownPostVelocity?: { bodyId: string; vxMps: number };
  normalXM?:1|-1;
  contact:{kind:'horizontal_meeting';approachStageIndex:number}|{kind:'conveyor_end';conveyorStageIndex:number};
  externalImpulseNegligible:true;
};
export type HorizontalPlan = {kind:'stage_plan';schemaVersion:1;bodies:BodyDefinition[];primaryBodyId:string;gravityMps2?:number;initial:HorizontalInitial;stages:[HorizontalApproach|ConveyorApproach,HorizontalCollision?,ParallelStage?]};
export type CollisionValues = {mode:HorizontalCollision['mode'];normalXM:1|-1;momentumBeforeKgMps:number;momentumAfterKgMps:number;energyBeforeJ:number;energyAfterJ:number;energyLostJ:number};
export type BodyEvent = {timeSeconds:number;kind:string;stageIndex:number;stagePath:string;bodyIds:string[];before:BodySnapshot;after:BodySnapshot;collision?:CollisionValues};
export type TrackLeaf = BodyTrackStage;
export type TrackGeometry = NonNullable<BodyGeometry['bodyTracks']>[number];
