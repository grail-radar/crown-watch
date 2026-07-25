import type { Metadata } from 'next';
import { AdminClient } from './admin-client';

export const metadata: Metadata = {
  title: 'Moderation — Crown Watch',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Server wrapper: passes the API base URL (server env) to the client UI.
 * The page itself is unlisted + noindex; every API call it makes requires the
 * x-admin-token header, so without the token it can only see an empty shell.
 */
export default function AdminPage() {
  const apiUrl = (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3333'
  ).replace(/\/$/, '');

  return <AdminClient apiUrl={apiUrl} />;
}
