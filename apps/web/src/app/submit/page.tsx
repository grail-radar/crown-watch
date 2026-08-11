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
        <Link href="/" className="text-sm text-muted transition hover:text-ink">
          ← Back to the radar
        </Link>
      </div>

      <header className="border-b border-rule py-12">
        <h1 className="display text-[clamp(2.25rem,5vw,3.5rem)]">
          Submit a drop
        </h1>
        <p className="mt-6 max-w-[34rem] leading-relaxed text-muted">
          The radar watches five publications, but the best microbrand news
          often travels by word of mouth first. If you spotted a launch,
          waitlist opening or restock we missed, send it over.
        </p>
      </header>

      <SubmitForm />
    </main>
  );
}
