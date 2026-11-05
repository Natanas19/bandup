/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

test('stable release contains no multi-assignee runtime or expansion/activation migrations', () => {
  for (const file of ['src/app/bandas/[bandId]/tarefas/page.tsx', 'src/lib/personal-tasks.ts', 'src/lib/record-permissions.ts', 'src/lib/task-event-compatibility.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /task_assignees|task-assignees|assignee_ids|task_revision|bandup_save_task|supportsMultipleAssignees/);
  }
  assert.doesNotMatch(fs.readFileSync('src/app/bandas/[bandId]/tarefas/page.tsx', 'utf8'), /type="checkbox"/);
  for (const file of ['src/lib/task-assignees.ts', 'supabase/migrations/20261105140000_task_assignees_expand.sql', 'supabase/migrations/20261105160000_task_assignees_activate.sql', 'bandup-postgres-loopback-procedure.py', 'tests/test_bandup_postgres_loopback_procedure.py', 'public/demo/magijos.svg']) {
    assert.equal(fs.existsSync(file), false, file);
  }
});
