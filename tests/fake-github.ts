/**
 * Minimal in-memory imitation of the GitHub Contents API (GET/PUT a file,
 * GET the repo) with the same status codes for missing files and sha conflicts.
 */
export function fakeGitHub(opts: { token?: string; private?: boolean } = {}) {
  const token = opts.token ?? 'good-token';
  const files = new Map<string, { content: string; sha: string }>();
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (headers.get('Authorization') !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' });
    const url = new URL(String(input));
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/.exec(url.pathname);
    if (!m) return json(404, { message: 'Not Found' });
    if (!m[3]) return json(200, { private: opts.private ?? true, permissions: { push: true } });

    const path = decodeURIComponent(m[3]);
    const file = files.get(path);
    if ((init.method ?? 'GET') === 'GET') {
      if (!file) return json(404, { message: 'Not Found' });
      if (headers.get('Accept') === 'application/vnd.github.raw+json') return new Response(atob(file.content), { status: 200 });
      return json(200, { sha: file.sha, content: file.content, encoding: 'base64' });
    }
    const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
    if (file && !body.sha) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
    if (file && body.sha !== file.sha) return json(409, { message: `${path} does not match ${body.sha}` });
    if (!file && body.sha) return json(422, { message: 'sha does not match any file' });
    const sha = `sha${++n}`;
    files.set(path, { content: body.content, sha });
    return json(file ? 200 : 201, { content: { sha } });
  };
  return { fetchFn, files };
}
