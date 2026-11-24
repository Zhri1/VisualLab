// 由 scripts/sync-functions.mjs 从 src/physics/pulleyTypes.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import type { Point } from './geometryTypes.ts';

export type PulleySurface =
  | { kind: 'hanging' }
  | {
      kind: 'horizontal';
      kineticFrictionCoefficient: number;
      staticFrictionCoefficient?: number | null;
      slidesAfterRelease?: boolean | null;
    }
  | {
      kind: 'incline';
      angleDeg: number;
      kineticFrictionCoefficient: number;
      staticFrictionCoefficient?: number | null;
      slidesAfterRelease?: boolean | null;
    };

export type PulleyStage = {
  kind: 'pulley_system';
  body1Id: string;
  body2Id: string;
  surface: PulleySurface;
  lightInextensibleString: true;
  idealFixedPulley: true;
  durationSeconds?: number | null;
  body2DropToGroundM?: number | null;
  body1TravelLimitM?: number | null;
};

export type PulleyGeometry = {
  body1Id: string;
  body2Id: string;
  pulley: Point;
  surfaceKind: 'hanging' | 'horizontal' | 'incline';
  angleDeg?: number;
  body1Start: Point;
  body2Start: Point;
  groundYM?: number | null;
};
