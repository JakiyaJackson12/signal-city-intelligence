// Same-origin bridge from the public Netlify frontend to the project's deployed
// FastAPI service. Set PYTHON_API_ORIGIN in this Netlify site's environment.
// Example: https://your-service.onrender.com (do NOT add /api).
export default async function handler(request) {
  const incoming = new URL(request.url);
  const route = incoming.searchParams.get('path') || '';
  if (!/^[a-zA-Z0-9_/-]+$/.test(route) || route.startsWith('/') || route.includes('..')) {
    return Response.json({ detail: 'Invalid API route' }, { status: 400 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ detail: 'Method not allowed' }, { status: 405 });
  }
  const base = (process.env.PYTHON_API_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!base) {
    return Response.json({ ok: false, detail: 'Full-stack backend not connected on this Netlify site' }, { status: 503 });
  }
  let upstream;
  try {
    upstream = new URL(base);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password) throw new Error();
    upstream.pathname = upstream.pathname.replace(/\/$/, '') + '/api/' + route;
    upstream.search = new URLSearchParams([...incoming.searchParams].filter(([key]) => key !== 'path')).toString();
  } catch {
    return Response.json({ ok: false, detail: 'Invalid backend configuration' }, { status: 503 });
  }
  try {
    const response = await fetch(upstream.toString(), {
      method: request.method,
      headers: { Accept: 'application/json' },
      signal: request.signal,
    });
    const contentType = response.headers.get('content-type') || 'application/json';
    const body = request.method === 'HEAD' ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ ok: false, detail: 'Python backend could not be reached. Try again shortly.' }, { status: 502 });
  }
}
