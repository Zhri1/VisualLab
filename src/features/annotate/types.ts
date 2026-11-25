/** 标注教鞭模块的共享类型。 */

/** 单个采样点。x/y 为 0..1 归一化坐标，t 为采集时的动画时间（秒）。 */
export interface AnnotationPoint {
  x: number;
  y: number;
  t: number;
}

/**
 * 一条笔画。
 * 约定：id 以 "laser-" 开头的笔画视为教鞭（laser）笔画，只短暂显示；
 * 其余（如 "draw-" 前缀）为普通画笔笔画，永久保留。
 */
export interface AnnotationStroke {
  id: string;
  color: string;
  width: number;
  points: AnnotationPoint[];
}

/** 覆盖层交互模式：关闭 / 画笔 / 教鞭。 */
export type AnnotationMode = 'off' | 'draw' | 'laser';
