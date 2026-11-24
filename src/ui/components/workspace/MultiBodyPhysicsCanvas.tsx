import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Motion, Vec2 } from '../../../types';
import { formatSpeed } from './playback';
import './multiBody.css';

const INK='#1c1c1c',TARGET='#386e8a',SOFT='#777770',HAIR='#d6d6d1',PAPER='#fbfbf9';
const FONT='-apple-system,"Segoe UI","PingFang SC",sans-serif';
const signed=(value:number)=>Math.abs(value)<.005?'0':value.toFixed(2);
export const bodyStatusText={moving:'运动中',resting:'静止',turning:'转折，随后反向',landed:'接地瞬间',model_boundary:'已知范围边界'};
function drawingData(motion:Motion){
  const times=[...new Set([0,motion.durationSeconds,...motion.events.map(e=>e.timeSeconds),...Array.from({length:97},(_,i)=>motion.durationSeconds*i/96)])].sort((a,b)=>a-b);
  const curves:Record<string,Vec2[]>=Object.create(null),points:Vec2[]=[];
  for(const t of times)for(const[id,b]of Object.entries(motion.sampleAt(t).bodies??{})){(curves[id]??=[]).push(b.position);points.push(b.position);
    if(motion.stageGeometry?.plank?.plankBodyId===id)points.push({x:b.position.x+motion.stageGeometry.plank.plankLengthM,y:b.position.y});}
  for(const p of motion.stageGeometry?.pendulums??[])points.push({x:p.pivot.xM,y:p.pivot.yM},{x:p.lowestPoint.xM,y:p.lowestPoint.yM});
  if(motion.stageGeometry?.pulley){const pl=motion.stageGeometry.pulley;points.push({x:pl.pulley.xM,y:pl.pulley.yM},{x:pl.body1Start.xM,y:pl.body1Start.yM},{x:pl.body2Start.xM,y:pl.body2Start.yM});if(pl.groundYM!=null)points.push({x:pl.body2Start.xM,y:pl.groundYM});}
  for(const tr of motion.stageGeometry?.bodyTracks??[]){if(tr.horizontal){points.push({x:tr.horizontal.start.xM,y:tr.horizontal.start.yM});if(tr.horizontal.plannedEnd)points.push({x:tr.horizontal.plannedEnd.xM,y:tr.horizontal.plannedEnd.yM});}if(tr.projectile?.landingPlane)points.push({x:tr.projectile.launch.xM,y:tr.projectile.landingPlane.yM});}
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return{curves,ids:Object.keys(curves).sort(),bounds:{x1:Math.min(...xs)-.2,x2:Math.max(...xs)+.2,y1:Math.min(...ys)-.2,y2:Math.max(...ys)+.2}};
}
export function drawMultiBodyScene(ctx:CanvasRenderingContext2D,W:number,H:number,motion:Motion,time:number,tracked?:string,data=drawingData(motion)){
  const horizontal=motion.stagePlan?.stages[0]?.kind==='horizontal_approach';
  const snapshot=motion.sampleAt(time),b=data.bounds,bw=Math.max(.8,b.x2-b.x1),bh=Math.max(.8,b.y2-b.y1),pad=28;
  const S=Math.min((W-2*pad)/bw,(H-2*pad)/bh),ox=(W-bw*S)/2-b.x1*S,oy=(H-bh*S)/2+b.y2*S;
  const X=(x:number)=>ox+x*S,Y=(y:number)=>oy-y*S,color=(id:string)=>data.ids.indexOf(id)===0?INK:TARGET;
  ctx.clearRect(0,0,W,H);ctx.fillStyle=PAPER;ctx.fillRect(0,0,W,H);ctx.lineWidth=1.3;ctx.font=`12px ${FONT}`;ctx.textBaseline='alphabetic';
  for(const[id,points]of Object.entries(data.curves)){ctx.save();ctx.setLineDash([3,5]);ctx.strokeStyle=HAIR;ctx.beginPath();points.forEach((p,i)=>i===0?ctx.moveTo(X(p.x),Y(p.y)):ctx.lineTo(X(p.x),Y(p.y)));ctx.stroke();ctx.restore();
    const initial=points[0],now=snapshot.bodies?.[id];if(now&&Math.hypot(now.position.x-initial.x,now.position.y-initial.y)*S>18){ctx.save();ctx.setLineDash([3,3]);ctx.strokeStyle=color(id);ctx.beginPath();ctx.arc(X(initial.x),Y(initial.y),5,0,2*Math.PI);ctx.stroke();ctx.restore();}}
  // 标签防重叠：先画几何与物体，把物体/支点占位记入 occupied，
  // 再为所有文字（速度、张力、接触点、地面、P/O）按优先级挑选不冲突的行。
  type Req={text:string;color:string;cx:number;by:number;dir:1|-1;leader?:{x:number;y:number}};
  const reqs:Req[]=[],vel:Req[]=[];
  const occupied:{x:number;y:number;w:number;h:number}[]=[];
  const block=(x:number,y:number,r:number)=>occupied.push({x:x-r,y:y-r,w:2*r,h:2*r});
  const marked=new Set<string>();
  for(const tr of motion.stageGeometry?.bodyTracks??[]){
    if(tr.horizontal){const p=tr.horizontal,end=p.plannedEnd??{xM:motion.sampleAt(motion.durationSeconds).bodies?.[tr.bodyIds[0]]?.position.x??p.start.xM,yM:p.start.yM};ctx.strokeStyle=INK;ctx.beginPath();ctx.moveTo(X(p.start.xM),Y(p.start.yM));ctx.lineTo(X(end.xM),Y(end.yM));ctx.stroke();if(p.plannedEnd){const label=horizontal&&tr.stagePath.startsWith('/stages/0/')?'实际接触点':'桌沿 / 目标',key=`${label}:${end.xM}:${end.yM}`;if(!marked.has(key)){reqs.push({text:label,color:SOFT,cx:X(end.xM),by:Y(end.yM)+19,dir:1});marked.add(key);}}}
    if(tr.projectile?.landingPlane){const y=tr.projectile.landingPlane.yM;ctx.strokeStyle=INK;ctx.beginPath();ctx.moveTo(X(b.x1+.1),Y(y));ctx.lineTo(X(b.x2-.1),Y(y));ctx.stroke();const text=`地面 y = ${y} m`;reqs.push({text,color:SOFT,cx:X(b.x1+.1)+ctx.measureText(text).width/2,by:Y(y)+17,dir:1});}
  }
  for(const p of motion.stageGeometry?.pendulums??[]){const px=X(p.pivot.xM),py=Y(p.pivot.yM);ctx.strokeStyle=INK;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(px-19,py-6);ctx.lineTo(px+19,py-6);ctx.moveTo(px,py-6);ctx.lineTo(px,py+3);ctx.stroke();occupied.push({x:px-19,y:py-8,w:38,h:12});reqs.push({text:'P',color:INK,cx:px+26,by:py-2,dir:-1});reqs.push({text:'O',color:SOFT,cx:X(p.lowestPoint.xM)+13,by:Y(p.lowestPoint.yM)+18,dir:1});}
  if(motion.stageGeometry?.plank){
    const pg=motion.stageGeometry.plank,pb=snapshot.bodies?.[pg.plankBodyId];
    if(pb){
      const y0=Y(pb.position.y),xL=X(pb.position.x),xR=X(pb.position.x+pg.plankLengthM);
      ctx.save();ctx.strokeStyle=HAIR;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(b.x1+.05),y0+10);ctx.lineTo(X(b.x2-.05),y0+10);ctx.stroke();
      ctx.fillStyle='#eaeae6';ctx.strokeStyle=TARGET;ctx.lineWidth=1.6;ctx.fillRect(xL,y0+2,Math.max(8,xR-xL),8);ctx.strokeRect(xL,y0+2,Math.max(8,xR-xL),8);ctx.restore();
      occupied.push({x:xL,y:y0+2,w:Math.max(8,xR-xL),h:10});
      reqs.push({text:`木板 L=${pg.plankLengthM} m`,color:SOFT,cx:(xL+xR)/2,by:y0+26,dir:1});
    }
  }
  if(motion.stageGeometry?.pulley){
    const pl=motion.stageGeometry.pulley,px=X(pl.pulley.xM),py=Y(pl.pulley.yM);
    ctx.save();ctx.strokeStyle=INK;ctx.lineWidth=1.6;
    if(pl.surfaceKind==='horizontal'||pl.surfaceKind==='incline'){
      ctx.beginPath();ctx.moveTo(X(pl.body1Start.xM),Y(pl.body1Start.yM));ctx.lineTo(px,py);ctx.stroke();
    }
    if(pl.groundYM!=null){
      const gy=Y(pl.groundYM);ctx.beginPath();ctx.moveTo(X(b.x1+.1),gy);ctx.lineTo(X(b.x2-.1),gy);ctx.stroke();
      reqs.push({text:'地面支撑',color:SOFT,cx:X(pl.body2Start.xM)+36,by:gy+16,dir:1});
    }
    ctx.fillStyle=PAPER;ctx.beginPath();ctx.arc(px,py,9,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(px,py,2.2,0,2*Math.PI);ctx.fillStyle=INK;ctx.fill();ctx.restore();
    occupied.push({x:px-11,y:py-11,w:22,h:22});
  }
  for(const c of Object.values(snapshot.constraints??{})){
    if(c.kind==='pulley_string'){
      const b1=snapshot.bodies?.[c.bodyIds[0]],b2=snapshot.bodies?.[c.bodyIds[1]];if(!b1||!b2)continue;
      ctx.save();ctx.strokeStyle=c.state==='taut'?INK:SOFT;ctx.lineWidth=c.state==='taut'?1.8:1.2;if(c.state==='slack')ctx.setLineDash([4,5]);
      ctx.beginPath();ctx.moveTo(X(b1.position.x),Y(b1.position.y));ctx.lineTo(X(c.pivot.xM),Y(c.pivot.yM));ctx.lineTo(X(b2.position.x),Y(b2.position.y));ctx.stroke();ctx.restore();
      reqs.push({text:c.state==='taut'?`T = ${c.tensionN.toFixed(2)} N`:'松绳 · T = 0 N',color:SOFT,cx:Math.max(70,Math.min(W-70,X(c.pivot.xM)+58)),by:Math.max(18,Y(c.pivot.yM)-14),dir:-1});
      continue;
    }
    const body=snapshot.bodies?.[c.bodyIds[0]];if(!body)continue;
    ctx.save();ctx.strokeStyle=c.state==='taut'?INK:SOFT;ctx.lineWidth=c.state==='taut'?1.8:1.2;if(c.state==='slack')ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(X(c.pivot.xM),Y(c.pivot.yM));ctx.lineTo(X(body.position.x),Y(body.position.y));ctx.stroke();ctx.restore();
    reqs.push({text:c.state==='taut'?`T = ${c.tensionN.toFixed(2)} N`:'松绳 · T = 0 N',color:SOFT,cx:Math.max(70,Math.min(W-70,X(c.pivot.xM)+79)),by:Math.max(18,Y(c.pivot.yM)+21),dir:1});
  }
  for(const[id,body]of Object.entries(snapshot.bodies??{})){
    const x=X(body.position.x),y=Y(body.position.y),i=data.ids.indexOf(id),speed=Math.hypot(body.velocity.x,body.velocity.y);
    block(x,y,id===(tracked??motion.primaryBodyId)?14:(i===0?5:8)+3);
    ctx.save();ctx.strokeStyle=color(id);ctx.fillStyle=color(id);ctx.lineWidth=2;
    if(id===(tracked??motion.primaryBodyId)){ctx.beginPath();ctx.arc(x,y,12,0,2*Math.PI);ctx.strokeStyle=HAIR;ctx.stroke();ctx.strokeStyle=color(id);}
    ctx.beginPath();ctx.arc(x,y,i===0?5:8,0,2*Math.PI);if(i===0)ctx.fill();else ctx.stroke();
    if(speed>.01){const ux=body.velocity.x/speed,uy=-body.velocity.y/speed,len=Math.min(53,24+speed*5);const ex=Math.max(10,Math.min(W-10,x+ux*len)),ey=Math.max(10,Math.min(H-10,y+uy*len)),a=Math.atan2(ey-y,ex-x);ctx.beginPath();ctx.moveTo(x+ux*12,y+uy*12);ctx.lineTo(ex,ey);ctx.moveTo(ex-7*Math.cos(a-.45),ey-7*Math.sin(a-.45));ctx.lineTo(ex,ey);ctx.lineTo(ex-7*Math.cos(a+.45),ey-7*Math.sin(a+.45));ctx.stroke();}
    const name=id.length>12?id.slice(0,11)+'…':id;
    vel.push({text:`${name}: v = ${formatSpeed(speed)} m/s`,color:color(id),cx:x,by:y-19,dir:-1,leader:{x,y}});
    ctx.restore();
  }
  const rects=occupied.slice();
  const fits=(r:{x:number;y:number;w:number;h:number})=>!rects.some(p=>r.x<p.x+p.w&&p.x<r.x+r.w&&r.y<p.y+p.h&&p.y<r.y+r.h);
  for(const q of [...vel,...reqs]){
    const w=ctx.measureText(q.text).width+6,h=17;
    const cx=Math.max(w/2+4,Math.min(W-w/2-4,q.cx));
    const cand=[q.by,q.by+q.dir*16,q.by+q.dir*32,q.by-q.dir*16,q.by+q.dir*48,q.by-q.dir*32];
    let by:number|null=null,rect:{x:number;y:number;w:number;h:number}|null=null;
    for(const t of cand){const r={x:cx-w/2,y:t-13,w,h};if(r.y<2||r.y+h>H-2)continue;if(fits(r)){by=t;rect=r;break;}}
    if(by===null||!rect){by=Math.max(15,Math.min(H-6,cand[cand.length-1]));rect={x:cx-w/2,y:by-13,w,h};}
    rects.push(rect);
    if(q.leader&&Math.abs(by-q.by)>=12){ctx.save();ctx.strokeStyle=HAIR;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(q.leader.x,q.leader.y);ctx.lineTo(cx,by+(q.dir===-1?4:-13));ctx.stroke();ctx.restore();}
    ctx.fillStyle=PAPER;ctx.fillRect(rect.x,rect.y,w,h);ctx.fillStyle=q.color;ctx.textAlign='center';ctx.fillText(q.text,cx,by);
  }
}
/** 逐物体读数。默认渲染在画布内；工作台把它移进「路段与计时」折叠区，
 *  让画布卡片与单物体版保持同一布局（画布独占整块 frame）。 */
export function MultiBodyReadouts({motion,time,isPlaying=false}:{motion:Motion;time:number;isPlaying?:boolean}){
  const sample=motion.sampleAt(time),ids=Object.keys(sample.bodies??{}).sort(),firstKind=motion.stagePlan?.stages[0]?.kind,horizontal=firstKind==='horizontal_approach'||firstKind==='block_plank';
  return <figcaption id="multi-body-readouts" className={'multi-body-readouts'+(ids.some(id=>id.length>16)?' has-long-ids':'')+(horizontal?' has-horizontal-states':'')} aria-live={isPlaying?'off':'polite'}>
    {ids.map((id,i)=>{const b=sample.bodies![id];return <span className="body-body-value" key={id} data-body-id={id}><i className="body-swatch" style={{background:i===0?INK:TARGET}}/>{id}：v = {formatSpeed(Math.hypot(b.velocity.x,b.velocity.y))} m/s；{bodyStatusText[b.status]}{b.groupId?' · 粘连':''}{horizontal&&<><br/>x = {signed(b.position.x)}，y = {signed(b.position.y)} m<br/>vₓ = {signed(b.velocity.x)}，vᵧ = {signed(b.velocity.y)} m/s</>}</span>;})}
    {Object.values(sample.constraints??{}).map(c=><span className="body-constraint" key={c.constraintId}>{c.bodyIds.join(' + ')}：{c.state==='taut'?'绳张紧':'绳松弛'}，总张力 T = {c.tensionN.toFixed(2)} N</span>)}
  </figcaption>;
}
export function MultiBodyPhysicsCanvas({motion,time,isPlaying=false,trackedBodyId,readouts=true}:{motion:Motion;time:number;isPlaying?:boolean;trackedBodyId?:string;readouts?:boolean}){
  const ref=useRef<HTMLCanvasElement|null>(null),size=useRef({w:0,h:0}),frame=useRef<number|null>(null),data=useMemo(()=>drawingData(motion),[motion]);
  const current=useRef({motion,time,trackedBodyId,data});current.current={motion,time,trackedBodyId,data};
  const paint=useCallback(()=>{const canvas=ref.current,ctx=canvas?.getContext('2d');if(ctx&&size.current.w){const p=current.current;drawMultiBodyScene(ctx,size.current.w,size.current.h,p.motion,p.time,p.trackedBodyId,p.data);}},[]);
  useEffect(()=>{const canvas=ref.current;if(!canvas)return;const resize=()=>{const box=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;size.current={w:box.width,h:box.height};canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);canvas.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);paint();};resize();const observer=new ResizeObserver(resize);observer.observe(canvas);return()=>observer.disconnect();},[paint]);
  useEffect(()=>{frame.current=requestAnimationFrame(paint);return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);};},[time,motion,trackedBodyId,paint]);
  return <figure className="multi-body-figure" data-renderer="multi-body"><canvas ref={ref} role="img" aria-label={motion.stageGeometry?.pulley?'轻绳与理想定滑轮连接体同步动画':motion.stageGeometry?.plank?'滑块与可移动木板同步动画':motion.stageGeometry?.pendulums?.length?'轻绳摆与物体同步动画，P为支点，O为最低点':'两物体水平正碰与碰后同步运动'} aria-describedby="multi-body-readouts"/>{readouts&&<MultiBodyReadouts motion={motion} time={time} isPlaying={isPlaying}/>}</figure>;
}
