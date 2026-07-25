import { NextResponse } from 'next/server';

// Server-side proxy to the API — avoids CORS and keeps the API URL private.
const API_URL = (
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3333'
).replace(/\/$/, '');

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`${API_URL}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as
      | { message?: string }
      | null;
    if (!res.ok) {
      const error =
        res.status === 429
          ? 'Too many submissions — please try again in a minute.'
          : (data?.message ?? 'Could not submit — please check the fields.');
      return NextResponse.json({ ok: false, error }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not reach the API — please try again shortly.' },
      { status: 502 },
    );
  }
}
