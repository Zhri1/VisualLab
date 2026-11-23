import { describe, it, expect } from 'vitest';
import { createPendulum } from '../pendulum';
import { collide1D } from '../collision';
import reference from '../../../fixtures/pendulum-collision.acceptance.json';
const make = (angle = -60, speed = 0, flight = false) => createPendulum(1, 10, 1, angle * Math.PI / 180, speed, flight);
describe('非线性轻绳摆与纯碰撞', () => {
  it('静止角度释放以moving开始；非线性最低点/对面转折/再次最低点均来自同一轨道', () => {
    const p = make(), t = p.endTime('lowest_point');
    expect(p.initial.status).toBe('moving');expect(t).toBeCloseTo(reference.collisionTimeSeconds, 10);
    expect(p.at(t)).toMatchObject({xM:0,yM:0,vyMps:0});expect(p.at(t).vxMps).toBeCloseTo(Math.sqrt(10),10);
    expect(p.endTime('first_turn')).toBeCloseTo(reference.alone.durationSeconds,10);
    expect(p.endTime('first_return_lowest')).toBeCloseTo(3*t,10);
    expect(p.at(3*t).vxMps).toBeCloseTo(-Math.sqrt(10),10);
  });
  it('镜像右侧释放和初始最低点返回',()=>{
    const p=make(60),t=p.endTime('lowest_point');expect(p.at(t).vxMps).toBeCloseTo(-Math.sqrt(10),10);
    const bottom=make(0,Math.sqrt(10));expect(bottom.endTime('first_return_lowest')).toBeCloseTo(2*t,10);
  });
  it('初态和能量比不可表示时拒绝临界吸附',()=>{
    expect(()=>make(0,1e200)).toThrow(RangeError);expect(()=>make(0,Infinity)).toThrow(RangeError);
  });
  it('最低点平衡持续静止',()=>{const p=make(0);expect(p.equilibrium).toBe(true);expect(p.at(1e5)).toMatchObject({status:'resting',tensionN:10,vxMps:0});expect(p.endTime('first_turn')).toBe(0);});
  it.each([-90,90])('%s度从零张力释放仍张紧',angle=>{const p=make(angle);expect(p.initial.tensionN).toBe(0);expect(p.initial.stringState).toBe('taut');expect(p.at(1e-4).tensionN).toBeGreaterThan(0);expect(p.eventsUntil(p.endTime('first_turn')).some(e=>e.kind==='string_slack')).toBe(false);});
  it('2gL临界在90度反向而不松绳',()=>{const p=make(0,Math.sqrt(20)),t=p.firstTurn;expect(p.at(t).tensionN).toBeCloseTo(0,10);expect(p.at(t).vxMps).toBe(0);expect(p.at(t+1e-7).vyMps).toBeLessThan(0);expect(p.at(t+1e-7).stringState).toBe('taut');});
  it('5gL临界完整越顶，张力瞬时零后转正',()=>{const p=make(0,Math.sqrt(50)),t=p.endTime('first_return_lowest');expect(p.at(t/2).yM).toBeCloseTo(2,10);expect(p.at(t/2).tensionN).toBeCloseTo(0,9);expect(p.at(t/2+1e-5).tensionN).toBeGreaterThan(0);expect(p.at(t).vxMps).toBeCloseTo(Math.sqrt(50),10);expect(p.eventsUntil(t).some(e=>e.kind==='string_slack')).toBe(false);});
  it.each([2-1e-8,2+1e-8,5-1e-8,5+1e-8])('能量比%s保留临界两侧',r=>{const p=make(0,Math.sqrt(10*r));expect(Number.isFinite(p.lossTime)).toBe(r>2&&r<5);});
  it('松绳的真实切向速度接自由飞行并到再次张紧前结束',()=>{const p=make(0,Math.sqrt(30),true),r=reference.slack;expect(p.lossTime).toBeCloseTo(r.lossTimeSeconds,10);expect(p.at(p.lossTime).stringState).toBe('slack');expect(p.loss.vxMps).toBeCloseTo(r.loss.vxMps,10);expect(p.limit).toBeCloseTo(r.retautTimeSeconds,10);expect(p.at(p.limit)).toMatchObject({status:'model_boundary',tensionN:0,stringState:'slack'});expect(p.at(p.limit).yM).toBeCloseTo(r.retaut.yM,10);expect(p.eventsUntil(p.limit).map(e=>e.kind)).toEqual(['string_slack','projectile_launch','apex','string_retaut_boundary']);});
  it('初始松绳保持零初速，自由段没有虚构落地',()=>{const p=make(120,0,true);expect(p.initiallySlack).toBe(true);expect(p.initial).toMatchObject({vxMps:0,vyMps:0,stringState:'slack',status:'moving'});expect(p.limit).toBeCloseTo(reference.initialSlack.retautTimeSeconds,10);expect(p.eventsUntil(p.limit).map(e=>e.kind)).toEqual(['string_slack','projectile_launch','string_retaut_boundary']);});
  it('碰撞使用两质量与带符号速度并核对能量',()=>{
    expect(collide1D(1,1,Math.sqrt(10),-1,'elastic')).toMatchObject({v1:-1,v2:Math.sqrt(10),energyLostJ:0});
    const unequal=collide1D(1,3,Math.sqrt(10),0,'elastic');expect(unequal.v1).toBeCloseTo(-Math.sqrt(10)/2,12);expect(unequal.energyAfterJ).toBeCloseTo(unequal.energyBeforeJ,12);
    const stick=collide1D(1,1,Math.sqrt(10),0,'perfectly_inelastic');expect(stick.v1).toBe(stick.v2);expect(stick.energyBeforeJ).toBeCloseTo(5,12);expect(stick.energyAfterJ).toBeCloseTo(2.5,12);
  });
});
