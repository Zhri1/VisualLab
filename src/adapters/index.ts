/**
 * 动画库出口。UI 只从这里拿，永远不直接 import mock 文件。
 *
 * —— 接入成员 B 时只改这个文件 ——
 *   import { assembleScene, buildMotion } from "../physics";
 * 并删除下面的 mock 引入。
 */
import type { MotionLibrary } from "./contract";
import { mockMotionLibrary } from "./mockMotionAdapter";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USE_MOCK_PHYSICS = true;

export const motionLibrary: MotionLibrary = mockMotionLibrary;

export { formatErrors } from "./contract";
export type { AssembleResult, BuildMotionResult, MotionLibrary } from "./contract";
