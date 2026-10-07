'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRepo, createGitHub } = require('../src/core/github');
const { createClaude } = require('../src/core/claude');
const { isTestPath, annotatePatch, buildDiff, buildGapsRequest, normaliseGaps, toMarkdown, findGaps } = require('../src/core/gaps');

const PATCH = '@@ -10,3 +10,5 @@ function refund(order) {\n   const total = order.total;\n-  return total;\n+  if (order.partial) return total / 2;\n+  if (total < 0) throw new Error("bad");\n+  return total;\n ';
const FILES = [
  { filename: 'src/refund.js', status: 'modified', additions: 3, deletions: 1, patch: PATCH },
  { filename: 'test/refund.test.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n test("full", () => {});\n+test("partial", () => {});' },
  { filename: 'package-lock.json', status: 'modified', additions: 5, deletions: 5, patch: '@@ -1 +1 @@\n-a\n+b' },
  { filename: 'logo.png', status: 'added', additions: 0, deletions: 0, patch: '' }
];

test('parseRepo accepts owner/name and URLs, rejects junk', () => {
  assert.deepEqual(parseRepo('https://github.com/octo/hello.git'), { owner: 'octo', repo: 'hello' });
  assert.throws(() => parseRepo('hello'));
});

test('isTestPath recognises common test layouts and leaves source alone', () => {
  for (const p of ['test/a.js', 'src/__tests__/a.ts', 'src/a.test.tsx', 'src/a.spec.js', 'pkg/a_test.go', 'tests/test_a.py', 'app/test_models.py', 'lib/a_test.dart', 'spec/a_spec.rb', 'Foo/BarTests.cs', 'src/FooTest.java']) assert.ok(isTestPath(p), p);
  for (const p of ['src/a.js', 'src/contest.js', 'src/latest/a.js', 'docs/testing.md', 'src/attestation.go']) assert.ok(!isTestPath(p), p);
});

test('annotatePatch numbers new-file lines and skips removed ones', () => {
  const a = annotatePatch(PATCH);
  assert.deepEqual([...a.visible].sort((x, y) => x - y), [10, 11, 12, 13, 14]);
  assert.match(a.text, /   11 \| \+  if \(order\.partial\)/);
  assert.match(a.text, /      \| -  return total;/);
});

test('buildDiff separates source from tests and skips what cannot be read', () => {
  const d = buildDiff(FILES);
  assert.equal(d.included, 2);
  assert.equal(d.codeFiles, 1);
  assert.deepEqual(d.testsChanged, ['test/refund.test.js']);
  assert.deepEqual(d.skipped.map((s) => s.filename), ['package-lock.json', 'logo.png']);
  assert.match(d.text, /### test\/refund\.test\.js \(TEST FILE, modified/);
  assert.equal(buildDiff(FILES, 10).included, 0);
});

test('request lists existing tests and guards against invented or injected content', () => {
  const d = buildDiff(FILES);
  const many = Array.from({ length: 450 }, (_, i) => `test/t${i}.test.js`);
  const req = buildGapsRequest({ repoName: 'o/r', pull: { number: 7, title: 'Refunds', body: '' }, diff: d, testPaths: many, pathsTruncated: false });
  assert.match(req.system, /untrusted data/);
  assert.match(req.system, /Do not invent files/);
  assert.match(req.user, /EXISTING TEST FILES IN THE REPOSITORY \(partial list\)/);
  assert.ok(req.user.includes('test/t399.test.js') && !req.user.includes('test/t400.test.js'));
  assert.match(buildGapsRequest({ repoName: 'o/r', pull: { number: 7, title: 'x', body: '' }, diff: d, testPaths: [], pathsTruncated: false }).user, /\(none found\)/);
  assert.equal(req.tool.name, 'report_test_gaps');
});

test('normaliseGaps validates, sorts by risk and settles the verdict', () => {
  const d = buildDiff(FILES);
  const r = normaliseGaps({
    summary: ' s ', verdict: 'well_tested',
    gaps: [
      { file: 'src/refund.js', line: 99, risk: 'low', title: 'Off-diff line', why: 'w', cases: ['c'] },
      { file: 'src/refund.js', line: 12, risk: 'high', title: 'Negative total', why: 'w', cases: [' a ', '', 'b'], test_file: 'test/refund.test.js' },
      { file: 'src/made-up.js', line: 3, risk: 'odd', title: 'Unknown file', why: '', cases: ['c'] },
      { file: 'src/refund.js', line: 11, risk: 'high', title: 'No cases', why: 'w', cases: [] },
      { file: 'src/refund.js', line: 11, risk: 'high', title: '', why: 'w', cases: ['c'] }
    ]
  }, d);
  assert.equal(r.verdict, 'partly_tested'); // gaps were found, so "well tested" cannot stand
  assert.deepEqual(r.gaps.map((g) => [g.title, g.risk, g.file, g.line]), [
    ['Negative total', 'high', 'src/refund.js', 12],
    ['Unknown file', 'medium', '', 0],
    ['Off-diff line', 'low', 'src/refund.js', 0]
  ]);
  assert.deepEqual(r.gaps[0].cases, ['a', 'b']);
  assert.equal(r.testsChanged, 1);
  assert.equal(normaliseGaps({ summary: 's', verdict: 'untested', gaps: [] }, d).verdict, 'well_tested');
  assert.equal(normaliseGaps({ summary: 's', verdict: 'untested', gaps: [{ file: 'src/refund.js', line: 11, risk: 'high', title: 't', why: '', cases: ['c'] }] }, d).verdict, 'untested');
});

test('toMarkdown produces a checklist', () => {
  const md = toMarkdown({ summary: 'Sum.', gaps: [{ file: 'a.js', line: 3, risk: 'high', title: 'T', why: 'W.', cases: ['one', 'two'], testFile: 'test/a.test.js' }, { file: '', line: 0, risk: 'low', title: 'U', why: '', cases: ['x'], testFile: '' }] }, { pull: { number: 7 } });
  assert.equal(md, '### Blindspot: test gaps in #7\n\nSum.\n\n**HIGH: T** (`a.js:3`)\nW.\n\n- [ ] one\n- [ ] two\n\nSuggested location: `test/a.test.js`\n\n**LOW: U**\n\n- [ ] x\n\n_Found by Blindspot, powered by Claude. Based on the changed lines only._\n');
  assert.match(toMarkdown({ summary: 'S', gaps: [] }), /No untested risky logic found\./);
});

function fakeGitHub(files = FILES, { treeFails = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const p = url.replace('https://api.github.com', '');
    calls.push({ p, init });
    const json = (data) => ({ ok: true, json: async () => data });
    if (init.method === 'POST') return json({ html_url: 'https://github.com/o/r/pull/7#issuecomment-1', id: 3 });
    if (p === '/repos/o/r/pulls/7') return json({ number: 7, title: 'Refunds', body: 'b', user: { login: 'dev' }, state: 'open', html_url: 'u', head: { sha: 'abc' } });
    if (p.startsWith('/repos/o/r/pulls/7/files')) return json(files);
    if (p.startsWith('/repos/o/r/git/trees/abc')) {
      if (treeFails) return { ok: false, status: 409, json: async () => ({ message: 'Git Repository is empty.' }) };
      return json({ truncated: false, tree: [{ type: 'blob', path: 'src/refund.js' }, { type: 'blob', path: 'test/refund.test.js' }, { type: 'tree', path: 'test' }] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { github: createGitHub({ token: 't', fetchImpl }), calls };
}

function fakeClaude(input) {
  const seen = [];
  const client = { messages: { create: async (req) => { seen.push(req); return { content: [{ type: 'tool_use', name: req.tools[0].name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  return { claude: createClaude({ client, model: 'm' }), seen };
}

test('findGaps runs end to end and the checklist can be posted', async () => {
  const { github, calls } = fakeGitHub();
  const { claude, seen } = fakeClaude({ summary: 'Partial refunds are tested; negative totals are not.', verdict: 'partly_tested', gaps: [{ file: 'src/refund.js', line: 12, risk: 'high', title: 'Negative total', why: 'Throws in production.', cases: ['total -1 throws "bad"'], test_file: 'test/refund.test.js' }] });
  const { pull, report } = await findGaps({ github, claude, owner: 'o', repo: 'r', number: 7 });
  assert.equal(report.verdict, 'partly_tested');
  assert.equal(report.existingTests, 1);
  assert.equal(report.gaps[0].line, 12);
  assert.deepEqual(seen[0].tool_choice, { type: 'tool', name: 'report_test_gaps' });
  assert.match(seen[0].messages[0].content, /EXISTING TEST FILES IN THE REPOSITORY\ntest\/refund\.test\.js\n/);

  const posted = await github.createComment('o', 'r', 7, toMarkdown(report, { pull }));
  assert.equal(posted.id, 3);
  assert.match(calls.at(-1).p, /\/issues\/7\/comments$/);
  assert.match(JSON.parse(calls.at(-1).init.body).body, /- \[ \] total -1 throws "bad"/);
});

test('findGaps skips Claude for test-only changes and survives a missing file list', async () => {
  const none = { callTool: async () => { throw new Error('should not be called'); } };
  const testsOnly = fakeGitHub([FILES[1]]);
  const a = await findGaps({ github: testsOnly.github, claude: none, owner: 'o', repo: 'r', number: 7 });
  assert.equal(a.report.verdict, 'well_tested');
  assert.match(a.report.summary, /only test files/);
  const nothing = fakeGitHub([FILES[3]]);
  assert.match((await findGaps({ github: nothing.github, claude: none, owner: 'o', repo: 'r', number: 7 })).report.summary, /no reviewable/);

  const broken = fakeGitHub(FILES, { treeFails: true });
  const { claude } = fakeClaude({ summary: 's', verdict: 'well_tested', gaps: [] });
  const b = await findGaps({ github: broken.github, claude, owner: 'o', repo: 'r', number: 7 });
  assert.equal(b.report.existingTests, 0);
  assert.equal(b.report.verdict, 'well_tested');
});

test('GitHub failures become readable messages', async () => {
  const mk = (status, body) => createGitHub({ token: 't', fetchImpl: async () => ({ ok: false, status, json: async () => body }) });
  await assert.rejects(mk(401, {}).listPulls('o', 'r'), /rejected the access token/);
  await assert.rejects(mk(403, { message: 'Resource not accessible by personal access token' }).createComment('o', 'r', 1, 'x'), /not allowed to do that/);
});
