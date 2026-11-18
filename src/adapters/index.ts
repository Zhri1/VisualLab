/**
 * 动画库统一出口，由适配层把 B 的物理结果映射为播放器共享类型。
 */
import type { MotionLibrary } from "./contract";
import { physicsMotionLibrary } from "./physicsMotionAdapter";

export const motionLibrary: MotionLibrary = physicsMotionLibrary;

export { formatErrors } from "./contract";
export type { AssembleResult, BuildMotionResult, MotionLibrary } from "./contract";

