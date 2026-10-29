/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

function load(globals = {}) {
  const loadedModule = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/date-time.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, Date, Intl, ...globals });
  return loadedModule.exports;
}
const d = load();
const plain = (value) => JSON.parse(JSON.stringify(value));
const now = Date.parse("2026-10-26T15:00:00Z");
const deadline = "2026-10-26T15:00:00.123456Z";

test("deadline remains current through 23:59:59.999 Sao Paulo and expires exactly at midnight", () => {
  const task = { status: "todo", due_date: deadline };
  for (const instant of ["2026-10-26T03:00:00Z", "2026-10-26T15:01:00Z", "2026-10-27T02:59:59.999Z"]) {
    assert.equal(d.isTaskOverdue(task, Date.parse(instant)), false, instant);
  }
  assert.equal(d.isTaskOverdue(task, Date.parse("2026-10-27T03:00:00Z")), true);
  assert.equal(d.isTaskOverdue({ ...task, status: "in_progress" }, Date.parse("2026-10-27T03:00:00Z")), true);
});

test("done, undated and invalid deadlines are never overdue", () => {
  for (const task of [
    { status: "done", due_date: "2000-01-01T12:00:00Z" },
    { status: "todo", due_date: null }, { status: "in_progress", due_date: null },
    { status: "todo", due_date: "invalid" },
  ]) assert.equal(d.isTaskOverdue(task, now), false);
});

test("calendar arithmetic handles year/month changes, leap days and historical Sao Paulo DST", () => {
  assert.equal(d.isTaskOverdue({ status: "todo", due_date: "2026-12-31" }, Date.parse("2027-01-01T03:00:00Z")), true);
  assert.equal(d.isTaskOverdue({ status: "todo", due_date: "2024-02-29" }, Date.parse("2024-03-01T02:59:59Z")), false);
  assert.equal(d.isTaskOverdue({ status: "todo", due_date: "2024-02-29" }, Date.parse("2024-03-01T03:00:00Z")), true);
  assert.equal(d.calendarDay("2018-12-01T02:30:00Z"), "2018-12-01");
  assert.equal(d.calendarDay("2026-12-01T02:30:00Z"), "2026-11-30");
});

test("literal dates are not parsed as UTC instants; new deadline writes are timezone independent", () => {
  assert.equal(d.calendarDay("2026-10-26"), "2026-10-26");
  assert.equal(d.validCalendarDay("2024-02-29"), true);
  for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01", "26/10/2026", "2026-1-1"]) {
    assert.equal(d.validCalendarDay(invalid), false, invalid);
    assert.throws(() => d.taskDeadlinePatch(invalid));
  }
  assert.deepEqual(plain(d.taskDeadlinePatch("2026-10-26")), { due_date: "2026-10-26T12:00:00.000Z" });
  assert.deepEqual(plain(d.taskDeadlinePatch("", deadline)), { due_date: null });
});

test("legacy task timestamps are read consistently and omitted on unchanged edits", () => {
  for (const original of [deadline, "2026-10-26T00:00:00.123456Z", "2026-10-26T12:00:00-03:00"]) {
    assert.deepEqual(plain(d.taskDeadlinePatch(d.calendarDay(original), original)), {});
  }
  assert.equal(d.calendarDay("2026-10-26T00:00:00Z"), "2026-10-25");
  assert.deepEqual(plain(d.taskDeadlinePatch("", null)), {});
});

test("new events reject past/invalid times but accept a future start and optional end", () => {
  const past = d.toLocalDateTimeInput("2026-10-25T12:00:00Z");
  const future = d.toLocalDateTimeInput("2026-10-27T12:00:00Z");
  assert.match(d.validateEventSchedule(past, "", now), /passado/);
  assert.equal(d.validateEventSchedule(future, "", now), null);
  assert.equal(d.validateEventSchedule(future, future, now), null);
  assert.match(d.validateEventSchedule(future, past, now), /término/);
  for (const invalid of ["", "2026-02-30T12:00", "2026-10-27T24:00", "2026-10-27T12:60", "2026-10-27T12:00junk"]) {
    assert.match(d.validateEventSchedule(invalid, "", now), /válidos/);
  }
  assert.match(d.validateEventSchedule(future, "invalid", now), /válidos/);
});

for (const phase of ["future", "started", "ended"]) {
  test(`${phase} event: original timestamps remain untouched with fractional seconds and explicit offsets`, () => {
    const original = {
      start_at: phase === "future" ? "2026-10-27T12:00:45.123456-03:00" : "2026-10-25T12:00:45.123456-03:00",
      end_at: phase === "ended" ? "2026-10-25T15:00:59.654321-03:00" : "2026-10-28T15:00:59.654321-03:00",
    };
    const start = d.toLocalDateTimeInput(original.start_at), end = d.toLocalDateTimeInput(original.end_at);
    assert.equal(d.validateEventSchedule(start, end, now, original), null);
    assert.deepEqual(plain(d.eventSchedulePatch(start, end, original)), {});
    const movedEnd = d.toLocalDateTimeInput("2026-10-29T15:00:00Z");
    assert.equal(d.validateEventSchedule(start, movedEnd, now, original), null);
    const patch = d.eventSchedulePatch(start, movedEnd, original);
    assert.equal("start_at" in patch, false);
    assert.equal(patch.end_at, "2026-10-29T15:00:00.000Z");
    assert.deepEqual(plain(d.eventSchedulePatch(start, "", original)), { end_at: null });
    const newPast = d.toLocalDateTimeInput("2026-10-24T12:00:00Z");
    assert.match(d.validateEventSchedule(newPast, end, now, original), /passado/);
  });
}

test("effective original seconds participate in validation, not the minute-truncated input", () => {
  const original = { start_at: "2026-10-27T12:00:45.123456Z", end_at: null };
  const start = d.toLocalDateTimeInput(original.start_at);
  assert.match(d.validateEventSchedule(start, start, now, original), /término/);
  const futureStart = d.toLocalDateTimeInput("2026-10-28T12:00:00Z");
  const patch = d.eventSchedulePatch(futureStart, "", original);
  assert.equal(patch.start_at, "2026-10-28T12:00:00.000Z");
  assert.equal("end_at" in patch, false);
});

test("final validation checks freshly read dates when another edit changed the original", () => {
  const original = { start_at: "2026-10-27T12:00:00Z", end_at: null };
  const current = { ...original, start_at: "2026-10-29T12:00:00Z" };
  const start = d.toLocalDateTimeInput(original.start_at);
  const end = d.toLocalDateTimeInput("2026-10-28T12:00:00Z");
  assert.equal(d.validateEventSchedule(start, end, now, original), null);
  assert.match(d.validateEventSchedule(start, end, now, original, current), /término/);
  assert.deepEqual(plain(d.eventSchedulePatch(start, "", original)), {});
});

// Separate processes keep each timezone isolated from all other tests.
for (const timezone of ["America/Sao_Paulo", "UTC", "Pacific/Kiritimati", "America/Los_Angeles"]) {
  test(`calendar deadlines, display, event round trips and midnight in ${timezone}`, () => {
    const code = `
      const assert = require('node:assert/strict');
      const d = (${load.toString()})();
      const value = '2026-10-26T15:00:00.123456Z';
      assert.equal(d.calendarDay(value), '2026-10-26');
      assert.equal(d.formatTaskDate(value), d.formatTaskDate('2026-10-26'));
      assert.equal(d.taskDeadlinePatch('2026-10-26').due_date, '2026-10-26T12:00:00.000Z');
      assert.equal(d.isTaskOverdue({status:'todo',due_date:value}, Date.parse('2026-10-27T02:59:59.999Z')), false);
      assert.equal(d.isTaskOverdue({status:'todo',due_date:value}, Date.parse('2026-10-27T03:00:00Z')), true);
      const local = d.toLocalDateTimeInput('2026-10-28T12:30:00Z');
      assert.equal(d.parseLocalDateTime(local).toISOString(), '2026-10-28T12:30:00.000Z');
      assert.equal(d.differentLocalEventDays('2026-10-26T10:00:00Z','2026-10-28T10:00:00Z'), true);
      assert.equal(d.differentLocalEventDays('2026-10-26T10:00:00Z','2026-10-26T10:30:00Z'), false);
      if (process.env.TZ === 'America/Los_Angeles') {
        assert.equal(Number.isNaN(d.parseLocalDateTime('2026-03-08T02:30').getTime()), true);
        const original = {start_at:'2026-11-01T09:30:45.123456Z',end_at:null};
        const start = d.toLocalDateTimeInput(original.start_at);
        assert.equal(Object.keys(d.eventSchedulePatch(start,'',original)).length, 0);
      }
    `;
    const setup = `const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');const __dirname=${JSON.stringify(__dirname)};`;
    const result = spawnSync(process.execPath, ["-e", setup + code], { cwd: path.join(__dirname, ".."), env: { ...process.env, TZ: timezone }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test("resume clock refreshes across midnight on visibility/focus/pageshow, and cleans up", () => {
  const win = new Map(), doc = new Map();
  let instant = Date.parse("2026-10-27T02:59:59Z"), timer, cleared = false;
  const document = { visibilityState: "visible", addEventListener: (k, v) => doc.set(k, v), removeEventListener: (k) => doc.delete(k) };
  const window = {
    addEventListener: (k, v) => win.set(k, v), removeEventListener: (k) => win.delete(k),
    setInterval: (callback) => { timer = callback; return 17; }, clearInterval: (id) => { assert.equal(id, 17); cleared = true; },
  };
  class ClockDate extends Date { static now() { return instant; } }
  const clockApi = load({ document, window, Date: ClockDate });
  const counts = [];
  const cleanup = clockApi.watchPageClock((value) => counts.push(clockApi.isTaskOverdue({ status: "todo", due_date: deadline }, value)));
  assert.deepEqual(counts, [false]);
  document.visibilityState = "hidden";
  instant = Date.parse("2026-10-27T03:00:00Z");
  timer(); doc.get("visibilitychange")();
  assert.deepEqual(counts, [false]);
  document.visibilityState = "visible";
  doc.get("visibilitychange")(); win.get("focus")(); win.get("pageshow")(); timer();
  assert.deepEqual(counts, [false, true, true, true, true]);
  cleanup();
  assert.equal(cleared, true); assert.equal(win.size, 0); assert.equal(doc.size, 0);
});
