/* eslint-disable @typescript-eslint/no-require-imports */
// Offline source-contract checks only. No SQL parser, connection or subprocess.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
const candidate = read('001_band_entry.proposed.sql');
const sqlTests = read('authorization.test.sql');
const concurrent = read('concurrency.spec');
const rollback = read('rollback.proposed.sql');

test('proposal and SQL tests refuse execution before any schema/data mutation', () => {
  for (const source of [candidate, sqlTests, rollback, concurrent]) {
    const refusal = source.indexOf('RAISE EXCEPTION');
    assert.ok(refusal >= 0);
    const firstMutation = source.search(/\b(?:CREATE TABLE|CREATE FUNCTION|INSERT INTO|DROP FUNCTION)\b/);
    assert.ok(firstMutation > refusal);
    assert.match(source.slice(refusal, firstMutation), /execution disabled/);
  }
  assert.match(sqlTests, /\\set ON_ERROR_STOP on/);
  assert.match(sqlTests, /ROLLBACK;\s*$/);
});

test('candidate only creates feature tables/functions and never replaces historical objects', () => {
  assert.deepEqual([...candidate.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m => m[1]),
    ['public.band_join_directory', 'public.band_join_requests']);
  assert.doesNotMatch(candidate, /CREATE OR REPLACE|ALTER TABLE public\.(?:bands|band_members|tasks|events|social_links)\b/);
  assert.doesNotMatch(candidate, /\b(?:is_public|event_id|public_band_profiles|public_bands|public_events|public_social_links)\b/);
  assert.equal([...candidate.matchAll(/CREATE FUNCTION public\.bandup_/g)].length, 6);
});

test('each privileged RPC pins search path, disables ambiguous RLS and checks actor', () => {
  const functions = [...candidate.matchAll(/CREATE FUNCTION public\.(\w+)[\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/g)];
  assert.equal(functions.length, 6);
  for (const [, name, body] of functions) {
    const definition = functions.find(m => m[1] === name)[0];
    assert.match(definition, /SECURITY DEFINER SET search_path='' SET row_security=off/);
    assert.match(definition, /auth\.uid\(\)/);
    assert.match(body, /42501/);
    assert.doesNotMatch(body, /\bEXECUTE\b/);
  }
  assert.match(candidate, /FROM PUBLIC,anon,authenticated,service_role;/);
  assert.match(candidate, /TO authenticated;\s*COMMIT;/);
});

test('requests have independent history, pending uniqueness and RPC-only writes', () => {
  assert.match(candidate, /CREATE UNIQUE INDEX band_join_one_pending[\s\S]*?WHERE status='pending'/);
  assert.match(candidate, /CHECK \(status IN \('pending','approved','rejected','cancelled'\)\)/);
  assert.match(candidate, /GRANT SELECT ON public\.band_join_requests TO authenticated/);
  assert.doesNotMatch(candidate, /GRANT (?:ALL|INSERT|UPDATE|DELETE)\b/);
  assert.equal([...candidate.matchAll(/CREATE POLICY /g)].length, 1);
  assert.match(candidate, /requester_id=\(SELECT auth\.uid\(\)\) OR EXISTS/);
  assert.match(candidate, /m\.user_id=\(SELECT auth\.uid\(\)\) AND m\.role='admin'/);
});

test('approval locks and checks authority, inserts member, then decides without swallowing errors', () => {
  const decide = candidate.split('CREATE FUNCTION public.bandup_decide_entry')[1].split('$fn$;')[0];
  assert.match(decide, /role='admin' FOR SHARE/);
  assert.match(decide, /public\.bands WHERE id=target_band FOR UPDATE/);
  assert.match(decide, /public\.band_join_requests WHERE id=p_request_id FOR UPDATE/);
  assert.match(decide, /request_row\.status<>'pending'/);
  assert.match(decide, /VALUES\(target_band,request_row\.requester_id,'member'\)/);
  assert.ok(decide.indexOf('INSERT INTO public.band_members') < decide.indexOf('UPDATE public.band_join_requests'));
  assert.doesNotMatch(decide, /ON CONFLICT|EXCEPTION WHEN|\bCOMMIT\b/);
});

test('discovery exposes curated fields only and bounds pagination', () => {
  const discover = candidate.split('CREATE FUNCTION public.bandup_discover_bands')[1].split('$fn$;')[0];
  assert.match(discover, /RETURNS TABLE\(band_id UUID,display_name TEXT,summary TEXT\)/);
  assert.match(discover, /p_limit NOT BETWEEN 1 AND 50/);
  assert.match(discover, /WHERE d\.accepting_requests/);
  assert.doesNotMatch(discover, /FROM public\.bands|auth\.users|SELECT \*/);
});

test('prepared tests cover authorization, late failure, concurrent terminal-state races and safe rollback', () => {
  for (const marker of ['42501', '23505', '55000', '22023', '23514', 'SET LOCAL ROLE anon',
    'failed decision rolls membership back', 'other band admin cannot read requests', 'own cancellation']) {
    assert.ok(sqlTests.includes(marker), marker);
  }
  assert.equal([...concurrent.matchAll(/^permutation /gm)].length, 6);
  assert.equal([...concurrent.matchAll(/^session /gm)].length, 3);
  assert.doesNotMatch(rollback, /DELETE FROM public\.band_members|DROP .* CASCADE/i);
  assert.equal([...rollback.matchAll(/DROP FUNCTION public\.bandup_/g)].length, 6);
});
