/** Canonical public URL of the site (used by metadata, sitemap, JSON-LD). */
export const SITE_URL = (
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://crown-watch-web.vercel.app'
).replace(/\/$/, '');

export const SITE_NAME = 'Crown Watch';
export const SITE_TAGLINE = 'Microbrand watch drop & waitlist radar';
export const SITE_DESCRIPTION =
  'New launches, Kickstarter campaigns, waitlist openings, and restocks from independent microbrand watchmakers — all in one feed.';
