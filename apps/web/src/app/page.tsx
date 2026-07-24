export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <span className="text-sm font-medium uppercase tracking-widest text-neutral-500">
        Crown Watch
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Microbrand watch drop &amp; waitlist radar
      </h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        New launches, Kickstarter campaigns, waitlist openings, and restocks
        from independent watchmakers — all in one feed. This is an early
        scaffold; the public feed and brand directory are on the way.
      </p>
    </main>
  );
}
