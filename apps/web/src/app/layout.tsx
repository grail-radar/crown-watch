import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crown Watch — Microbrand watch drop & waitlist radar',
  description:
    'New launches, Kickstarter campaigns, waitlist openings, and restocks from independent microbrand watchmakers — all in one feed.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
