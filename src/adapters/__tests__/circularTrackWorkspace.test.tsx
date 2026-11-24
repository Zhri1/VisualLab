import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {motionLibrary} from '../index';
import {validateStagePlan,type StagePlanDraft} from '../../physics';
import {StagePlanEditor,updateCircularField,updateCircularMode} from '../../ui/components/workspace/StagePlanEditor';
import {StagePhysicsCanvas,drawStageScene} from '../../ui/components/workspace/StagePhysicsCanvas';
import {PhysicsExplanation} from '../../ui/components/workspace/PhysicsExplanation';
const read=(name='critical')=>JSON.parse(readFileSync(new URL(`../../../fixtures/circular-track-${name}.reading.json`,import.meta.url),'utf8'));
const build=(p:StagePlanDraft)=>{const a=motionLibrary.assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a.errors));const b=motionLibrary.buildMotion(a.scene);if(!b.ok)throw Error(b.message);return b.motion;};
const form=(p:StagePlanDraft,missing:string[]=[])=>renderToStaticMarkup(<StagePlanEditor draft={p} onChange={()=>{}} missingKeys={missing} fieldErrors={[]}/>);
describe('显式圆轨工作区',()=>{
 it('表单补圆心、入口、方向与观察性质，缺叶子只补该值',()=>{
  const p=read('offset');p.stages[0].path.center.xM=null;const v=validateStagePlan(p);if(v.ok)throw Error();const html=form(v.reading!,v.missingKeys);
  for(const text of ['阶段 1 圆心 x','阶段 1 圆心 y','阶段 1 入口角 φ₀','阶段 1 计划角程','阶段 1 行进方向','阶段 1 圆轨结束方式','/stages/0/path/center/xM'])expect(html).toContain(text);
  expect(html).not.toContain('圆弧端点角 φ');expect(build(updateCircularField(v.reading!,0,['center','xM'],2)).endReason).toBe('landed');
 });
 it('几何模式互斥、切换不猜圆心，旧模式仍可补端点',()=>{
  const p=read(),legacy=updateCircularMode(p,0,false);expect(legacy.stages[0]).not.toHaveProperty('path');expect(legacy.stages[0].endAngleDeg).toBe(null);expect(form(legacy)).toContain('圆弧端点角 φ');
  const explicit=updateCircularMode(legacy,0,true);expect(explicit.stages[0]).not.toHaveProperty('endAngleDeg');expect((explicit.stages[0].path as {center:{xM:null}}).center.xM).toBe(null);
  expect(updateCircularField(p,0,['end','kind'],'physical_endpoint').stages[0].radiusM).toBe(.4);
 });
 it.each(['critical','below','above','offset','mirrored','observation','incline'])('%s画布使用真实世界圆心和展开弧段，支持力与末态可读',name=>{
  const m=build(read(name)),labels:string[]=[],lines:number[][]=[];const ctx=new Proxy({}, {get:(_t,k)=>k==='measureText'?()=>({width:90}):k==='fillText'?(s:string)=>labels.push(s):k==='lineTo'?(...v:number[])=>lines.push(v):()=>{}}) as CanvasRenderingContext2D;
  expect(()=>drawStageScene(ctx,375,300,m,m.durationSeconds)).not.toThrow();expect(lines.length).toBeGreaterThan(80);
  if(name==='critical'||name==='above')expect(labels).toContain('入口 · 观察一圈');if(name==='observation')expect(labels).toContain('观察终点');if(name==='below')expect(labels).toContain('实际脱轨');
  const html=renderToStaticMarkup(<StagePhysicsCanvas motion={m} time={m.durationSeconds}/>);if(name==='critical')expect(html).toContain('保持圆轨接触');
  if(name==='offset')expect(html).toContain('当前无圆轨约束');
 });
 it('临界顶点说明不能显示离轨，范围末帧保留观察说明',()=>{
  const m=build(read()),T=m.events.find(e=>e.eventKind==='arc_top')!.timeSeconds;
  const top=renderToStaticMarkup(<PhysicsExplanation motion={m} time={T}/>),end=renderToStaticMarkup(<PhysicsExplanation motion={m} time={m.durationSeconds}/>);
  expect(top).toContain('经过圆轨最高点');expect(top).not.toContain('沿切线飞出');expect(end).toContain('圆轨观察终点');expect(end).toContain('物体仍沿轨道运动');expect(m.segments[0].formula).toContain('cosφ₀');
  const a=m.sampleAt(T);a.constraint!.normalDirection!.y=123;expect(m.sampleAt(T).constraint!.normalDirection!.y).toBe(-1);
  const high=build(read('above')),t=high.events.find(e=>e.eventKind==='arc_top')!.timeSeconds;expect(renderToStaticMarkup(<StagePhysicsCanvas motion={high} time={t}/>)).toContain('0.0010 牛顿');
 });
 it('整圈不被读数背景遮成断口，零力顶点不画支持力箭头',()=>{
  const m=build(read()),labels:string[]=[],rects:number[][]=[],ctx=new Proxy({}, {get:(_t,k)=>k==='measureText'?()=>({width:90}):k==='fillText'?(s:string)=>labels.push(s):k==='fillRect'?(...v:number[])=>rects.push(v):()=>{}}) as CanvasRenderingContext2D;
  drawStageScene(ctx,375,300,m,m.durationSeconds);expect(rects).toEqual([[0,0,375,300]]);expect(labels).toContain('入口 · 观察一圈');
  labels.length=0;drawStageScene(ctx,375,300,m,m.events.find(e=>e.eventKind==='arc_top')!.timeSeconds);expect(labels).not.toContain('N');expect(labels).toContain('N = 0.00 N');
 });
});
