import { criticalRodArc, rodLimitSpeedRatio } from './criticalRodArc.ts';
import { integrate, integrateAdaptive } from './quadrature.ts';
import type { StageSample, VerticalArcGeometry } from './arcTypes.ts';
export type ExplicitArcPath = {
  center?: {xM:number;yM:number}; startAngleDeg:number; direction:'positive'|'negative';
  end:{kind:'physical_endpoint'|'observation';sweepAngleDeg:number};
};
export type CircularStage = {kind:'vertical_arc';radiusM:number;side?:'inside'|'rod';path:ExplicitArcPath};
type CircularMarker = {kind:string;time:number;state:StageSample};
export class CircularRangeError extends RangeError { field: string; constructor(message:string,field:string){super(message);this.field=field;} }
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=16*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE);
export function arcTrig(phi:number){
  const n=Math.round(phi/(Math.PI/2));
  if(phi===0||near(phi,n*Math.PI/2))return{sin:[0,1,0,-1][(n%4+4)%4],cos:[1,0,-1,0][(n%4+4)%4]};
  return{sin:Math.sin(phi),cos:Math.cos(phi)};
}
/** 省略 center 时，根据入口坐标（默认原点）、入口角与半径反算圆心。 */
export function resolveArcCenter(stage:CircularStage,entryPoint?:{xM:number;yM:number}):{xM:number;yM:number}{
  if(stage.path.center)return{...stage.path.center};
  const t0=arcTrig(stage.path.startAngleDeg*Math.PI/180),R=stage.radiusM;
  const ox=entryPoint?.xM??0,oy=entryPoint?.yM??0;
  return{xM:ox-R*t0.sin,yM:oy+R*t0.cos};
}
export function circularGeometry(stage:CircularStage,index:number,entryPoint?:{xM:number;yM:number}):VerticalArcGeometry{
  const p=stage.path,R=stage.radiusM,d=p.direction==='positive'?1:-1,end=p.startAngleDeg+d*p.end.sweepAngleDeg;
  if(end===p.startAngleDeg||end*Math.PI/180===p.startAngleDeg*Math.PI/180)throw new CircularRangeError('圆轨端点角与入口角在当前量级无法区分。','/path/end/sweepAngleDeg');
  const center=resolveArcCenter(stage,entryPoint);
  const at=(a:number)=>{const t=arcTrig(a*Math.PI/180);return{xM:center.xM+R*t.sin,yM:center.yM-R*t.cos};};
  if(![center.xM,center.yM,...Object.values(at(p.startAngleDeg)),...Object.values(at(end))].every(Number.isFinite))throw new CircularRangeError('圆轨世界坐标量级无法表示。','/path/center');
  return{stageIndex:index,center,entry:at(p.startAngleDeg),radiusM:R,startAngleDeg:p.startAngleDeg,endAngleDeg:end,
    side:stage.side??'inside',direction:p.direction,endMode:p.end.kind,plannedEnd:at(end),actualExit:{position:at(p.startAngleDeg),angleDeg:p.startAngleDeg,reason:'range_end'}};
}
export function circularEntry(stage:CircularStage,speed:number,g:number,m:number,index:number,entryPoint?:{xM:number;yM:number}):StageSample{
  const isRod=stage.side==='rod';
  const phi=stage.path.startAngleDeg*Math.PI/180,t=arcTrig(phi),R=stage.radiusM,d=stage.path.direction==='positive'?1:-1;
  const scale=Math.sqrt(R)/Math.sqrt(g),unit=Math.sqrt(R)*Math.sqrt(g),ratio=(speed/unit)**2,N=m*g*(ratio+t.cos),q=d*speed;
  if(![scale,unit,ratio,N,q/R].every(Number.isFinite)||Math.min(scale,unit)<=0)throw new RangeError('圆轨能量比、支持力或角速度量级无法表示。');
  if(!isRod&&N<0&&!near(ratio,-t.cos))throw new Error('入口需要负支持力，无法保持内侧接触。');
  if(speed===0&&t.sin!==0&&-t.sin*d<=0)throw new Error('静止释放的切向重力与声明方向相反。');
  if(!isRod&&speed===0&&t.sin===0&&t.cos<0)throw new Error('最高点零速无法保持内轨接触。');
  const point=circularGeometry(stage,index,entryPoint).entry;
  if(![point.xM,point.yM].every(Number.isFinite))throw new RangeError('圆轨世界坐标量级无法表示。');
  const tolN=1e-12*m*g,rodN=Math.abs(N)<=tolN?0:N;
  return{...point,vxMps:q*t.cos||0,vyMps:q*t.sin||0,springCompressionM:0,constraint:{kind:'vertical_arc',stageIndex:index,angleDeg:stage.path.startAngleDeg,
    angularVelocityRadps:q/R,
    normalForceN:isRod?rodN:(N<0?0:N),
    ...(isRod?{forceRole:(rodN>0?'pull':rodN<0?'support':'none') as 'pull'|'support'|'none'}:{}),
    normalDirection:isRod&&rodN<0?{x:t.sin||0,y:-t.cos||0}:{x:-t.sin||0,y:t.cos}}};
}

// 仅对单调圆轨段作能量积分；转折用摆的同类去奇异代换，反程复用同一张积分表。
export function solveCircularArc(stage:CircularStage,start:StageSample,g:number,m:number,index:number){
  const isRod=stage.side==='rod';
  const R=stage.radiusM,p=stage.path,d=p.direction==='positive'?1:-1,phi0=p.startAngleDeg*Math.PI/180,planned=(p.startAngleDeg+d*p.end.sweepAngleDeg)*Math.PI/180;
  const center=resolveArcCenter(stage,start);
  const u=Math.hypot(start.vxMps,start.vyMps),entry=circularEntry(stage,u,g,m,index,start),geometry=circularGeometry(stage,index,start);
  const t0=arcTrig(phi0),unit=Math.sqrt(R)*Math.sqrt(g),scale=Math.sqrt(R)/Math.sqrt(g),r=(u/unit)**2;
  let h=r-2*t0.cos;
  for(const b of [0,3])if(near(h,b))h=b;
  // h接近0时用能量比的量级吸收抵消误差，绝不使用无穷大的容差。
  if(Math.abs(h)<=16*Number.EPSILON*Math.max(r,Math.abs(2*t0.cos)))h=0;
  const rodEntryLimit=rodLimitSpeedRatio(phi0);
  const rodEnergyExcess=near(r,rodEntryLimit)?0:r-rodEntryLimit;
  const k2=h===0?.5:r/4+Math.sin(phi0/2)**2,k=Math.sqrt(k2);
  const ratioAt=(phi:number)=>{
    if(isRod)return Math.abs(rodEnergyExcess)<1?rodEnergyExcess+rodLimitSpeedRatio(phi):r-4*Math.sin((phi+phi0)/2)*Math.sin((phi-phi0)/2);
    if(h===3)return 1+4*Math.cos(phi/2)**2;
    return h===0?2*arcTrig(phi).cos:r-4*Math.sin((phi+phi0)/2)*Math.sin((phi-phi0)/2);
  };
  const at=(phi:number,q:number,constrained=true):StageSample=>{
    const t=arcTrig(phi);
    const rawN=m*g*(!isRod&&h===3?t.cos===-1?0:6*Math.cos(phi/2)**2:(q/unit)**2+t.cos);
    const tolN=1e-12*m*g,rodN=Math.abs(rawN)<=tolN?0:rawN;
    return{xM:center.xM+R*t.sin,yM:center.yM-R*t.cos,vxMps:q*t.cos||0,vyMps:q*t.sin||0,springCompressionM:0,
      ...(constrained?{constraint:{kind:'vertical_arc' as const,stageIndex:index,angleDeg:phi*180/Math.PI,angularVelocityRadps:q/R,
        normalForceN:isRod?rodN:Math.max(0,rawN),
        ...(isRod?{forceRole:(rodN>0?'pull':rodN<0?'support':'none') as 'pull'|'support'|'none'}:{}),
        normalDirection:isRod&&rodN<0?{x:t.sin||0,y:-t.cos||0}:{x:-t.sin||0,y:t.cos}}}:{})};};
  if(u===0&&t0.sin===0){geometry.actualExit={position:{xM:entry.xM,yM:entry.yM},angleDeg:p.startAngleDeg,reason:'stationary'};
    return{geometry,entry,boundary:entry,end:entry,duration:0,ascentSeconds:0,returns:false,markers:[] as CircularMarker[],sampleAt:()=>({...entry})};}
  const angleSpan=d*(planned-phi0),tol=16*Number.EPSILON*Math.max(1,Math.abs(phi0),Math.abs(planned));
  if (isRod && rodEnergyExcess === 0) {
    const critical = criticalRodArc(phi0, planned, scale, unit);
    const { approachingTop, duration, endAngle, lowestAngle } = critical;
    if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError('圆轨时长无法表示。');
    const remains = approachingTop || p.end.kind === 'observation';
    const boundary = at(endAngle, critical.speedAt(endAngle));
    const end = remains ? boundary : at(endAngle, critical.speedAt(endAngle), false);
    geometry.actualExit = { position: { xM: end.xM, yM: end.yM }, angleDeg: endAngle * 180 / Math.PI, reason: remains ? 'range_end' : 'endpoint' };
    const markers: CircularMarker[] = [];
    if (d * (lowestAngle - phi0) > tol && d * (endAngle - lowestAngle) >= 0) {
      markers.push({ kind: 'arc_lowest', time: lowestAngle === endAngle ? duration : critical.timeAt(lowestAngle), state: at(lowestAngle, critical.speedAt(lowestAngle)) });
    }
    return {
      geometry, entry, boundary, end, duration, ascentSeconds: duration, returns: false, markers, approachingTop,
      sampleAt(time: number) {
        if (time <= 0) return { ...entry };
        if (time >= duration) return { ...end };
        const phi = critical.angleAt(time);
        return at(phi, critical.speedAt(phi));
      },
    };
  }
  function nextRoot(a:number){
    if(!Number.isFinite(a))return Infinity;
    const candidates:number[]=[];
    for(let n=-2;n<=2;n++)for(const base of [a,-a]){const phi=base+2*Math.PI*n,s=d*(phi-phi0);
      if(s>=-tol&&s<=angleSpan+tol&&d*arcTrig(phi).sin>0){
        // 零速释放的入口本身不是后续转折。
        if(s<=tol&&u===0)continue;
        candidates.push(Math.max(0,s));
      }}
    return candidates.length?Math.min(...candidates):Infinity;
  }
  const transformed=isRod?rodEnergyExcess<0:k<1;
  const turnAngle=isRod ? (rodEnergyExcess>-2 ? Math.PI-2*Math.asin(Math.sqrt(-rodEnergyExcess)/2) : 2*Math.asin(k)) : Math.acos(1-2*k2);
  const turnSpan=transformed?nextRoot(turnAngle):Infinity;
  const lossSpan=isRod?Infinity:(h>0&&h<3?nextRoot(Math.acos(-h/3)):Infinity);
  const returns=turnSpan<=angleSpan+tol&&turnSpan<=lossSpan+tol;
  const loses=!returns&&Number.isFinite(lossSpan)&&(lossSpan<angleSpan-tol||p.end.kind==='observation'&&lossSpan<=angleSpan+tol);
  const endSpan=returns?turnSpan:loses?lossSpan:angleSpan,phiEnd=phi0+d*endSpan;
  const well=2*Math.PI*Math.round(phi0/(2*Math.PI));
  const parameter=(phi:number)=>transformed?Math.asin(Math.max(-1,Math.min(1,Math.sin((phi-well)/2)/k))):phi;
  const a=parameter(phi0),b=returns?d*Math.PI/2:parameter(phiEnd),length=Math.abs(b-a);
  const oneMinusK2=isRod?-rodEnergyExcess/4:1-k2;
  const f=(s:number)=>{const v=a+d*s;return transformed?scale/Math.sqrt(Math.cos(v)**2+oneMinusK2*Math.sin(v)**2):scale/Math.sqrt(ratioAt(v));};
  const integrateRange=isRod?integrateAdaptive:integrate;
  const n=96,step=length/n,sums=[0];
  for(let i=0;i<n;i++)sums.push(sums[i]+integrateRange(f,i*step,(i+1)*step));
  const ascentSeconds=sums[n],duration=ascentSeconds*(returns?2:1);
  if(!Number.isFinite(duration)||duration<0||duration===0&&endSpan>0)throw new RangeError('圆轨时长无法表示。');
  const timeFor=(phi:number)=>{
    if(phi===phi0)return 0;if(phi===phiEnd||near(phi,phiEnd))return ascentSeconds;
    const value=Math.abs(parameter(phi)-a),cell=Math.min(n-1,Math.floor(value/step));
    return sums[cell]+integrateRange(f,cell*step,value);
  };
  const exactSpeedAt=(phi:number)=>unit*Math.sqrt(Math.max(0,ratioAt(phi)));
  const qEnd=returns?0:d*exactSpeedAt(phiEnd);
  const boundary=at(phiEnd,qEnd);
  if(loses)boundary.constraint!.normalForceN=0;
  const remains=returns||p.end.kind==='observation'&&!loses;
  const end=returns?at(phi0,-d*u):at(phiEnd,qEnd,remains);
  const exitReason=returns?'returned_to_entry':loses?'contact_lost':remains?'range_end':'endpoint';
  geometry.actualExit={position:{xM:end.xM,yM:end.yM},angleDeg:returns?p.startAngleDeg:phiEnd*180/Math.PI,reason:exitReason};
  function sampleAt(time:number):StageSample{
    if(time<=0)return{...entry};if(time>=duration)return{...end};if(returns&&time===ascentSeconds)return{...boundary};
    const back=returns&&time>ascentSeconds,target=back?duration-time:time;
    let lo=0,hi=n;while(hi-lo>1){const j=(lo+hi)>>>1;if(sums[j]<=target)lo=j;else hi=j;}
    const base=lo*step;let left=base,right=hi*step;
    for(let j=0;j<44;j++){const mid=(left+right)/2;if(sums[lo]+integrateRange(f,base,mid)<target)left=mid;else right=mid;}
    const z=a+d*(left+right)/2,phi=transformed?well+2*Math.asin(Math.max(-1,Math.min(1,k*Math.sin(z)))):z;
    const magnitude=transformed?2*unit*k*Math.cos(z):unit*Math.sqrt(Math.max(0,ratioAt(phi)));
    return at(phi,(back?-d:d)*magnitude);
  }
  const markers:CircularMarker[]=[];
  for(let j=-3;j<=4;j++){const phi=j*Math.PI,s=d*(phi-phi0);if(s>tol&&s<=endSpan+tol){const time=timeFor(phi),state=at(phi,returns&&near(phi,phiEnd)?0:d*exactSpeedAt(phi));
    markers.push({kind:j%2?'arc_top':'arc_lowest',time,state});
    if(returns&&time<ascentSeconds)markers.push({kind:j%2?'arc_top':'arc_lowest',time:duration-time,state:at(phi,-d*exactSpeedAt(phi))});
  }}
  markers.sort((a,b)=>a.time-b.time);
  return{geometry,entry,boundary,end,duration,ascentSeconds,returns,markers,sampleAt};
}
