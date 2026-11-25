import type { StagePlanDraft } from './stagePlan.ts';

// 阶段前缀保留原参数；多物体场景只移除前缀未再引用的物体，不重命名ID。
export function truncateStagePlan(plan:StagePlanDraft,through:number):StagePlanDraft{
  if(!Number.isInteger(through)||through<0||through>=plan.stages.length)throw new RangeError('阶段下标无效。');
  const next=structuredClone({...plan,stages:plan.stages.slice(0,through+1)});
  if(!next.bodies)return next;
  const used=new Set<string>();
  function visit(v:unknown){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(k==='bodyIds'&&Array.isArray(x))x.forEach(id=>{if(typeof id==='string')used.add(id);});else if(k==='bodyId'&&typeof x==='string')used.add(x);else visit(x);}}
  next.stages.forEach(visit);next.bodies=next.bodies.filter(b=>b.bodyId!=null&&used.has(b.bodyId));
  if(!next.primaryBodyId||!used.has(next.primaryBodyId))next.primaryBodyId=next.bodies[0]?.bodyId??null;
  return next;
}
