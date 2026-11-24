// 由 scripts/sync-functions.mjs 从 src/physics/blockPlankPlan.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
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

export function validateBlockPlankFields(draft: Obj, h: Helpers): void {
  const bodies = Array.isArray(draft.bodies) ? draft.bodies.filter(obj) : [];
  if (bodies.length > 0 && bodies.length !== 2) {
    h.issue('/bodies', 'PRECONDITION_CONFLICT', '滑块与木板场景需要恰好两个物体（滑块和木板）。');
  }
  const bodyIds = new Set(bodies.map((b) => b.bodyId).filter((id): id is string => typeof id === 'string'));
  const initial = h.block(draft, 'initial', '/initial');
  const initialMap = new Map<string, { xM?: number; vxMps?: number }>();
  if (initial) {
    if (!Array.isArray(initial.bodies)) {
      if (initial.bodies == null) h.missing.push('/initial/bodies');
      else h.issue('/initial/bodies', 'TYPE', '初态物体列表须为数组。');
    } else {
      const seen = new Set<string>();
      initial.bodies.forEach((item, idx) => {
        const p = `/initial/bodies/${idx}`;
        if (!obj(item)) { h.issue(p, 'TYPE', '初态物体须为对象。'); return; }
        h.ref(item.bodyId, p + '/bodyId');
        h.num(item, 'xM', p + '/xM');
        h.num(item, 'vxMps', p + '/vxMps');
        if (typeof item.bodyId === 'string') {
          if (seen.has(item.bodyId)) h.issue(p + '/bodyId', 'PRECONDITION_CONFLICT', '初态物体 ID 不能重复。');
          seen.add(item.bodyId);
          initialMap.set(item.bodyId, {
            xM: typeof item.xM === 'number' ? item.xM : undefined,
            vxMps: typeof item.vxMps === 'number' ? item.vxMps : undefined,
          });
        }
      });
      for (const id of bodyIds) {
        if (!seen.has(id)) h.missing.push('/initial/bodies');
      }
    }
  }
  const stages = Array.isArray(draft.stages) ? draft.stages : [];
  if (stages.length > 1) {
    h.issue('/stages/1/kind', 'UNSUPPORTED', '当前版本滑块与木板阶段不支持接续额外阶段。');
  }
  const s = stages[0];
  if (!obj(s)) return;
  if (s.kind !== 'block_plank') {
    h.issue('/stages/0/kind', 'UNSUPPORTED', '滑块与木板阶段须作为唯一阶段。');
    return;
  }
  const p = '/stages/0';
  h.ref(s.blockBodyId, p + '/blockBodyId');
  h.ref(s.plankBodyId, p + '/plankBodyId');
  if (typeof s.blockBodyId === 'string' && typeof s.plankBodyId === 'string' && s.blockBodyId === s.plankBodyId) {
    h.issue(p + '/plankBodyId', 'PRECONDITION_CONFLICT', '滑块与木板须为两个不同物体。');
  }
  h.num(s, 'plankLengthM', p + '/plankLengthM', (v) => v > 0);
  h.num(s, 'kineticFrictionCoefficient', p + '/kineticFrictionCoefficient', (v) => v >= 0);
  h.num(s, 'staticFrictionCoefficient', p + '/staticFrictionCoefficient', (v) => v >= 0, false);
  h.fact(s, 'groundFrictionless', p + '/groundFrictionless');
  h.num(s, 'postCommonDurationSeconds', p + '/postCommonDurationSeconds', (v) => v >= 0, false);

  if (typeof s.staticFrictionCoefficient === 'number' && typeof s.kineticFrictionCoefficient === 'number' && s.staticFrictionCoefficient < s.kineticFrictionCoefficient) {
    h.issue(p + '/staticFrictionCoefficient', 'RANGE', '静摩擦因数不应小于动摩擦因数。');
  }

  let postForce: { Fb?: number; Fp?: number; dur?: number } | null = null;
  if (s.postCommonForce != null) {
    if (!obj(s.postCommonForce)) {
      h.issue(p + '/postCommonForce', 'TYPE', '共速后外力配置须为对象。');
    } else {
      const f = s.postCommonForce;
      h.num(f, 'blockForceXN', p + '/postCommonForce/blockForceXN');
      h.num(f, 'plankForceXN', p + '/postCommonForce/plankForceXN');
      h.num(f, 'durationSeconds', p + '/postCommonForce/durationSeconds', (v) => v > 0);
      postForce = {
        Fb: typeof f.blockForceXN === 'number' ? f.blockForceXN : undefined,
        Fp: typeof f.plankForceXN === 'number' ? f.plankForceXN : undefined,
        dur: typeof f.durationSeconds === 'number' ? f.durationSeconds : undefined,
      };
    }
  }

  // 初态滑块须位于木板 [plank.xM, plank.xM + plankLengthM] 范围内
  if (typeof s.blockBodyId === 'string' && typeof s.plankBodyId === 'string' && typeof s.plankLengthM === 'number' && s.plankLengthM > 0) {
    const ib = initialMap.get(s.blockBodyId), ip = initialMap.get(s.plankBodyId);
    if (ib?.xM != null && ip?.xM != null) {
      const rel = ib.xM - ip.xM;
      const tol = 32 * Number.EPSILON * Math.max(1, s.plankLengthM, Math.abs(ib.xM), Math.abs(ip.xM));
      if (rel < -tol || rel > s.plankLengthM + tol) {
        h.issue('/initial/bodies', 'PRECONDITION_CONFLICT', '滑块初位置不在木板长度范围内。');
      }
      if (s.kineticFrictionCoefficient === 0 && ib.vxMps != null && ip.vxMps != null && ib.vxMps === ip.vxMps && !postForce && !s.postCommonDurationSeconds) {
        // 允许 0 时长静止/匀速共速，无冲突
      }
    }
  }

  // 若共速后施加外力且所需静摩擦力非零，静摩擦因数必填（严禁默认 μs = μk）
  if (postForce && postForce.Fb != null && postForce.Fp != null && typeof s.blockBodyId === 'string' && typeof s.plankBodyId === 'string') {
    const m = bodies.find((b) => b.bodyId === s.blockBodyId)?.massKg;
    const M = bodies.find((b) => b.bodyId === s.plankBodyId)?.massKg;
    if (typeof m === 'number' && typeof M === 'number' && m > 0 && M > 0) {
      const fsReq = (m * postForce.Fp - M * postForce.Fb) / (m + M);
      if (Math.abs(fsReq) > 64 * Number.EPSILON * Math.max(1, Math.abs(m * postForce.Fp), Math.abs(M * postForce.Fb)) && s.staticFrictionCoefficient == null) {
        h.missing.push(p + '/staticFrictionCoefficient');
      }
    }
  }
}
