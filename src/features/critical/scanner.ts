/**
 * 临界参数扫描：对同一题的某个初值做统一重算（引擎纯函数），
 * 用结局签名变化定位临界值（二分），供滑杆探索与双画布对照。
 * 只读引擎，不改物理量定义。
 */
import { motionLibrary } from "../../adapters";
import type { Motion } from "../../types";

export interface Outcome {
  key: string;
  label: string;
}

export function buildFromReading(reading: unknown): Motion | null {
  const assembled = motionLibrary.assembleScene(reading as never);
  if (!assembled.ok) return null;
  const built = motionLibrary.buildMotion(assembled.scene);
  return built.ok ? built.motion : null;
}

/** 深拷贝后按 JSON 路径写入新值；路径不存在时原样返回。 */
export function withParam(reading: unknown, path: (string | number)[], value: number): unknown {
  const clone = JSON.parse(JSON.stringify(reading)) as Record<string, unknown>;
  let cur: unknown = clone;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string, unknown>)?.[path[i]];
    if (cur == null) return reading;
  }
  (cur as Record<string, unknown>)[path[path.length - 1]] = value;
  return clone;
}

export function getParam(reading: unknown, path: (string | number)[]): number | null {
  let cur: unknown = reading;
  for (const key of path) {
    cur = (cur as Record<string, unknown>)?.[key];
    if (cur == null) return null;
  }
  return typeof cur === "number" ? cur : null;
}

const REASON_LABEL: Record<string, string> = {
  stop_before_target: "停在目标前",
  stop_at_target: "恰好停在目标",
  stopped: "摩擦停下",
  landed: "落地",
  spring_detached: "脱离弹簧",
  spring_released: "弹射完成",
  spring_stopped_before_release: "未释放即停",
  spring_stopped_at_release: "恰在释放点停",
  arc_detached: "中途脱轨",
  returned_to_entry: "返回入口",
  prefix_end: "前段结束",
  pendulum_first_turn: "摆到回转点",
  collision_complete: "碰撞完成",
  string_slack: "绳松弛",
  string_retaut_boundary: "到再次张紧边界",
  no_collision: "未相撞",
  approach_range_end: "接近段结束",
  contact_without_impact: "接触无冲击",
  second_contact_boundary: "二次接触边界",
  plank_edge_leave: "滑离板端",
  conveyor_exit: "离开带端",
};

/** 结局签名：终止原因 + 是否脱轨/松绳/离带，足以区分临界两侧。 */
export function outcomeOf(motion: Motion): Outcome {
  const kinds = motion.events.map((e) => e.eventKind ?? e.id);
  const reason = motion.termination?.reason ?? motion.endReason ?? "end";
  const lost = kinds.includes("arc_contact_lost");
  const slack = kinds.includes("string_slack");
  const exit = kinds.includes("conveyor_exit") || kinds.includes("plank_edge_leave");
  const key = `${reason}|${lost ? "lost" : "hold"}|${slack ? "slack" : "taut"}|${exit ? "exit" : "stay"}`;
  const parts = [REASON_LABEL[reason] ?? "过程结束"];
  if (kinds.includes("arc_endpoint")) parts.push(lost ? "未能整圆" : "过圆弧端点");
  if (lost) parts.push("脱轨");
  if (slack) parts.push("松绳");
  if (exit) parts.push("离开接触面");
  return { key, label: parts.join(" · ") };
}

export interface ScanPoint {
  value: number;
  outcome: Outcome;
}

export function scanRange(reading: unknown, path: (string | number)[], lo: number, hi: number, n = 24): ScanPoint[] {
  const points: ScanPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const value = lo + ((hi - lo) * i) / n;
    const motion = buildFromReading(withParam(reading, path, value));
    if (motion) points.push({ value, outcome: outcomeOf(motion) });
  }
  return points;
}

/** 相邻签名不同处二分 refine，返回临界值列表。 */
export function findCriticals(reading: unknown, path: (string | number)[], points: ScanPoint[], iters = 16): { value: number; left: Outcome; right: Outcome }[] {
  const out: { value: number; left: Outcome; right: Outcome }[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].outcome.key === points[i - 1].outcome.key) continue;
    let a = points[i - 1].value;
    let b = points[i].value;
    const left = points[i - 1].outcome;
    for (let k = 0; k < iters; k++) {
      const mid = (a + b) / 2;
      const motion = buildFromReading(withParam(reading, path, mid));
      if (!motion) break;
      if (outcomeOf(motion).key === left.key) a = mid;
      else b = mid;
    }
    out.push({ value: (a + b) / 2, left, right: points[i].outcome });
  }
  return out;
}

/** 默认扫描路径：首阶段初速度（阶段计划）或旧模板 initial.speedMps。 */
export function defaultScanPath(reading: unknown): (string | number)[] | null {
  const r = reading as { stages?: Record<string, unknown>[]; initial?: Record<string, unknown> & { bodies?: Record<string, unknown>[] } };
  const first = r?.stages?.[0];
  if (first) {
    if (typeof first.speedMps === "number") return ["stages", 0, "speedMps"];
    if (typeof first.vxMps === "number") return ["stages", 0, "vxMps"];
  }
  if (typeof r?.initial?.speedMps === "number") return ["initial", "speedMps"];
  if (typeof r?.initial?.vxMps === "number") return ["initial", "vxMps"];
  const firstBody = r?.initial?.bodies?.[0];
  if (firstBody && typeof firstBody.vxMps === "number") return ["initial", "bodies", 0, "vxMps"];
  return null;
}

/** 候选扫描路径：初值之外也允许半径/倾角/劲度/带速/摩擦系数等模型参数。 */
export function candidateScanPaths(reading: unknown): (string | number)[][] {
  const r = reading as { stages?: Record<string, unknown>[]; initial?: Record<string, unknown> & { bodies?: Record<string, unknown>[] } };
  const out: (string | number)[][] = [];
  const first = r?.stages?.[0];
  if (first) {
    if (typeof first.speedMps === "number") out.push(["stages", 0, "speedMps"]);
    if (typeof first.vxMps === "number") out.push(["stages", 0, "vxMps"]);
  }
  if (typeof r?.initial?.speedMps === "number") out.push(["initial", "speedMps"]);
  if (typeof r?.initial?.vxMps === "number") out.push(["initial", "vxMps"]);
  const firstBody = r?.initial?.bodies?.[0];
  if (firstBody && typeof firstBody.vxMps === "number") out.push(["initial", "bodies", 0, "vxMps"]);
  (r?.stages ?? []).forEach((stage, i) => {
    for (const key of ["radiusM", "angleDeg", "kNpm", "initialBeltSpeedMps", "kineticFrictionCoefficient", "speedMps", "vxMps"]) {
      if (typeof stage[key] === "number") out.push(["stages", i, key]);
    }
  });
  return out;
}

const PARAM_LABEL: Record<string, string> = {
  speedMps: "初速度",
  vxMps: "初速度",
  radiusM: "圆弧半径",
  angleDeg: "斜面倾角",
  kNpm: "弹簧劲度系数",
  initialBeltSpeedMps: "带面速度",
  kineticFrictionCoefficient: "摩擦系数",
};
export function paramLabel(path: (string | number)[]): string {
  return PARAM_LABEL[String(path[path.length - 1])] ?? "参数";
}

/** 优先选「扫得出临界值」的路径；全都扫不出时退回第一条可用路径。 */
export function pickScanPath(reading: unknown): (string | number)[] | null {
  const candidates = candidateScanPaths(reading);
  let fallback: (string | number)[] | null = null;
  for (const path of candidates) {
    const bounds = scanBounds(reading, path);
    if (!bounds) continue;
    fallback ??= path;
    const points = scanRange(reading, path, bounds.lo, bounds.hi, 12);
    if (findCriticals(reading, path, points, 8).length > 0) return path;
  }
  return fallback;
}

export function scanBounds(reading: unknown, path: (string | number)[]): { lo: number; hi: number; current: number } | null {
  const current = getParam(reading, path);
  if (current == null) return null;
  const base = Math.max(Math.abs(current), 0.5);
  return { lo: 0, hi: Math.max(base * 2.5, 2), current };
}
