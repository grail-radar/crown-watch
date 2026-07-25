import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmitForm } from './submit-form';

export const metadata: Metadata = {
  title: 'Submit a drop',
  description:
    'Spotted a microbrand release, waitlist opening or restock the radar missed? Send it in — every submission is reviewed by a human before it goes live.',
  alternates: { canonical: '/submit' },
  openGraph: {
    type: 'website',
    url: '/submit',
    title: 'Submit a drop | Crown Watch',
    description:
      'Spotted a microbrand release the radar missed? Send it in — reviewed by a human before publishing.',
  },
};

export default function SubmitPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24">
      <div className="pt-10">
        <Link href="/" className="text-sm text-faint transition hover:text-ink">
          ← Back to the radar
        </Link>
      </div>

      <header className="py-10">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-faint">
          Community
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Submit a drop
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-faint">
          The radar watches five publications, but the best microbrand news
          often travels by word of mouth first. If you spotted a release,
          waitlist opening or restock we missed, send it over.
        </p>
      </header>

      <SubmitForm />
    </main>
  );
}
