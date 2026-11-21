import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const actionId = randomUUID();
const payload = {
  actionId,
  projectRoot: 'C:/Users/player/WorkBuddy AI/2026-11-18-18-58-46/VisualLab',
  webDirectory: 'dist',
  functionDirectory: 'functions',
  projectId: '01a1f4aa-fd83-7e8c-ba8d-8ba7d20aa62c',
};

writeFileSync('.sites-input.json', JSON.stringify(payload));
writeFileSync('.sites-action', actionId);
console.log(JSON.stringify(payload));
