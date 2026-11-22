import type { Motion } from '../../../types';
import { bodyStatusText } from './MultiBodyPhysicsCanvas';
import { displayEventAt } from './playback';

export function MultiBodyExplanation({motion,time}:{motion:Motion;time:number}){
  const event=displayEventAt(motion,time);
  const atEnd=time>=motion.durationSeconds,sample=motion.sampleAt(time);
  return <div className="explain multi-body-explain is-event"><div className="explain-main"><div className="explain-meta"><span className="stage-pill">{event?.bodyIds?.join(' + ')??'物体'} · 同一时间轴</span><span className="event-flag">{atEnd&&motion.motionStatus?.state==='model_limit'?'求解边界':'关键事件'}</span></div>
    <p className="stage-name">{event?.label??'同步运动'}</p><p className="stage-desc">{event?.caption}{atEnd&&` ${motion.motionStatus?.message??''}`}</p>
    {event?.eventKind==='collision'&&<table className="collision-values" aria-label="碰撞前后水平速度"><thead><tr><th>物体</th><th>碰前 vₓ (m/s)</th><th>碰后 vₓ (m/s)</th></tr></thead><tbody>{event.bodyIds?.map(id=><tr key={id}><th>{id}</th><td>{event.bodyStatesBefore?.[id].velocity.x.toFixed(3)}</td><td>{event.bodyStatesAfter?.[id].velocity.x.toFixed(3)}</td></tr>)}</tbody></table>}
    {atEnd&&<p className="body-note">{Object.entries(sample.bodies??{}).map(([id,b])=>`${id}：${bodyStatusText[b.status]}`).join('；')}</p>}
  </div></div>;
}
