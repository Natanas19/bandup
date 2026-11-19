/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

test('multi-assignee database activation remains outside the migration history', () => {
  for (const file of ['supabase/migrations/20261105140000_task_assignees_expand.sql', 'supabase/migrations/20261105160000_task_assignees_activate.sql', 'bandup-postgres-loopback-procedure.py', 'tests/test_bandup_postgres_loopback_procedure.py', 'public/demo/magijos.svg']) {
    assert.equal(fs.existsSync(file), false, file);
  }
});
