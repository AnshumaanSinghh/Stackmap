// Small git helpers: repository URL (for evidence links), commit, and exporting a ref to a folder.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
}

export function gitInfo(root) {
  const info = { repoUrl: null, commit: null, branch: null, prefix: '' };
  try {
    info.prefix = git(root, ['rev-parse', '--show-prefix']).replace(/\/$/, '');
    info.commit = git(root, ['rev-parse', 'HEAD']);
    info.branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const remote = git(root, ['remote', 'get-url', 'origin']);
    info.repoUrl = webUrl(remote);
  } catch {
    /* not a git repo, or no remote */
  }
  return info;
}

/** git@github.com:o/r.git, https://x@github.com/o/r -> https://github.com/o/r */
export function webUrl(remote) {
  if (!remote) return null;
  let r = remote.trim();
  const ssh = r.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/);
  if (ssh) r = `https://${ssh[1]}/${ssh[2]}`;
  else r = r.replace(/^git\+/, '').replace(/^http:\/\//, 'https://').replace(/\/\/[^@/]+@/, '//').replace(/\.git\/?$/, '');
  if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+/.test(r)) return null;
  return r;
}

/** Link to a file and line on the forge, if we know where the repo lives. */
export function blobUrl(repoUrl, commit, prefix, file, line) {
  if (!repoUrl) return null;
  const ref = commit || 'HEAD';
  const p = [prefix, file].filter(Boolean).join('/');
  if (/gitlab/.test(repoUrl)) return `${repoUrl}/-/blob/${ref}/${p}${line ? `#L${line}` : ''}`;
  if (/bitbucket/.test(repoUrl)) return `${repoUrl}/src/${ref}/${p}${line ? `#lines-${line}` : ''}`;
  return `${repoUrl}/blob/${ref}/${p}${line ? `#L${line}` : ''}`;
}

/**
 * Export the tree at `ref` (limited to the subdirectory `root` lives in) into a temp folder.
 * Uses `git archive`, so nothing in the working tree changes.
 */
export function exportRef(root, ref) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const prefix = git(root, ['rev-parse', '--show-prefix']).replace(/\/$/, '');
  try {
    git(top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(`git ref not found: ${ref}. In CI, fetch it first (for example: git fetch --depth=1 origin ${ref}).`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-'));
  const tarFile = path.join(dir, 'tree.tar');
  const args = ['archive', '--format=tar', '-o', tarFile, ref];
  if (prefix) args.push('--', prefix);
  git(top, args);
  execFileSync('tar', ['-xf', tarFile, '-C', dir], { stdio: 'ignore' });
  fs.rmSync(tarFile);
  return { dir: prefix ? path.join(dir, prefix) : dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : null;
}
