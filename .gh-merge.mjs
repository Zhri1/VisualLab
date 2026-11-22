import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const token = execFileSync(
  'bash',
  ['-lc', 'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill | sed -n "s/^password=//p"'],
  { encoding: 'utf8' },
).trim();

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function call(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const repo = '/repos/Zhri1/VisualLab';

// 1) 提交评审意见
const reviewBody = readFileSync('.gh-review-body.md', 'utf8');
const review = await call(`${repo}/pulls/18/reviews`, {
  method: 'POST',
  body: JSON.stringify({ body: reviewBody, event: 'COMMENT' }),
});
console.log('review:', review.status, review.body.id ?? JSON.stringify(review.body).slice(0, 200));

// 2) 合并（squash，与主干历史风格一致）
const merge = await call(`${repo}/pulls/18/merge`, {
  method: 'PUT',
  body: JSON.stringify({
    merge_method: 'squash',
    commit_title: 'feat(physics): 共享阶段校验与有序运动装配 (#18)',
    commit_message:
      '阶段计划校验、几何与运动装配、六种终止原因与末帧语义。\n\n' +
      '已包含 B_EXPORTS.md（给 A/C 的稳定导出契约）。\n' +
      '取代 #11 的旧整题方案，低层公式保留复用。',
  }),
});
console.log('merge:', merge.status, merge.body.merged, merge.body.sha?.slice(0, 7), merge.body.message ?? '');

writeFileSync('.gh-merge-result.json', JSON.stringify({ review: review.body, merge: merge.body }, null, 2));
