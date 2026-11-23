import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { motionLibrary } from '../index';
import type { StagePlanDraft } from '../../physics';
import { StagePlanEditor, updateStagePlanNumber } from '../../ui/components/workspace/StagePlanEditor';
import { StagePhysicsCanvas, drawStageScene } from '../../ui/components/workspace/StagePhysicsCanvas';
import complete from '../../../fixtures/incline-projectile.reading.json';
import plane from '../../../fixtures/incline-projectile-fixed-plane.reading.json';
import beforeStop from '../../../fixtures/incline-projectile-stop-before.reading.json';
import atStop from '../../../fixtures/incline-projectile-stop-at.reading.json';
import table from '../../../fixtures/stage-composition.reading.json';
import arc from '../../../fixtures/vertical-arc-composition.reading.json';

function build(input: unknown) {
  const a = motionLibrary.assembleScene(input as StagePlanDraft); if (!a.ok) throw Error(JSON.stringify(a.errors));
  const b = motionLibrary.buildMotion(a.scene); if (!b.ok) throw Error(b.message);
  return b.motion;
}
function labels(input: unknown, last = false) {
  const m = build(input), text: string[] = [];
  const ctx = new Proxy({}, { get: (_target, key) => key === 'measureText' ? () => ({ width: 90 }) : key === 'fillText' ? (s: string) => text.push(s) : () => {} }) as CanvasRenderingContext2D;
  drawStageScene(ctx, 375, 280, m, last ? m.durationSeconds : m.events.find(e => e.eventKind === 'projectile_launch')?.timeSeconds ?? 0);
  return { m, text };
}
describe('斜面离檐工作区接线', () => {
  it.each([complete, plane])('绘图使用真实檐口/地面与两速度分量，参考点不变', p => {
    const { m, text } = labels(p);
    expect(text).toContain('檐口 B'); expect(text).toContain('h = 1.95 m');
    expect(text).toContain('vₓ = 4.00，vᵧ = -3.00 m/s');
    expect(m.stageGeometry?.positionReference).toBe('particle');
    const launch = m.events.find(e => e.eventKind === 'projectile_launch')!;
    expect(launch.segment).toBe('projectile'); expect(launch.velocityAfter!.x).toBeCloseTo(4, 12);
    const html = renderToStaticMarkup(<StagePhysicsCanvas motion={m} time={launch.timeSeconds} />);
    expect(html).toContain('檐口为坐标原点'); expect(html).toContain('竖直速度 -3.00');
  });
  it.each([beforeStop, atStop])('停止仍标计划檐口和停止点，不画未发生的抛体高度', p => {
    const { m, text } = labels(p, true);
    expect(text).toContain('檐口 B'); expect(text).toContain('停止点');
    expect(text.some(s => s.startsWith('h ='))).toBe(false);
    expect(m.stageGeometry?.projectile).toBeUndefined();
    expect(m.sampleAt(Infinity).velocity).toEqual({ x: 0, y: 0 });
  });
  it('零高度在没有正时长抛体段时也能画真实接地平面', () => {
    const p = structuredClone(complete) as StagePlanDraft; p.stages[1].dropHeightM = 0;
    const { text, m } = labels(p, true); expect(text).toContain('h = 0 m');
    expect(m.segments.map(s => s.kind)).toEqual(['incline']);
    expect(m.events[m.events.length - 1].eventKind).toBe('land');
  });
  it('表单按檐口高度补值，固定平面沿用世界坐标', () => {
    const relative = renderToStaticMarkup(<StagePlanEditor draft={complete as StagePlanDraft} onChange={() => {}} missingKeys={['/stages/1/dropHeightM']} fieldErrors={[]} />);
    expect(relative).toContain('檐口到地面高度 h'); expect(relative).toContain('不从坡顶量高度');
    expect(relative).toContain('data-field-path="/stages/1/dropHeightM"');
    const fixed = renderToStaticMarkup(<StagePlanEditor draft={plane as StagePlanDraft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(fixed).toContain('以檐口为(0,0)'); expect(fixed).toContain('data-field-path="/stages/1/landingPlaneYM"');
  });
  it('题给正初速时修改摩擦可重算为提前/恰停，原计划两段保留', () => {
    const p = { ...complete, initial: { speedMps: 2 } } as StagePlanDraft;
    const changed = updateStagePlanNumber(p, 0, 'kineticFrictionCoefficient', 1);
    expect(changed.stages).toHaveLength(2); expect(build(changed).endReason).toBe('stop_before_target');
    expect(build(updateStagePlanNumber(changed, 0, 'lengthM', 1)).endReason).toBe('stop_at_target');
  });
  it.each([table, arc])('旧桌面与圆弧画布不增加檐口标记和分量注释', p => {
    const { text } = labels(p); expect(text).not.toContain('檐口 B');
    expect(text.some(s => s.startsWith('vₓ ='))).toBe(false);
  });
});
