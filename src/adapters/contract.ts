/**
 * 动画库适配层接口。
 *
 * 成员 B 的实现必须提供这两个函数的等价签名；UI 只认这个接口。
 * 替换方式见 mockMotionAdapter.ts 顶部说明。
 */
import type { FieldError, Motion, Reading, Scene } from "../types";

export type AssembleResult =
  | { ok: true; scene: Scene }
  | { ok: false; errors: FieldError[] };

export type BuildMotionResult =
  | { ok: true; motion: Motion }
  | { ok: false; code: string; message: string };

export interface MotionLibrary {
  assembleScene(reading: Reading): AssembleResult;
  buildMotion(scene: Scene): BuildMotionResult;
}

/** 把 B 返回的字段错误压成一句给人看的话 */
export function formatErrors(errors: FieldError[]): string {
  return errors.map((e) => e.message).join("；");
}
