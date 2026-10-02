import type { AppDocument } from '../core/model';
import { serializeDocument } from '../core/transfer';
import type { SaveResult, StorageAdapter, StoredDocument } from './adapter';

export interface GitHubConfig {
  owner: string;
  repo: string;
  /** Empty = the repository's default branch. */
  branch: string;
  /** File path inside the repo, e.g. "3d-printing-calculator.json". */
  path: string;
  /** Fine-grained token with "Contents: read & write" on this repo only. */
  token: string;
}

type Fetch = typeof fetch;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Stores the document as one JSON file in a (private) GitHub repo via the
 * Contents API. The version is the file's blob sha; every save is a commit.
 */
export class GitHubAdapter implements StorageAdapter {
  readonly id = 'github';

  constructor(
    private readonly cfg: GitHubConfig,
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  get #fileUrl(): string {
    const path = this.cfg.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${this.#repoUrl}/contents/${path}`;
  }

  get #repoUrl(): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`;
  }

  get #ref(): string {
    return this.cfg.branch ? `?ref=${encodeURIComponent(this.cfg.branch)}` : '';
  }

  #headers(accept = 'application/vnd.github+json'): HeadersInit {
    return { Authorization: `Bearer ${this.cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  }

  async load(): Promise<StoredDocument | null> {
    const res = await this.fetchFn(this.#fileUrl + this.#ref, { headers: this.#headers(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw await githubError(res);
    const meta = (await res.json()) as { sha: string; content?: string; encoding?: string };
    let text: string;
    if (meta.encoding === 'base64' && meta.content) {
      text = decodeBase64Utf8(meta.content);
    } else {
      // Files over 1 MB come without inline content.
      const raw = await this.fetchFn(this.#fileUrl + this.#ref, { headers: this.#headers('application/vnd.github.raw+json'), cache: 'no-store' });
      if (!raw.ok) throw await githubError(raw);
      text = await raw.text();
    }
    return { doc: JSON.parse(text) as AppDocument, version: meta.sha };
  }

  async save(doc: AppDocument, expectedVersion: string | null): Promise<SaveResult> {
    const body = {
      message: 'Update data',
      content: encodeBase64Utf8(serializeDocument(doc)),
      ...(expectedVersion ? { sha: expectedVersion } : {}),
      ...(this.cfg.branch ? { branch: this.cfg.branch } : {}),
    };
    const res = await this.fetchFn(this.#fileUrl, { method: 'PUT', headers: this.#headers(), body: JSON.stringify(body) });
    if (res.ok) {
      const json = (await res.json()) as { content: { sha: string } };
      return { ok: true, version: json.content.sha };
    }
    // 409: sha does not match; 422: sha missing although the file exists.
    if (res.status === 409 || (res.status === 422 && /sha/i.test(await res.clone().text()))) {
      const current = await this.load();
      if (current) return { ok: false, conflict: current };
    }
    throw await githubError(res);
  }

  /** Checks token and repo access before connecting. */
  async check(): Promise<{ private: boolean; canWrite: boolean; fileExists: boolean }> {
    const res = await this.fetchFn(this.#repoUrl, { headers: this.#headers(), cache: 'no-store' });
    if (!res.ok) throw await githubError(res);
    const repo = (await res.json()) as { private: boolean; permissions?: { push?: boolean } };
    const file = await this.fetchFn(this.#fileUrl + this.#ref, { method: 'GET', headers: this.#headers(), cache: 'no-store' });
    if (!file.ok && file.status !== 404) throw await githubError(file);
    return { private: repo.private, canWrite: repo.permissions?.push ?? false, fileExists: file.ok };
  }
}

async function githubError(res: Response): Promise<GitHubError> {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    // not JSON
  }
  const hint =
    res.status === 401 ? 'Token invalid or expired.'
    : res.status === 403 ? 'Token lacks permission (needs "Contents: read & write" on this repository) or the rate limit was hit.'
    : res.status === 404 ? 'Repository not found, or the token has no access to it.'
    : `GitHub error ${res.status}.`;
  return new GitHubError(detail ? `${hint} (${detail})` : hint, res.status);
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
