import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StagePlanEditor, updateStagePlanKind, updateStagePlanNumber } from '../../ui/components/workspace/StagePlanEditor';
import { StagePhysicsCanvas, drawStageScene } from '../../ui/components/workspace/StagePhysicsCanvas';
import fixed from '../../../fixtures/precompressed-spring-fixed-energy.reading.json';
import full from '../../../fixtures/precompressed-spring-complete.reading.json';
import type { StagePlanDraft } from '../../physics';
import { validateStagePlan } from '../../physics';
import { motionLibrary } from '../index';
function build(p: unknown) { const a=motionLibrary.assembleScene(p as StagePlanDraft); if(!a.ok) throw Error(JSON.stringify(a.errors));const b=motionLibrary.buildMotion(a.scene);if(!b.ok) throw Error(b.message);return b.motion; }
describe('预压工作区接线',()=>{
  it('无质量的水平计划切成释放阶段后可填写质量',()=>{
    const p={schemaVersion:1,kind:'stage_plan',gravityMps2:10,initial:{speedMps:0},stages:[{kind:'horizontal_slide',kineticFrictionCoefficient:0,end:{kind:'distance',distanceM:1}}]} as StagePlanDraft;
    const n=updateStagePlanKind(p,0,'spring_release');
    expect(n.stages[0]).toEqual({kind:'spring_release',springConstantNpm:null,initialCompressionM:null,kineticFrictionCoefficient:null,unattached:null,slidesAfterRelease:null});
    expect(renderToStaticMarkup(<StagePlanEditor draft={n} onChange={()=>{}} missingKeys={[]} fieldErrors={[]}/>)).toContain('aria-label="滑块质量 m"');
  });
  it('明确换掉释放首段清除能量及临界条件，可成为普通水平计划',()=>{
    const p={...fixed,stages:[fixed.stages[0]],constraints:[{kind:'critical_arc_top',stageIndex:2}]} as StagePlanDraft;
    const n=updateStagePlanKind(p,0,'horizontal_slide');
    expect(n.energy).toBeUndefined();expect(n.constraints).toBeUndefined();
    n.stages[0]={kind:'horizontal_slide',kineticFrictionCoefficient:0,end:{kind:'distance',distanceM:1}};
    n.initial={speedMps:1};expect(validateStagePlan(n).ok).toBe(true);
  });
  it('入弧速度来源只引用实际前驱：直接释放和经水平段分别接续',()=>{
    const direct=build({...full,stages:[full.stages[0],...full.stages.slice(2)]});
    const paths=direct.calculations!.find(c=>c.quantity==='arc_entry_speed')!.inputPaths;
    expect(paths).toContain('/stages/0/initialCompressionM');expect(paths).not.toContain('/stages/1/end');
    expect(paths.every(p=>p.split('/').slice(1).reduce<unknown>((o,k)=>o!=null?(o as Record<string,unknown>)[k]:undefined,{...full,stages:[full.stages[0],...full.stages.slice(2)]})!==undefined)).toBe(true);
    expect(build(full).calculations!.find(c=>c.quantity==='arc_entry_speed')!.inputPaths).toContain('/stages/1/end');
  });
  it.each([[null,'massKg',.2],[null,'gravityMps2',9.8],[0,'kineticFrictionCoefficient',.3],[1,'kineticFrictionCoefficient',.3]] as const)('修改既有上游 %s/%s 清除前提而保留能量', (index,key,value)=>{
    const next=updateStagePlanNumber(fixed as StagePlanDraft,index,key,value);
    expect(next.stages[0]).toMatchObject({slidesAfterRelease:null,releaseCompleteByM:null});expect(next.energy).toEqual(fixed.energy);
  });
  it.each(['massKg','gravityMps2'])('首次补录未知%s保留事实',key=>{
    const p={...fixed,[key]:null} as StagePlanDraft;const n=updateStagePlanNumber(p,null,key,key==='massKg'?.1:10);
    expect(n.stages[0]).toMatchObject({slidesAfterRelease:true,releaseCompleteByM:2});
  });
  it('更改R或补弹簧参数不清除前提；来源和示意透传',()=>{
    expect(updateStagePlanNumber(fixed as StagePlanDraft,2,'radiusM',.5).stages[0].slidesAfterRelease).toBe(true);
    const m=build(full); expect(m.calculations?.map(c=>c.quantity)).toEqual(['initial_elastic_energy','release_speed','arc_entry_speed']);
    const suffix=build(fixed); expect(suffix.calculations?.map(c=>c.quantity)).toEqual(['initial_elastic_energy','arc_entry_speed']);
    expect(suffix.timing?.mode).toBe('suffix');expect(suffix.stageGeometry?.schematic?.springIconAt).toEqual({xM:0,yM:0});
  });
  it('state_only保留正速度并可绘制，绝不成为假停止',()=>{
    const p={...fixed,stages:fixed.stages.slice(0,2)},m=build(p);expect(m.timing?.mode).toBe('state_only');expect(m.sampleAt(0).velocity.x).toBeGreaterThan(4);
    const ctx=new Proxy({}, {get:(_t,key)=>key==='measureText'?()=>({width:60}):()=>{}}) as CanvasRenderingContext2D;
    expect(()=>drawStageScene(ctx,375,250,m,0)).not.toThrow();expect(renderToStaticMarkup(<StagePhysicsCanvas motion={m} time={0}/>)).toContain('4.47');
  });
});
