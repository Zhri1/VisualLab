import { readFileSync, writeFileSync } from 'node:fs';

const content = readFileSync('B_EXPORTS.md');
const payload = {
  message:
    'docs(physics): 写清稳定导出契约，A/C 按此对接不用重做\n\n' +
    '把 validateStagePlan / StageGeometry / assembleScene / buildMotion 的签名、\n' +
    'segments / events / termination 的形状、六种 endReason 的末帧语义一次写全，\n' +
    '并点明两种「停止」与 prefix_end 的区别。\n\n' +
    '目的不是补文档，是止住重复开发：这些实现和测试都已经在 #18 里，联调对不上时\n' +
    '先按本文核字段语义，确认是计算问题再改。',
  content: content.toString('base64'),
  branch: 'feat/b-stage-composition',
};

writeFileSync('.gh-payload.json', JSON.stringify(payload));
console.log('payload bytes:', JSON.stringify(payload).length);
