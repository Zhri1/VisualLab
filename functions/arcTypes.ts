// 由 scripts/sync-functions.mjs 从 src/physics/arcTypes.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import type {Point} from './geometryTypes.ts';
import type {linearState} from './kinematics.ts';
export type ArcConstraint={
  kind:'vertical_arc';stageIndex:number;angleDeg:number;angularVelocityRadps:number;normalForceN:number;
  normalDirection?:{x:number;y:number};
};
export type StageSample=ReturnType<typeof linearState>&{constraint?:ArcConstraint};
export type VerticalArcGeometry={
  stageIndex:number;entry:Point;center:Point;radiusM:number;startAngleDeg:number;endAngleDeg:number;plannedEnd:Point;
  direction?:'positive'|'negative';endMode?:'physical_endpoint'|'observation';
  actualExit:{position:Point;angleDeg:number;reason:'endpoint'|'contact_lost'|'returned_to_entry'|'stationary'|'range_end'};
};
