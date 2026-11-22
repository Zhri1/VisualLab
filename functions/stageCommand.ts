// 由 scripts/sync-functions.mjs 从 src/api/stageCommand.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { parseCommand } from './command.ts';

// 两端共用命令分派；命令不调用视觉模型，物理重算仍由浏览器的常规装配入口完成。
export function dispatchStageCommand(form:FormData):{body:unknown;status:number}|null{
  if(!form.has('command')&&!form.has('currentPlan'))return null;
  const command=form.get('command'),raw=form.get('currentPlan');
  if(typeof command!=='string'||!command.trim()||typeof raw!=='string'||!raw.trim())return{status:400,body:{message:'修改指令须同时提供command和currentPlan。'}};
  if(form.get('image')||(typeof form.get('text')==='string'&&String(form.get('text')).trim()))return{status:400,body:{message:'修改当前场景和识别新题不能混用。'}};
  let plan:unknown;try{plan=JSON.parse(raw);}catch{return{status:400,body:{message:'currentPlan不是有效JSON。'}};}
  if(!plan||typeof plan!=='object'||!('stages'in plan)||!Array.isArray(plan.stages)||!plan.stages.length||plan.stages.some(s=>!s||typeof s!=='object'||typeof s.kind!=='string'))return{status:400,body:{message:'currentPlan需要可识别的有序阶段。'}};
  return{status:200,body:parseCommand(command,plan as {stages:{kind:string}[]})};
}
