import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

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

async function api(path, init = {}) {
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

const pr = await api('/repos/Zhri1/VisualLab/pulls/18');
const nodeId = pr.body.node_id;
console.log('node_id', nodeId, 'draft', pr.body.draft);

const mutation = {
  query: `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }`,
  variables: { id: nodeId },
};

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers,
  body: JSON.stringify(mutation),
});
const out = await res.json();
writeFileSync('.gh-graphql.json', JSON.stringify(out, null, 2));
console.log('graphql status', res.status);
console.log(JSON.stringify(out).slice(0, 400));
