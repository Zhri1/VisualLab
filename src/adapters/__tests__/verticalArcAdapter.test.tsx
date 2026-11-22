import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { motionLibrary } from '../index';
import endpoint from '../../../fixtures/vertical-arc-endpoint.reading.json';
import returning from '../../../fixtures/vertical-arc-return.reading.json';
import { StagePlanEditor } from '../../ui/components/workspace/StagePlanEditor';
import { StagePhysicsCanvas, drawStageScene } from '../../ui/components/workspace/StagePhysicsCanvas';
import type { StagePlanDraft } from '../../physics';

function build(input: StagePlanDraft = endpoint as StagePlanDraft) {
  const scene = motionLibrary.assembleScene(input); if (!scene.ok) throw new Error(JSON.stringify(scene.errors));
  const result = motionLibrary.buildMotion(scene.scene); if (!result.ok) throw new Error(result.message);
  return result.motion;
}
describe('圆弧播放器接线', () => {
  it('透传几何、约束和法向力事件，端点同刻取飞行状态', () => {
    const motion = build();
    expect(motion.segments.map(s => s.kind)).toEqual(['vertical_arc', 'projectile']);
    const start = motion.sampleAt(0); expect(start.constraint?.normalForceN).toBeCloseTo(6, 10);
    start.constraint!.normalForceN = -1;
    expect(motion.sampleAt(0).constraint?.normalForceN).toBeCloseTo(6, 10);
    const event = motion.events.find(e => e.eventKind === 'arc_endpoint')!;
    expect(event.segment).toBe('vertical_arc'); expect(event.position).toEqual({ x: 0, y: .8 });
    expect(event.normalForceBeforeN).toBe(0); expect(event.normalForceAfterN).toBe(0);
    expect(motion.sampleAt(event.timeSeconds).constraint).toBeUndefined();
    expect(motion.sampleAt(event.timeSeconds).velocity).toEqual({ x: -2, y: 0 });
  });
  it('回滑转折可显示零速，时间轴保留返回事件', () => {
    const motion = build(returning as StagePlanDraft);
    const turn = motion.events.find(e => e.eventKind === 'arc_turn')!;
    expect(motion.sampleAt(turn.timeSeconds).velocity).toEqual({ x: 0, y: 0 });
    expect(motion.sampleAt(turn.timeSeconds).constraint?.normalForceN).toBeCloseTo(.5, 10);
    expect(motion.events[motion.events.length - 1].label).toBe('返回圆弧入口');
    expect(motion.sampleAt(Infinity).velocity.x).toBe(-2);
  });
  it('编辑器和辅助文本使用圆弧字段及固定高度，非旧落差', () => {
    const markup = renderToStaticMarkup(<StagePlanEditor draft={endpoint as StagePlanDraft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(markup).toContain('圆弧半径 R'); expect(markup).toContain('圆弧端点角 φ');
    expect(markup).toContain('圆轨道接触侧'); expect(markup).toContain('/stages/1/landingPlaneYM');
    expect(markup).not.toContain('data-field-path="/stages/1/dropHeightM"');
    const canvas = renderToStaticMarkup(<StagePhysicsCanvas motion={build()} time={0} />);
    expect(canvas).toContain('法向力 6.00 牛顿'); expect(canvas).toContain('data-renderer="stage"');
  });
  it('完整计划在斜面提前停止时画布不访问不存在的后段入口', () => {
    const motion = build({ ...endpoint, kind: 'stage_plan', schemaVersion: 1, initial: { speedMps: 1 }, stages: [
      { kind: 'incline_slide', lengthM: 2, angleDeg: 30, kineticFrictionCoefficient: .9 },
      { kind: 'lossless_turn', lossless: true },
      { kind: 'horizontal_slide', kineticFrictionCoefficient: .2, end: { kind: 'distance', distanceM: 2 } },
      ...endpoint.stages,
    ] });
    expect(motion.events.map(e => e.eventKind)).toEqual(['release', 'stop']);
    expect(motion.stageGeometry?.horizontal).toBeUndefined(); expect(motion.stageGeometry?.verticalArc).toBeUndefined();
    const labels: string[] = [];
    const ctx = new Proxy({}, { get: (_target, key) => key === 'measureText' ? () => ({ width: 70 }) : key === 'fillText' ? (text: string) => labels.push(text) : () => {} }) as CanvasRenderingContext2D;
    expect(() => drawStageScene(ctx, 375, 280, motion, motion.durationSeconds)).not.toThrow();
    expect(labels).not.toContain('B'); expect(labels).not.toContain('C');
  });
});
