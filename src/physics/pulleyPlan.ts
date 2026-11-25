import type { StageFieldError } from './stagePlan.ts';

type Obj = Record<string, unknown>;
type Helpers = {
  missing: string[];
  errors: StageFieldError[];
  issue: (path: string, code: string, message: string) => void;
  num: (o: Obj, k: string, p: string, rule?: (n: number) => boolean, required?: boolean) => void;
  choice: (o: Obj, k: string, p: string, allowed: readonly unknown[]) => void;
  fact: (o: Obj, k: string, p: string) => void;
  block: (o: Obj, k: string, p: string) => Obj | null;
  ref: (value: unknown, p: string) => void;
};
const obj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validatePulleyFields(draft: Obj, h: Helpers): void {
  const bodies = Array.isArray(draft.bodies) ? draft.bodies.filter(obj) : [];
  if (bodies.length > 0 && bodies.length !== 2) {
    h.issue('/bodies', 'PRECONDITION_CONFLICT', '定滑轮连接体需要恰好两个物体。');
  }
  const initial = h.block(draft, 'initial', '/initial');
  if (initial) {
    h.num(initial, 'speedMps', '/initial/speedMps');
  }
  const stages = Array.isArray(draft.stages) ? draft.stages : [];
  if (stages.length > 1) {
    h.issue('/stages/1/kind', 'UNSUPPORTED', '当前版本滑轮连接体阶段不支持接续额外阶段。');
  }
  const s = stages[0];
  if (!obj(s)) return;
  if (s.kind !== 'pulley_system') {
    h.issue('/stages/0/kind', 'UNSUPPORTED', '滑轮连接体须作为唯一阶段。');
    return;
  }
  const p = '/stages/0';
  h.ref(s.body1Id, p + '/body1Id');
  h.ref(s.body2Id, p + '/body2Id');
  if (typeof s.body1Id === 'string' && typeof s.body2Id === 'string' && s.body1Id === s.body2Id) {
    h.issue(p + '/body2Id', 'PRECONDITION_CONFLICT', '绳两端须连接两个不同物体。');
  }
  h.fact(s, 'lightInextensibleString', p + '/lightInextensibleString');
  h.fact(s, 'idealFixedPulley', p + '/idealFixedPulley');
  h.num(s, 'durationSeconds', p + '/durationSeconds', (v) => v > 0, false);
  h.num(s, 'body2DropToGroundM', p + '/body2DropToGroundM', (v) => v > 0, false);
  h.num(s, 'body1TravelLimitM', p + '/body1TravelLimitM', (v) => v > 0, false);
  if (s.durationSeconds == null && s.body2DropToGroundM == null && s.body1TravelLimitM == null) {
    h.missing.push(p + '/durationSeconds');
  }

  const surf = h.block(s, 'surface', p + '/surface');
  if (!surf) return;
  h.choice(surf, 'kind', p + '/surface/kind', ['hanging', 'horizontal', 'incline']);
  if (surf.kind === 'horizontal' || surf.kind === 'incline') {
    if (surf.kind === 'incline') {
      h.num(surf, 'angleDeg', p + '/surface/angleDeg', (v) => v > 0 && v < 90);
    }
    h.num(surf, 'kineticFrictionCoefficient', p + '/surface/kineticFrictionCoefficient', (v) => v >= 0);
    h.num(surf, 'staticFrictionCoefficient', p + '/surface/staticFrictionCoefficient', (v) => v >= 0, false);
    if (surf.slidesAfterRelease != null && typeof surf.slidesAfterRelease !== 'boolean') {
      h.issue(p + '/surface/slidesAfterRelease', 'TYPE', '起动事实须为布尔值或 null。');
    }
    const muk = surf.kineticFrictionCoefficient;
    const mus = surf.staticFrictionCoefficient;
    if (typeof mus === 'number' && typeof muk === 'number' && mus < muk) {
      h.issue(p + '/surface/staticFrictionCoefficient', 'RANGE', '静摩擦因数不应小于动摩擦因数。');
    }

    // 静止释放且粗糙时，检查静摩擦因数或 slidesAfterRelease 前提
    const v0 = initial && typeof initial.speedMps === 'number' ? initial.speedMps : null;
    const g = typeof draft.gravityMps2 === 'number' && draft.gravityMps2 > 0 ? draft.gravityMps2 : null;
    const m1 = bodies.find((b) => b.bodyId === s.body1Id)?.massKg;
    const m2 = bodies.find((b) => b.bodyId === s.body2Id)?.massKg;
    if (v0 === 0 && typeof muk === 'number' && muk > 0 && g != null && typeof m1 === 'number' && typeof m2 === 'number' && (surf.kind !== 'incline' || typeof surf.angleDeg === 'number')) {
      const rad = surf.kind === 'incline' && typeof surf.angleDeg === 'number' ? (surf.angleDeg * Math.PI) / 180 : 0;
      const fg1 = surf.kind === 'incline' ? -m1 * g * Math.sin(rad) : 0;
      const N1 = surf.kind === 'incline' ? m1 * g * Math.cos(rad) : m1 * g;
      const fDrive = m2 * g + fg1;
      const fk = muk * N1;
      const tol = 64 * Number.EPSILON * Math.max(1, Math.abs(fDrive), fk);
      if (Math.abs(fDrive) > tol) {
        if (mus == null && surf.slidesAfterRelease == null) {
          h.missing.push(p + '/surface/staticFrictionCoefficient');
        } else if (typeof mus === 'number' && typeof surf.slidesAfterRelease === 'boolean') {
          const holds = Math.abs(fDrive) <= mus * N1 + tol;
          if (surf.slidesAfterRelease === holds) {
            h.issue(p + '/surface/slidesAfterRelease', 'PRECONDITION_CONFLICT', '题给起动事实与静摩擦上限的判断矛盾。');
          }
        } else if (mus == null && surf.slidesAfterRelease === true && Math.abs(fDrive) <= fk + tol) {
          h.issue(p + '/surface/slidesAfterRelease', 'PRECONDITION_CONFLICT', '驱动力不超过动摩擦力，无法从静止加速滑动。');
        }
      }
    }
  }
}
