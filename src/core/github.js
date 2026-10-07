'use strict';
// Minimal GitHub REST client: only the calls Blindspot needs.

const API = 'https://api.github.com';
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function parseRepo(text) {
  const cleaned = String(text || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const repo = (parts[1] || '').replace(/\.git$/i, '');
  if (parts.length < 2 || !NAME.test(parts[0]) || !NAME.test(repo) || /^\.+$/.test(parts[0]) || /^\.+$/.test(repo)) {
    throw new Error('Enter the repository as owner/name, for example octocat/hello-world.');
  }
  return { owner: parts[0], repo };
}

function createGitHub({ token, fetchImpl = fetch } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Blindspot' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json();
        if (json && json.message) detail = json.message;
      } catch { /* body was not JSON */ }
      let message = `GitHub returned ${res.status}${detail ? `: ${detail}` : ''}`;
      if (res.status === 401) message = 'GitHub rejected the access token. Check it in Settings.';
      else if (res.status === 404) message = 'GitHub could not find that. Check the repository name and that your token can see it.';
      else if (res.status === 403 && /not accessible/i.test(detail)) message = 'Your GitHub token is not allowed to do that. Check its permissions in Settings.';
      throw new GitHubError(res.status, message);
    }
    return res.json();
  }

  async function paginate(path, max) {
    const out = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; out.length < max; page++) {
      const batch = await request(`${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.slice(0, max);
  }

  const base = (owner, repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    async listPulls(owner, repo, state = 'open') {
      const s = state === 'closed' ? 'closed' : 'open';
      const pulls = await paginate(`${base(owner, repo)}/pulls?state=${s}&sort=updated&direction=desc`, 100);
      return pulls.map(summarisePull);
    },
    async getPull(owner, repo, number) {
      return summarisePull(await request(`${base(owner, repo)}/pulls/${Number(number)}`));
    },
    async listPullFiles(owner, repo, number) {
      const files = await paginate(`${base(owner, repo)}/pulls/${Number(number)}/files`, 300);
      return files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch || '' }));
    },
    // Every file path in the repository at a commit. GitHub may cut very large trees short.
    async listPaths(owner, repo, sha) {
      const tree = await request(`${base(owner, repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
      return { paths: (tree.tree || []).filter((e) => e.type === 'blob').map((e) => e.path), truncated: !!tree.truncated };
    },
    async createComment(owner, repo, number, body) {
      const res = await request(`${base(owner, repo)}/issues/${Number(number)}/comments`, { method: 'POST', body: { body } });
      return { url: res.html_url, id: res.id };
    }
  };
}

function summarisePull(p) {
  return {
    number: p.number,
    title: p.title,
    body: p.body || '',
    author: p.user ? p.user.login : '',
    state: p.merged_at ? 'merged' : p.state,
    draft: !!p.draft,
    url: p.html_url,
    headSha: p.head ? p.head.sha : ''
  };
}

module.exports = { createGitHub, parseRepo, GitHubError };
