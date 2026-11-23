import type { Motion } from '../../../types';
import { bodyStatusText } from './MultiBodyPhysicsCanvas';
import { displayEventAt } from './playback';

export function MultiBodyExplanation({motion,time}:{motion:Motion;time:number}){
  const event=displayEventAt(motion,time);
  const atEnd=time>=motion.durationSeconds,sample=motion.sampleAt(time);
  return <div className="explain multi-body-explain is-event"><div className="explain-main"><div className="explain-meta"><span className="stage-pill">{event?.bodyIds?.join(' + ')??'物体'} · 同一时间轴</span><span className="event-flag">{atEnd&&motion.motionStatus?.state==='model_limit'?'求解边界':'关键事件'}</span></div>
    <p className="stage-name">{event?.label??'同步运动'}</p><p className="stage-desc">{event?.caption}{atEnd&&` ${motion.motionStatus?.message??''}`}</p>
    {event?.eventKind==='collision'&&<table className="collision-values" aria-label="碰撞前后水平速度"><thead><tr><th>物体</th><th>碰前 vₓ (m/s)</th><th>碰后 vₓ (m/s)</th></tr></thead><tbody>{event.bodyIds?.map(id=><tr key={id}><th>{id}</th><td>{event.bodyStatesBefore?.[id].velocity.x.toFixed(3)}</td><td>{event.bodyStatesAfter?.[id].velocity.x.toFixed(3)}</td></tr>)}</tbody></table>}
    {event?.collision&&<p className="body-note" aria-label="碰撞动量与能量">碰撞瞬间：动量 {event.collision.momentumBeforeKgMps.toFixed(3)} → {event.collision.momentumAfterKgMps.toFixed(3)} kg·m/s；动能 {event.collision.energyBeforeJ.toFixed(3)} → {event.collision.energyAfterJ.toFixed(3)} J；碰撞损失 {event.collision.energyLostJ.toFixed(3)} J。接触状态由题给初态与实际摩擦求得。</p>}
    {atEnd&&<p className="body-note">{Object.entries(sample.bodies??{}).map(([id,b])=>`${id}：${bodyStatusText[b.status]}`).join('；')}</p>}
  </div></div>;
}
