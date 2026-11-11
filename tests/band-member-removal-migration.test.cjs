/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const migration = fs.readFileSync('supabase/migrations/20261111100000_restrict_member_removal_to_members.sql', 'utf8');
const source = fs.readFileSync('supabase/migrations/20261001000000_initial_bandup_schema.sql', 'utf8');

test('member removal migration tightens only the existing admin delete policy', () => {
  const executable = migration.replace(/--[^\n]*/g, '');
  assert.match(executable, /ALTER POLICY band_members_delete_for_admins\s+ON public\.band_members\s+USING\s*\(/i);
  assert.match(executable, /private\.is_band_member\(band_id\)\s+AND private\.is_band_admin\(band_id\)\s+AND role = 'member'/i);
  assert.equal((executable.match(/\bALTER\s+POLICY\b/gi) ?? []).length, 1);
  assert.doesNotMatch(executable, /\bCREATE\s+POLICY\b|\bDROP\s+POLICY\b|\bALTER\s+TABLE\b|\bGRANT\b|\bREVOKE\b/i);
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE)\s+ON\b/i);
});

test('existing member deletion trigger continues to unlink assigned tasks', () => {
  const body = source.split('CREATE OR REPLACE FUNCTION private.prevent_last_band_admin_removal()')[1]
    .split('$$;')[0];
  assert.match(body, /IF TG_OP = 'DELETE'[\s\S]*?UPDATE public\.tasks\s+SET assigned_to = NULL\s+WHERE band_id = OLD\.band_id\s+AND assigned_to = OLD\.user_id/);
  assert.match(source, /CREATE TRIGGER band_members_prevent_last_admin_removal\s+BEFORE UPDATE OR DELETE ON public\.band_members\s+FOR EACH ROW\s+EXECUTE FUNCTION private\.prevent_last_band_admin_removal\(\)/);
});
