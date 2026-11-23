// 专用于摩擦直线段的停止分区与相对位置二次方程，不按动画帧搜索接触。
export type PolynomialPiece = { start: number; end: number; x: number; y: number; vx: number; vy: number; ax: number; ay: number };
export function polynomialAt(p: PolynomialPiece, t: number) {
  const d = t - p.start;
  return { xM: p.x + p.vx * d + p.ax * d * d / 2, yM: p.y + p.vy * d + p.ay * d * d / 2, vxMps: p.vx + p.ax * d, vyMps: p.vy + p.ay * d };
}
export const nearValue = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 32 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1e-300);
export function roots(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? c === 0 ? [0] : [] : [-c/b];
  let d = b*b - 4*a*c;
  if (d < 0 && Math.abs(d) <= 16*Number.EPSILON*(b*b+Math.abs(4*a*c))) d=0;
  if (d < 0) return [];
  if (d === 0) return [-b/(2*a)];
  const q = -.5*(b + (b < 0 ? -1 : 1)*Math.sqrt(d));
  return [q/a,c/q].sort((x,y)=>x-y);
}
export function frictionPieces(x: number, v: number, braking: number): PolynomialPiece[] {
  if(![x,v,braking].every(Number.isFinite))throw new RangeError('初态或摩擦加速度量级无法表示。');
  const stop = v === 0 ? 0 : braking > 0 ? Math.abs(v)/braking : Infinity;
  const a = -Math.sign(v)*braking;
  if(braking>0&&v!==0&&!Number.isFinite(stop)||Number.isFinite(stop)&&!Number.isFinite(x+v*stop+a*stop*stop/2))throw new RangeError('水平停止时刻或位置量级无法表示。');
  const result: PolynomialPiece[] = [];
  if (stop > 0) result.push({start:0,end:stop,x,y:0,vx:v,vy:0,ax:a,ay:0});
  if (Number.isFinite(stop)) result.push({start:stop,end:Infinity,x:x+v*stop+a*stop*stop/2,y:0,vx:0,vy:0,ax:0,ay:0});
  return result;
}
export function firstIntersection(one: PolynomialPiece[], two: PolynomialPiece[], limit: number, afterSeparation = false): number | undefined {
  let best: number | undefined;
  for (const a of one) for (const b of two) {
    const start=Math.max(a.start,b.start), end=Math.min(a.end,b.end,limit);
    if(start>end) continue;
    const u=polynomialAt(a,start),v=polynomialAt(b,start),dx=u.xM-v.xM,dv=u.vxMps-v.vxMps,da=a.ax-b.ax;
    const dy=u.yM-v.yM,dvy=u.vyMps-v.vyMps,day=a.ay-b.ay;
    if(![dx,dv,da,dy,dvy,day].every(Number.isFinite))throw new RangeError('相对运动量级无法表示。');
    const candidates = da===0&&dv===0&&dx===0 ? roots(day/2,dvy,dy) : roots(da/2,dv,dx);
    for(let delta of candidates){
      if(delta<0&&nearValue(delta,0))delta=0;
      const t=start+delta;
      if(delta<0||t>end&&!nearValue(t,end)||afterSeparation&&t===0||best!==undefined&&t>=best)continue;
      const p=polynomialAt(a,t),q=polynomialAt(b,t);
      const yScale=Math.max(1,Math.abs(p.yM),Math.abs(q.yM));
      if(Math.abs(p.yM-q.yM)>64*Number.EPSILON*yScale)continue;
      // 再次接触必须先分离，再以接近方向到达同一世界位置；同刻离开不算。
      if(afterSeparation){
        const rel=p.vxMps-q.vxMps;
        const probe=Math.min(delta/2,1e-5*Math.max(1,Math.abs(t)));
        if(probe<=0)continue;
        const prev=polynomialAt(a,t-probe).xM-polynomialAt(b,t-probe).xM;
        if(prev===0||prev*rel>=0)continue;
      }
      best=t;
    }
  }
  return best;
}
