import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Motion, Vec2 } from '../../../types';
import { formatSpeed } from './playback';
import { computeWorldBounds, fitViewport } from './canvasViewport';
import { forcesAt } from '../../../features/forces/forceModel';
import { drawForceArrows } from '../../../features/forces/drawForces';
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
  for(const p of motion.stageGeometry?.pendulums??[]){points.push({x:p.pivot.xM,y:p.pivot.yM},{x:p.lowestPoint.xM,y:p.lowestPoint.yM});if(p.peg)points.push({x:p.peg.xM,y:p.peg.yM},{x:p.peg.xM,y:p.peg.yM+p.peg.effectiveLengthM});}
  if(motion.stageGeometry?.conveyor){const cv=motion.stageGeometry.conveyor;points.push({x:cv.minXM,y:0},{x:cv.maxXM,y:0});}
  if(motion.stageGeometry?.pulley){const pl=motion.stageGeometry.pulley;points.push({x:pl.pulley.xM,y:pl.pulley.yM},{x:pl.body1Start.xM,y:pl.body1Start.yM},{x:pl.body2Start.xM,y:pl.body2Start.yM});if(pl.groundYM!=null)points.push({x:pl.body2Start.xM,y:pl.groundYM});}
  if(motion.stageGeometry?.switchableEM){const em=motion.stageGeometry.switchableEM;for(const c of em.circles){points.push({x:c.center.xM-c.radiusM,y:c.center.yM-c.radiusM},{x:c.center.xM+c.radiusM,y:c.center.yM+c.radiusM});}points.push({x:em.tangency.xM,y:em.tangency.yM},{x:em.switchOffX,y:0});for(const lm of motion.stageGeometry.landmarks??[])points.push({x:lm.position.xM,y:lm.position.yM});}
  for(const tr of motion.stageGeometry?.bodyTracks??[]){if(tr.horizontal){points.push({x:tr.horizontal.start.xM,y:tr.horizontal.start.yM});if(tr.horizontal.plannedEnd)points.push({x:tr.horizontal.plannedEnd.xM,y:tr.horizontal.plannedEnd.yM});}if(tr.projectile?.landingPlane)points.push({x:tr.projectile.launch.xM,y:tr.projectile.landingPlane.yM});}
  return{curves,ids:Object.keys(curves).sort(),bounds:computeWorldBounds(points)};
}
export function drawMultiBodyScene(ctx:CanvasRenderingContext2D,W:number,H:number,motion:Motion,time:number,tracked?:string,data=drawingData(motion),forceArrows?:import("../../../features/forces/forceModel").ForceArrow[]){
  const horizontal=motion.stagePlan?.stages[0]?.kind==='horizontal_approach';
  const snapshot=motion.sampleAt(time);
  const narrow=W<420;
  const vp=fitViewport(W,H,data.bounds,{top:44,right:narrow?34:54,bottom:48,left:narrow?34:54});
  const {S,X,Y}=vp;
  const b={x1:data.bounds.minX,x2:data.bounds.maxX,y1:data.bounds.minY,y2:data.bounds.maxY};
  const color=(id:string)=>data.ids.indexOf(id)===0?INK:TARGET;
  ctx.clearRect(0,0,W,H);ctx.fillStyle=PAPER;ctx.fillRect(0,0,W,H);ctx.lineWidth=1.3;ctx.font=`12px ${FONT}`;ctx.textBaseline='alphabetic';
  if(motion.stageGeometry?.switchableEM){
    const em=motion.stageGeometry.switchableEM;
    const eOn=true;
    const bOn=time<em.offSeconds-1e-9||time>=em.restoreSeconds-1e-9;
    const restored=time>=em.restoreSeconds-1e-9;
    const axisY=Y(0);
    const xL=Math.max(8,X(b.x1)-10),xR=Math.min(W-8,X(b.x2)+10);
    const yTop=Math.max(8,Y(b.y2)-10),yBot=Math.min(H-8,Y(b.y1)+10);
    // 上半区 y > 0 匀强电场（全程保持存在）
    if(axisY>yTop+4){
      ctx.save();
      ctx.fillStyle='rgba(180,120,40,0.06)';
      ctx.fillRect(xL,yTop,Math.max(0,xR-xL),Math.max(0,axisY-yTop));
      ctx.strokeStyle='rgba(160,105,30,0.45)';
      ctx.lineWidth=1;
      const stepX=Math.max(44,(xR-xL)/7);
      for(let px=xL+stepX*0.5;px<xR-16;px+=stepX){
        const ay1=yTop+12,ay2=axisY-10;
        if(ay2>ay1+12){
          ctx.beginPath();ctx.moveTo(px,ay1);ctx.lineTo(px,ay2);
          ctx.moveTo(px-3.5,ay2-5);ctx.lineTo(px,ay2);ctx.lineTo(px+3.5,ay2-5);ctx.stroke();
        }
      }
      ctx.fillStyle='#8a5a18';ctx.textAlign='left';ctx.fillText(eOn?'E ↓（电场恒定开启）':'E',xL+6,yTop+15);
      ctx.restore();
    }
    // 下半区 y < 0 匀强磁场
    if(yBot>axisY+4){
      ctx.save();
      ctx.fillStyle=bOn?'rgba(56,110,138,0.06)':'rgba(150,150,145,0.025)';
      ctx.fillRect(xL,axisY,Math.max(0,xR-xL),Math.max(0,yBot-axisY));
      ctx.fillStyle=bOn?'rgba(56,110,138,0.55)':'rgba(150,150,145,0.22)';
      ctx.textAlign='center';ctx.textBaseline='middle';
      const glyph=em.fieldDirection==='into_page'?'×':'·';
      const step=Math.max(32,Math.min(48,(xR-xL)/9));
      for(let px=xL+step*0.5;px<xR-8;px+=step){
        for(let py=axisY+step*0.5;py<yBot-8;py+=step)ctx.fillText(glyph,px,py);
      }
      ctx.textAlign='left';ctx.textBaseline='alphabetic';
      ctx.fillStyle=bOn?TARGET:SOFT;
      const bLabel=em.fieldDirection==='into_page'?'B ⊗':'B ⊙';
      ctx.fillText(bOn?(restored?`${bLabel}（磁场已恢复）`:`${bLabel}（磁场开启）`):`${bLabel}（磁场已撤 · 匀速漂移）`,xL+6,Math.min(yBot-6,axisY+18));
      ctx.restore();
    }
    // 分界线 y = 0 与撤场竖线 x = switchOffX
    ctx.save();
    ctx.strokeStyle=INK;ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(xL,axisY);ctx.lineTo(xR,axisY);ctx.stroke();
    ctx.setLineDash([5,4]);ctx.strokeStyle='#8a5a18';ctx.lineWidth=1.2;
    const offX=X(em.switchOffX);
    ctx.beginPath();ctx.moveTo(offX,yTop);ctx.lineTo(offX,yBot);ctx.stroke();
    ctx.fillStyle='#8a5a18';ctx.textAlign='left';ctx.fillText('撤场竖线',Math.min(W-60,offX+5),yTop+28);
    // 恢复磁场后的两回旋圆及外切点（非碰撞）
    em.circles.forEach((circle,idx)=>{
      ctx.save();
      ctx.strokeStyle=idx===0?INK:TARGET;
      ctx.globalAlpha=restored?0.78:0.28;
      ctx.lineWidth=restored?1.5:1.1;
      ctx.setLineDash(restored?[]:[4,4]);
      ctx.beginPath();ctx.arc(X(circle.center.xM),Y(circle.center.yM),circle.radiusM*S,0,2*Math.PI);ctx.stroke();
      ctx.restore();
    });
    const tx=X(em.tangency.xM),ty=Y(em.tangency.yM);
    ctx.save();ctx.strokeStyle='#b42318';ctx.fillStyle=PAPER;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(tx,ty,4,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.fillStyle='#b42318';ctx.textAlign='left';ctx.fillText('外切点（非碰撞）',Math.min(W-108,tx+7),Math.max(16,ty-4));
    ctx.restore();
    // 地标 S, P, Q
    for(const lm of motion.stageGeometry.landmarks??[]){
      const lx=X(lm.position.xM),ly=Y(lm.position.yM);
      ctx.fillStyle=SOFT;ctx.beginPath();ctx.arc(lx,ly,2.5,0,2*Math.PI);ctx.fill();
      ctx.textAlign='left';ctx.fillText(lm.label,lx+6,ly-5);
    }
    if(em.scaleMode==='normalized'){
      const badge='归一化标度：m = q = L = v₀ = 1';
      const bw=ctx.measureText(badge).width+14;
      ctx.fillStyle='rgba(251,251,249,0.88)';ctx.fillRect(W-bw-10,8,bw,20);
      ctx.fillStyle=SOFT;ctx.textAlign='right';ctx.fillText(badge,W-17,22);
    }
    ctx.restore();
  }
  for(const[id,points]of Object.entries(data.curves)){ctx.save();ctx.setLineDash([3,5]);ctx.strokeStyle=motion.stageGeometry?.switchableEM?color(id):HAIR;ctx.globalAlpha=motion.stageGeometry?.switchableEM?0.45:1;ctx.beginPath();points.forEach((p,i)=>i===0?ctx.moveTo(X(p.x),Y(p.y)):ctx.lineTo(X(p.x),Y(p.y)));ctx.stroke();ctx.restore();
    const initial=points[0],now=snapshot.bodies?.[id];if(now&&Math.hypot(now.position.x-initial.x,now.position.y-initial.y)*S>18){ctx.save();ctx.setLineDash([3,3]);ctx.strokeStyle=color(id);ctx.beginPath();ctx.arc(X(initial.x),Y(initial.y),5,0,2*Math.PI);ctx.stroke();ctx.restore();}}
  // 标签防重叠：先画几何与物体，把物体/支点占位记入 occupied，
  // 再为所有文字（速度、张力、接触点、地面、P/O）按优先级挑选不冲突的行。
  type Req={text:string;color:string;cx:number;by:number;dir:1|-1;leader?:{x:number;y:number}};
  const reqs:Req[]=[],vel:Req[]=[];
  const occupied:{x:number;y:number;w:number;h:number}[]=[];
  const block=(x:number,y:number,r:number)=>occupied.push({x:x-r,y:y-r,w:2*r,h:2*r});
  const marked=new Set<string>();
  const gx1=Math.max(8,X(b.x1)-14),gx2=Math.min(W-8,X(b.x2)+14);
  for(const tr of motion.stageGeometry?.bodyTracks??[]){
    if(tr.horizontal){const p=tr.horizontal,end=p.plannedEnd??{xM:motion.sampleAt(motion.durationSeconds).bodies?.[tr.bodyIds[0]]?.position.x??p.start.xM,yM:p.start.yM};ctx.strokeStyle=INK;ctx.beginPath();ctx.moveTo(X(p.start.xM),Y(p.start.yM));ctx.lineTo(X(end.xM),Y(end.yM));ctx.stroke();if(p.plannedEnd){const label=horizontal&&tr.stagePath.startsWith('/stages/0/')?'实际接触点':'桌沿 / 目标',key=`${label}:${end.xM}:${end.yM}`;if(!marked.has(key)){reqs.push({text:label,color:SOFT,cx:X(end.xM),by:Y(end.yM)+27,dir:1});marked.add(key);}}}
    if(tr.projectile?.landingPlane){const y=tr.projectile.landingPlane.yM;ctx.strokeStyle=INK;ctx.beginPath();ctx.moveTo(gx1,Y(y));ctx.lineTo(gx2,Y(y));ctx.stroke();const text=`地面 y = ${y} m`;reqs.push({text,color:SOFT,cx:gx1+ctx.measureText(text).width/2,by:Y(y)+17,dir:1});}
  }
  if(motion.stageGeometry?.conveyor){
    const cv=motion.stageGeometry.conveyor,xL=X(cv.minXM),xR=X(cv.maxXM),yTop=Y(0)+4,beltH=14,rRoll=7;
    ctx.save();
    ctx.fillStyle='#efefeb';ctx.strokeStyle=INK;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.roundRect(xL-rRoll,yTop,Math.max(16,xR-xL)+2*rRoll,beltH,rRoll);ctx.fill();ctx.stroke();
    // 左右滚轮
    for(const rx of [xL,xR]){
      ctx.fillStyle=PAPER;ctx.beginPath();ctx.arc(rx,yTop+rRoll,rRoll-1.5,0,2*Math.PI);ctx.fill();ctx.stroke();
      ctx.fillStyle=INK;ctx.beginPath();ctx.arc(rx,yTop+rRoll,2,0,2*Math.PI);ctx.fill();
    }
    // 随时间移动的带面方向刻线
    const dir=Math.sign(cv.initialBeltSpeedMps)||1;
    const phase=((time*cv.initialBeltSpeedMps*S)%24+24)%24;
    ctx.strokeStyle='#8e8e88';ctx.lineWidth=1.1;
    for(let px=xL+phase;px<xR-6;px+=24){
      ctx.beginPath();ctx.moveTo(px-3*dir,yTop+3);ctx.lineTo(px+2*dir,yTop+3);
      ctx.moveTo(px+2*dir,yTop+3);ctx.lineTo(px-1*dir,yTop+1);ctx.stroke();
    }
    ctx.restore();
    occupied.push({x:xL-rRoll,y:yTop,w:Math.max(16,xR-xL)+2*rRoll,h:beltH});
    const beltLabel=`传送带 L=${cv.beltLengthM??(cv.maxXM-cv.minXM)} m · v带=${cv.initialBeltSpeedMps} m/s`;
    reqs.push({text:beltLabel,color:SOFT,cx:(xL+xR)/2,by:yTop+beltH+16,dir:1});
  }
  for(const p of motion.stageGeometry?.pendulums??[]){
    const px=X(p.pivot.xM),py=Y(p.pivot.yM);
    ctx.strokeStyle=INK;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(px-19,py-6);ctx.lineTo(px+19,py-6);ctx.moveTo(px,py-6);ctx.lineTo(px,py+3);ctx.stroke();
    occupied.push({x:px-19,y:py-8,w:38,h:12});
    if(p.peg){
      reqs.push({text:'O',color:INK,cx:px-14,by:py-10,dir:-1});
      const gx=X(p.peg.xM),gy=Y(p.peg.yM);
      ctx.save();ctx.fillStyle='#b42318';ctx.strokeStyle=PAPER;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(gx,gy,4.2,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.restore();
      block(gx,gy,6);
      reqs.push({text:`钉子 P (OP=${p.peg.offsetXM.toFixed(2)} m)`,color:'#b42318',cx:gx,by:gy-14,dir:-1});
    }else{
      reqs.push({text:'P',color:INK,cx:px+26,by:py-2,dir:-1});
      reqs.push({text:'O',color:SOFT,cx:X(p.lowestPoint.xM)+13,by:Y(p.lowestPoint.yM)+18,dir:1});
    }
  }
  if(motion.stageGeometry?.plank){
    const pg=motion.stageGeometry.plank,pb=snapshot.bodies?.[pg.plankBodyId];
    if(pb){
      const y0=Y(pb.position.y),xL=X(pb.position.x),xR=X(pb.position.x+pg.plankLengthM);
      ctx.save();ctx.strokeStyle=HAIR;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(gx1,y0+10);ctx.lineTo(gx2,y0+10);ctx.stroke();
      ctx.fillStyle='#eaeae6';ctx.strokeStyle=TARGET;ctx.lineWidth=1.6;ctx.fillRect(xL,y0+2,Math.max(8,xR-xL),8);ctx.strokeRect(xL,y0+2,Math.max(8,xR-xL),8);ctx.restore();
      occupied.push({x:xL,y:y0+2,w:Math.max(8,xR-xL),h:10});
      reqs.push({text:`木板 L=${pg.plankLengthM} m`,color:SOFT,cx:(xL+xR)/2,by:y0+26,dir:1});
    }
  }
  if(motion.stageGeometry?.pulley){
    const pl=motion.stageGeometry.pulley,px=X(pl.pulley.xM),py=Y(pl.pulley.yM);
    const pr=Math.max(10,Math.min(16,Math.abs(X(pl.body2Start.xM)-px)));
    const b2Now=snapshot.bodies?.[pl.body2Id];
    const ropeShiftPx=(b2Now?(pl.body2Start.yM-b2Now.position.y):0)*S;
    const wheelAngle=ropeShiftPx/Math.max(8,pr);
    ctx.save();
    // 1. 支承面实体（斜面楔体 / 水平桌面 / 悬挂天花板）与地面线
    if(pl.surfaceKind==='incline'){
      const x0=X(pl.body1Start.xM),y0=Y(pl.body1Start.yM);
      const baseY=pl.groundYM!=null?Y(pl.groundYM):y0;
      ctx.fillStyle='#f1f1ed';
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(px,py);ctx.lineTo(px,baseY);ctx.lineTo(x0,baseY);ctx.closePath();ctx.fill();
      ctx.strokeStyle=HAIR;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px,baseY);ctx.stroke();
      ctx.strokeStyle=INK;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(px,py);ctx.stroke();
      // 定滑轮支架：固定在斜面顶端
      ctx.strokeStyle='#5f5f5b';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(px-8,py+10);ctx.lineTo(px,py);ctx.moveTo(px+2,py+12);ctx.lineTo(px,py);ctx.stroke();
    }else if(pl.surfaceKind==='horizontal'){
      const x0=X(pl.body1Start.xM),y0=Y(pl.body1Start.yM);
      const baseY=pl.groundYM!=null?Y(pl.groundYM):y0+60;
      ctx.fillStyle='#f1f1ed';
      ctx.fillRect(x0,y0,Math.max(0,px-x0),Math.max(10,baseY-y0));
      ctx.strokeStyle=HAIR;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(px,y0);ctx.lineTo(px,baseY);ctx.stroke();
      ctx.strokeStyle=INK;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(px,y0);ctx.stroke();
      ctx.strokeStyle='#5f5f5b';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(px-8,y0+6);ctx.lineTo(px,py);ctx.stroke();
    }else{
      // 阿特伍德机顶部天花板与吊架
      const ceilY=py-pr-14;
      ctx.strokeStyle=INK;ctx.lineWidth=1.6;
      ctx.beginPath();ctx.moveTo(px-26,ceilY);ctx.lineTo(px+26,ceilY);ctx.stroke();
      ctx.strokeStyle=HAIR;ctx.lineWidth=1;
      for(let hx=px-22;hx<=px+22;hx+=7){ctx.beginPath();ctx.moveTo(hx,ceilY);ctx.lineTo(hx-4,ceilY-5);ctx.stroke();}
      ctx.strokeStyle='#5f5f5b';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(px,ceilY);ctx.lineTo(px,py);ctx.stroke();
    }
    if(pl.groundYM!=null){
      const gy=Y(pl.groundYM);
      ctx.strokeStyle=INK;ctx.lineWidth=1.6;
      ctx.beginPath();ctx.moveTo(gx1,gy);ctx.lineTo(gx2,gy);ctx.stroke();
      ctx.strokeStyle=HAIR;ctx.lineWidth=1;
      for(let hx=gx1+6;hx<gx2;hx+=14){ctx.beginPath();ctx.moveTo(hx,gy);ctx.lineTo(hx-5,gy+5);ctx.stroke();}
      reqs.push({text:'地面支撑',color:SOFT,cx:X(pl.body2Start.xM)+36,by:gy+16,dir:1});
    }
    // 2. 真实定滑轮（外轮槽 + 内槽线 + 随绳转动的辐条 + 轮轴）
    ctx.fillStyle=PAPER;ctx.strokeStyle=INK;ctx.lineWidth=1.8;
    ctx.beginPath();ctx.arc(px,py,pr,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.strokeStyle=HAIR;ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(px,py,Math.max(4,pr-3),0,2*Math.PI);ctx.stroke();
    ctx.strokeStyle='#8e8e88';ctx.lineWidth=1.2;
    for(let k=0;k<4;k++){
      const a=wheelAngle+k*(Math.PI/2);
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(a)*(pr-3),py+Math.sin(a)*(pr-3));ctx.stroke();
    }
    ctx.beginPath();ctx.arc(px,py,2.6,0,2*Math.PI);ctx.fillStyle=INK;ctx.fill();
    ctx.restore();
    occupied.push({x:px-pr-2,y:py-pr-2,w:(pr+2)*2,h:(pr+2)*2});
  }
  for(const c of Object.values(snapshot.constraints??{})){
    if(c.kind==='pulley_string'){
      const b1=snapshot.bodies?.[c.bodyIds[0]],b2=snapshot.bodies?.[c.bodyIds[1]];if(!b1||!b2)continue;
      const pl=motion.stageGeometry?.pulley,px=X(c.pivot.xM),py=Y(c.pivot.yM);
      const pr=pl?Math.max(10,Math.min(16,Math.abs(X(pl.body2Start.xM)-px))):10;
      const ropeShiftPx=pl?(pl.body2Start.yM-b2.position.y)*S:0;
      const b1x=X(b1.position.x),b1y=Y(b1.position.y),b2x=X(b2.position.x),b2y=Y(b2.position.y);
      // 计算绳在滑轮左/上侧的精确切点，避免绳与斜面重合看不清
      let t1x=px-pr,t1y=py,r1x=b1x,r1y=b1y;
      if(pl?.surfaceKind==='incline'){
        const dx=px-X(pl.body1Start.xM),dy=py-Y(pl.body1Start.yM),len=Math.hypot(dx,dy)||1;
        const nx=dy/len,ny=-dx/len;
        t1x=px+nx*pr;t1y=py+ny*pr;
        r1x=b1x+nx*5;r1y=b1y+ny*5;
      }else if(pl?.surfaceKind==='horizontal'){
        t1x=px;t1y=py-pr;
        r1x=b1x;r1y=b1y-5;
      }
      const t2x=px+pr,t2y=py;
      const drawRopeTicks=(ax:number,ay:number,bx:number,by:number,phasePx:number)=>{
        const segLen=Math.hypot(bx-ax,by-ay);
        if(segLen<12)return;
        const step=18,ux=(bx-ax)/segLen,uy=(by-ay)/segLen;
        let d=((phasePx%step)+step)%step;
        if(d<4)d+=step;
        ctx.fillStyle='#5f5f5b';
        for(;d<segLen-4;d+=step){
          ctx.beginPath();ctx.arc(ax+ux*d,ay+uy*d,1.8,0,2*Math.PI);ctx.fill();
        }
      };
      ctx.save();
      ctx.strokeStyle=c.state==='taut'?INK:SOFT;
      ctx.lineWidth=c.state==='taut'?1.8:1.3;
      if(c.state==='slack')ctx.setLineDash([4,4]);
      ctx.beginPath();
      if(c.state==='taut'){
        ctx.moveTo(r1x,r1y);ctx.lineTo(t1x,t1y);
        // 绕过滑轮上半圆槽的弧线
        ctx.arc(px,py,pr,Math.atan2(t1y-py,t1x-px),0,false);
        ctx.lineTo(b2x,b2y);
      }else{
        // 松绳时呈轻微下垂松弛曲线
        ctx.moveTo(r1x,r1y);ctx.quadraticCurveTo((r1x+t1x)/2,(r1y+t1y)/2+10,t1x,t1y);
        ctx.moveTo(t2x,t2y);ctx.quadraticCurveTo((t2x+b2x)/2+8,(t2y+b2y)/2,b2x,b2y);
      }
      ctx.stroke();
      // 张紧时在两段绳上绘制随绳位移平滑移动的刻度珠，直观展示绳子运动
      if(c.state==='taut'){
        drawRopeTicks(r1x,r1y,t1x,t1y,ropeShiftPx);
        drawRopeTicks(t2x,t2y,b2x,b2y,ropeShiftPx);
      }
      ctx.restore();
      reqs.push({text:c.state==='taut'?`T = ${c.tensionN.toFixed(2)} N`:'松绳 · T = 0 N',color:SOFT,cx:Math.max(70,Math.min(W-70,px+64)),by:Math.max(18,py-16),dir:-1});
      continue;
    }
    const body=snapshot.bodies?.[c.bodyIds[0]];if(!body)continue;
    const pendGeo=motion.stageGeometry?.pendulums?.find(p=>p.constraintId===c.constraintId);
    ctx.save();ctx.strokeStyle=c.state==='taut'?INK:SOFT;ctx.lineWidth=c.state==='taut'?1.8:1.2;
    // 若已碰钉（当前支点与原悬点 O 不同），先画 O→P 水平段，再画 P→摆球段
    if(pendGeo&&Math.abs(c.pivot.xM-pendGeo.pivot.xM)>1e-6){
      ctx.beginPath();ctx.moveTo(X(pendGeo.pivot.xM),Y(pendGeo.pivot.yM));ctx.lineTo(X(c.pivot.xM),Y(c.pivot.yM));ctx.stroke();
    }
    if(c.state==='slack')ctx.setLineDash([4,5]);
    ctx.beginPath();ctx.moveTo(X(c.pivot.xM),Y(c.pivot.yM));ctx.lineTo(X(body.position.x),Y(body.position.y));ctx.stroke();ctx.restore();
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
    if(by===null||!rect){by=Math.max(15,Math.min(H-6,cand[0]));rect={x:cx-w/2,y:by-13,w,h};}
    rects.push(rect);
    if(q.leader&&Math.abs(by-q.by)>=12){ctx.save();ctx.strokeStyle=HAIR;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(q.leader.x,q.leader.y);ctx.lineTo(cx,by+(q.dir===-1?4:-13));ctx.stroke();ctx.restore();}
    ctx.fillStyle=PAPER;ctx.fillRect(rect.x,rect.y,w,h);ctx.fillStyle=q.color;ctx.textAlign='center';ctx.fillText(q.text,cx,by);
  }
  if(forceArrows?.length)drawForceArrows(ctx,forceArrows,X,Y);
}
/** 逐物体读数。默认渲染在画布内；工作台把它移进「路段与计时」折叠区，
 *  让画布卡片与单物体版保持同一布局（画布独占整块 frame）。 */
export function MultiBodyReadouts({motion,time,isPlaying=false}:{motion:Motion;time:number;isPlaying?:boolean}){
  const sample=motion.sampleAt(time),ids=Object.keys(sample.bodies??{}).sort(),firstKind=motion.stagePlan?.stages[0]?.kind,horizontal=firstKind==='horizontal_approach'||firstKind==='block_plank'||firstKind==='conveyor_belt';
  const em=motion.stageGeometry?.switchableEM;
  const emStatus=em?(time<em.offSeconds-1e-9?'电场开 · 磁场开':time<em.restoreSeconds-1e-9?'电场开 · 磁场撤去（匀速直线漂移）':'电场开 · 磁场已恢复（两轨迹外切，非碰撞）'):null;
  return <figcaption id="multi-body-readouts" className={'multi-body-readouts'+(ids.some(id=>id.length>16)?' has-long-ids':'')+(horizontal?' has-horizontal-states':'')} aria-live={isPlaying?'off':'polite'}>
    {ids.map((id,i)=>{const b=sample.bodies![id];return <span className="body-body-value" key={id} data-body-id={id}><i className="body-swatch" style={{background:i===0?INK:TARGET}}/>{id}：v = {formatSpeed(Math.hypot(b.velocity.x,b.velocity.y))} m/s；{bodyStatusText[b.status]}{b.groupId?' · 粘连':''}{(horizontal||!!em)&&<><br/>x = {signed(b.position.x)}，y = {signed(b.position.y)} m<br/>vₓ = {signed(b.velocity.x)}，vᵧ = {signed(b.velocity.y)} m/s</>}</span>;})}
    {emStatus&&<span className="body-constraint">场区状态：{emStatus}{em?.scaleMode==='normalized'?' · 归一化标度（m=q=L=v₀=1）':''}</span>}
    {Object.values(sample.constraints??{}).map(c=>{
      const pendGeo=motion.stageGeometry?.pendulums?.find(p=>p.constraintId===c.constraintId);
      const pegActive=pendGeo?.peg&&Math.abs(c.pivot.xM-pendGeo.pivot.xM)>1e-6;
      return <span className="body-constraint" key={c.constraintId}>{c.bodyIds.join(' + ')}：{c.state==='taut'?'绳张紧':'绳松弛'}，总张力 T = {c.tensionN.toFixed(2)} N{pendGeo?.peg?` · ${pegActive?`绕钉 P（r = ${c.lengthM.toFixed(2)} m）`:`绕悬点 O（L = ${c.lengthM.toFixed(2)} m）`}`:''}</span>;
    })}
  </figcaption>;
}
export function MultiBodyPhysicsCanvas({motion,time,isPlaying=false,trackedBodyId,readouts=true,forces=false,decompose=false}:{motion:Motion;time:number;isPlaying?:boolean;trackedBodyId?:string;readouts?:boolean;forces?:boolean;decompose?:boolean}){
  const ref=useRef<HTMLCanvasElement|null>(null),size=useRef({w:0,h:0}),frame=useRef<number|null>(null),data=useMemo(()=>drawingData(motion),[motion]);
  const current=useRef({motion,time,trackedBodyId,data,forces,decompose});current.current={motion,time,trackedBodyId,data,forces,decompose};
  const paint=useCallback(()=>{const canvas=ref.current,ctx=canvas?.getContext('2d');if(ctx&&size.current.w){const p=current.current;drawMultiBodyScene(ctx,size.current.w,size.current.h,p.motion,p.time,p.trackedBodyId,p.data,p.forces?forcesAt(p.motion,p.time,p.decompose):undefined);}},[]);
  useEffect(()=>{const canvas=ref.current;if(!canvas)return;const resize=()=>{const box=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;size.current={w:box.width,h:box.height};canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);canvas.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);paint();};resize();const observer=new ResizeObserver(resize);observer.observe(canvas);return()=>observer.disconnect();},[paint]);
  useEffect(()=>{frame.current=requestAnimationFrame(paint);return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);};},[time,motion,trackedBodyId,forces,decompose,paint]);
  return <figure className="multi-body-figure" data-renderer="multi-body"><canvas ref={ref} role="img" aria-label={motion.stageGeometry?.switchableEM?'分区电磁场双粒子偏转、弹性正碰与撤场恢复同步动画':motion.stageGeometry?.pulley?'轻绳与理想定滑轮连接体同步动画':motion.stageGeometry?.plank?'滑块与可移动木板同步动画':motion.stageGeometry?.pendulums?.length?'轻绳摆与物体同步动画，P为支点，O为最低点':'两物体水平正碰与碰后同步运动'} aria-describedby="multi-body-readouts"/>{readouts&&<MultiBodyReadouts motion={motion} time={time} isPlaying={isPlaying}/>}</figure>;
}
