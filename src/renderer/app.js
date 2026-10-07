'use strict';
/* Blindspot window. Talks to the main process only through window.blindspot. */

const api = window.blindspot;
const $ = (id) => document.getElementById(id);

const state = {
  view: 'gaps',
  repo: '',
  settings: null,
  pulls: [],
  pullState: 'open',
  selected: null,
  result: null,   // { pull, report }
  posted: null,
  busy: ''
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function call(fn, payload) {
  const res = await fn(payload);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function notify(message, good) {
  const n = $('notice');
  n.textContent = message || '';
  n.hidden = !message;
  n.className = good ? 'notice good' : 'notice';
}

async function guard(label, fn) {
  if (state.busy) return;
  state.busy = label;
  notify('');
  render();
  try {
    await fn();
  } catch (err) {
    notify(err.message);
  } finally {
    state.busy = '';
    render();
  }
}

const link = (text, url) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal({ url }); } }, text);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- actions ---------- */

async function loadRepo(text) {
  await guard('Loading pull requests', async () => {
    const data = await call(api.listPulls, { repo: text, state: state.pullState });
    state.repo = data.repo;
    state.pulls = data.pulls;
    state.selected = null;
    state.result = null;
    state.posted = null;
    $('repo').value = data.repo;
  });
}

function selectPull(pull) {
  state.selected = pull;
  state.result = null;
  state.posted = null;
  notify('');
  render();
}

const find = () => guard('Finding gaps', async () => {
  state.result = await call(api.findGaps, { repo: state.repo, number: state.selected.number });
  state.posted = null;
});

async function post() {
  const r = state.result;
  const ok = window.confirm(`Post this checklist as a comment on pull request #${r.pull.number}?\n\nIt will appear under your GitHub account, and everyone with access to the repository can see it.`);
  if (!ok) return;
  await guard('Posting', async () => {
    state.posted = await call(api.postReport, { repo: state.repo, number: r.pull.number, report: r.report, pull: r.pull });
    notify('Checklist posted to GitHub.', true);
  });
}

/* ---------- views ---------- */

function viewGaps() {
  if (!state.repo) {
    return h('div', {}, h('h1', {}, 'Find test gaps'),
      h('p', { class: 'lead' }, 'Enter a GitHub repository above and choose Load. Blindspot reads a pull request and lists the risky logic that no test covers, with the test cases to write.'));
  }
  const list = h('div', { class: 'panel' },
    h('header', {}, 'Pull requests',
      h('span', { class: 'tabs' },
        ...['open', 'closed'].map((s) => h('button', { class: state.pullState === s ? 'on' : '', onclick: () => { state.pullState = s; loadRepo(state.repo); } }, s === 'open' ? 'Open' : 'Closed')))),
    state.pulls.length
      ? h('ul', { class: 'pulls' }, state.pulls.map((p) => h('li', {},
          h('button', { class: state.selected && state.selected.number === p.number ? 'on' : '', onclick: () => selectPull(p) },
            h('div', { class: 't' }, `#${p.number} ${p.title}`),
            h('div', { class: 'm' }, `${p.author} · ${p.draft ? 'draft' : p.state}`)))))
      : h('div', { class: 'empty' }, `No ${state.pullState} pull requests.`));
  return h('div', { class: 'split' }, list, pane());
}

function pane() {
  const p = state.selected;
  if (!p) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'Choose a pull request.'));
  const head = h('div', {},
    h('h1', {}, `#${p.number} ${p.title}`),
    h('p', { class: 'lead' }, `by ${p.author} · ${p.state} · `, link('Open on GitHub', p.url)));

  if (state.busy === 'Finding gaps') {
    return h('div', {}, head, h('p', {}, h('span', { class: 'spin' }), 'Claude is reading the changes and their tests. Large pull requests can take a minute.'));
  }
  if (!state.result) {
    return h('div', {}, head, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: find, disabled: !!state.busy }, 'Find test gaps')));
  }

  const r = state.result.report;
  const label = { well_tested: 'Well tested', partly_tested: 'Partly tested', untested: 'Untested' }[r.verdict];
  const facts = [`${plural(r.codeFiles, 'source file')} changed`, `${plural(r.testsChanged, 'test file')} changed`];
  if (r.existingTests != null) facts.push(`${plural(r.existingTests, 'test file')} in the repository`);
  if (r.skipped.length) facts.push(`${r.skipped.length} not read (${r.skipped.map((s) => s.filename).slice(0, 3).join(', ')}${r.skipped.length > 3 ? ', …' : ''})`);

  return h('div', {}, head,
    h('span', { class: `verdict ${r.verdict}` }, label),
    h('p', { class: 'summary' }, r.summary),
    h('p', { class: 'facts' }, `${facts.join(' · ')}. Blindspot sees only the changed lines, so check each gap against tests it could not see.`),
    r.gaps.length ? r.gaps.map(gap) : h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No untested risky logic found.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: !!state.busy, onclick: () => guard('Copying', async () => { await call(api.copyReport, { report: r, pull: state.result.pull }); notify('Checklist copied to the clipboard.', true); }) }, 'Copy as checklist'),
      state.posted
        ? link('View the comment on GitHub', state.posted.url)
        : h('button', { class: 'btn ghost', onclick: post, disabled: !!state.busy }, state.busy === 'Posting' ? 'Posting…' : 'Post as a comment'),
      h('button', { class: 'btn ghost', onclick: find, disabled: !!state.busy }, 'Look again')));
}

function gap(g) {
  return h('article', { class: `finding ${g.risk}` },
    h('div', { class: 'top' }, h('span', { class: `sev ${g.risk}` }, `${g.risk} risk`), h('h3', {}, g.title)),
    g.file ? h('div', { class: 'loc' }, g.line ? `${g.file}:${g.line}` : g.file) : null,
    g.why ? h('p', {}, g.why) : null,
    h('ul', { class: 'cases' }, g.cases.map((c) => h('li', {}, c))),
    g.testFile ? h('div', { class: 'where' }, 'Suggested location: ', h('code', {}, g.testFile)) : null);
}

function viewSettings() {
  const s = state.settings || { models: [] };
  const fields = {};
  const save = () => guard('Saving', async () => {
    await call(api.saveSettings, { model: fields.model.value, anthropicKey: fields.key.value, githubToken: fields.token.value });
    state.settings = await call(api.getSettings);
    notify('Settings saved.', true);
  });
  return h('div', {},
    h('h1', {}, 'Settings'),
    h('p', { class: 'lead' }, 'Both keys are encrypted on this computer and are sent only to Anthropic and GitHub. Blindspot has no server of its own.'),
    h('div', { class: 'field' },
      h('label', { for: 'key' }, 'Anthropic API key'),
      fields.key = h('input', { id: 'key', type: 'password', autocomplete: 'off', placeholder: s.hasAnthropicKey ? 'Saved. Enter a new key to replace it.' : 'sk-ant-…' }),
      h('span', { class: 'hint' }, 'Each run is billed to this key. ', link('Get a key', 'https://console.anthropic.com/settings/keys'))),
    h('div', { class: 'field' },
      h('label', { for: 'token' }, 'GitHub access token'),
      fields.token = h('input', { id: 'token', type: 'password', autocomplete: 'off', placeholder: s.hasGithubToken ? 'Saved. Enter a new token to replace it.' : 'github_pat_…' }),
      h('span', { class: 'hint' }, 'A fine-grained token with Contents: read and Pull requests: read. Posting comments needs Pull requests: read and write. ', link('Create a token', 'https://github.com/settings/personal-access-tokens/new'))),
    h('div', { class: 'field' },
      h('label', { for: 'model' }, 'Claude model'),
      fields.model = h('select', { id: 'model' }, s.models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.label)))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save, disabled: !!state.busy }, 'Save settings')));
}

function render() {
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.view === state.view);
  $('repoStatus').textContent = state.busy === 'Loading pull requests' ? 'Loading…' : '';
  $('view').replaceChildren((state.view === 'settings' ? viewSettings : viewGaps)());
}

/* ---------- start ---------- */

$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  notify('');
  render();
});
$('repoBar').addEventListener('submit', (e) => {
  e.preventDefault();
  loadRepo($('repo').value);
});

(async function start() {
  try {
    state.settings = await call(api.getSettings);
    $('repo').value = state.settings.lastRepo || '';
    if (!state.settings.hasAnthropicKey || !state.settings.hasGithubToken) {
      state.view = 'settings';
      notify('Welcome. Add your two keys to get started.', true);
    }
  } catch (err) {
    notify(err.message);
  }
  render();
})();
