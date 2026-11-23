// 由 scripts/sync-functions.mjs 从 src/physics/bodyTrack.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import {BodyPlanError as PlanError} from './bodyPlanError.ts';
import {landingTime,linearState} from './kinematics.ts';
import {nearValue as close} from './horizontalKinematics.ts';
import type {PolynomialPiece} from './horizontalKinematics.ts';
import type {BodyState,BodyTrackStage} from './multiBodyTypes.ts';
import type {TrackGeometry} from './horizontalTypes.ts';
export type Scalar=Pick<BodyState,'xM'|'yM'|'vxMps'|'vyMps'|'springCompressionM'|'status'>;
export type TrackSegment={kind:BodyTrackStage['kind'];bodyIds:string[];stagePath:string;stageIndex:number;startSeconds:number;endSeconds:number};
const pos=(s:Scalar)=>({xM:s.xM,yM:s.yM});
// 从原摆碰撞目标轨道提取，同一套水平摩擦和重力公式供两种入口复用。
  export function linearBodyTrack(stages:BodyTrackStage[],initial:Scalar,ids:string[],track:number,g:number){
    const segs:TrackSegment[]=[],es:{time:number;kind:string;path:string;before?:Scalar;after?:Scalar}[]=[],geoms:{start:number;value:TrackGeometry}[]=[],runs:{start:number;end:number;at:(t:number)=>Scalar}[]=[];
    let t=0,current:Scalar={...initial},reason:string='prefix_end';
    const pieces:PolynomialPiece[]=[];
    for(const [i,stage]of stages.entries()){
      const path=`/stages/2/tracks/${track}/stages/${i}`,start={...current};let dt=0,end:Scalar,at:(t:number)=>Scalar;
      if(stage.kind==='horizontal_slide'){
        const u=Math.abs(current.vxMps),sign=Math.sign(current.vxMps),a=stage.kineticFrictionCoefficient*g;
        const distance=stage.end.kind==='distance'?stage.end.distanceM:null,stopDistance=a>0?u*u/(2*a):Infinity;
        const stops=u===0||distance===null||stopDistance<distance||close(stopDistance,distance);
        if(distance===null&&a===0&&u>0)throw new PlanError(path+'/end','光滑面上的非零速度不能因摩擦停止。');
        const travelled=stops?(u===0?0:stopDistance):distance!;
        dt=stops?(u===0?0:u/a):2*travelled/(u+Math.sqrt(Math.max(0,u*u-2*a*travelled)));
        if(!Number.isFinite(dt))throw new RangeError('水平阶段时长无法表示。');
        at=x=>({...linearState(start.xM,start.yM,start.vxMps,0,-sign*a,0,x),status:stops&&x>=dt?'resting':'moving'});
        end={...at(dt),xM:start.xM+sign*travelled,...(stops?{vxMps:0,vyMps:0,status:'resting' as const}:{})};
        geoms.push({start:t,value:{bodyIds:ids,stagePath:path,horizontal:{start:pos(start),plannedEnd:distance===null||sign===0?null:{xM:start.xM+sign*distance,yM:start.yM}}}});
        es.push({time:t+dt,kind:stops?'stop':'reach_target',path,before:{...end,status:dt>0?'moving':end.status},after:{...end}});
        reason=stops?(distance===null?'stopped':close(stopDistance,distance)?'stop_at_target':'stop_before_target'):'prefix_end';
      }else if(stage.kind==='projectile'){
        if(stage.landingPlaneYM>start.yM)throw new PlanError(path+'/landingPlaneYM','落地平面不能高于实际发射点。');
        dt=landingTime(start.yM-stage.landingPlaneYM,start.vyMps,g);
        at=x=>({...linearState(start.xM,start.yM,start.vxMps,start.vyMps,0,-g,x),status:x>=dt?'landed':'moving'});
        end={...at(dt),yM:stage.landingPlaneYM,status:'landed'};
        es.push({time:t,kind:i===0?'projectile_launch':'leave_table',path,before:{...start},after:{...start,status:'moving'}});
        const apex=start.vyMps/g;if(apex>0&&apex<dt)es.push({time:t+apex,kind:'apex',path});
        es.push({time:t+dt,kind:'land',path,before:{...end,status:'moving'},after:{...end}});reason='landed';
        geoms.push({start:t,value:{bodyIds:ids,stagePath:path,projectile:{launch:pos(start),landingPlane:{yM:stage.landingPlaneYM}}}});
      }else throw new PlanError(path,'目标轨道模块不支持。');
      if(dt>0){pieces.push({start:t,end:t+dt,x:start.xM,y:start.yM,vx:start.vxMps,vy:start.vyMps,ax:stage.kind==='horizontal_slide'?-Math.sign(start.vxMps)*stage.kineticFrictionCoefficient*g:0,ay:stage.kind==='projectile'?-g:0});segs.push({kind:stage.kind,bodyIds:ids,stagePath:path,stageIndex:2,startSeconds:t,endSeconds:t+dt});runs.push({start:t,end:t+dt,at});}
      t+=dt;current=end;
      if(current.status==='resting'||current.status==='landed')break;
    }
    const final={...current};
    if(final.status==='resting')pieces.push({start:t,end:Infinity,x:final.xM,y:final.yM,vx:0,vy:0,ax:0,ay:0});
    return {duration:t,reason,track,pieces,segments:segs,events:es,geometry:geoms,at(age:number):Scalar{if(age>=t)return {...final};const r=runs.find(r=>age>=r.start&&age<r.end);return r?r.at(age-r.start):{...final};}};
  }
