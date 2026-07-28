/**
 * robots.txt handling — pure, no network.
 *
 * These stores are the subject of the product, so being a bad citizen towards
 * them is an existential risk rather than a lint warning. The cases below are
 * the ones real store robots.txt files actually contain.
 */
import { isAllowed, parseRobots, userAgentToken } from './robots';

const UA = 'CrownWatchBot/0.1 (+https://crownswatch.org/about-the-bot)';
const allows = (body: string, path: string) =>
  isAllowed(parseRobots(body, UA), path);

describe('parseRobots / isAllowed', () => {
  it('allows everything when there is no robots.txt content', () => {
    expect(allows('', '/products.json')).toBe(true);
  });

  it('honours a disallowed path', () => {
    const body = 'User-agent: *\nDisallow: /admin';

    expect(allows(body, '/admin')).toBe(false);
    expect(allows(body, '/admin/orders')).toBe(false);
    expect(allows(body, '/products.json')).toBe(true);
  });

  it('ignores a group aimed at a different crawler', () => {
    // A shop blocking GPTBot has said nothing about us.
    const body = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /cart';

    expect(allows(body, '/products.json')).toBe(true);
    expect(allows(body, '/cart')).toBe(false);
  });

  it('prefers a group that names us over the wildcard', () => {
    const body =
      'User-agent: *\nDisallow: /\n\nUser-agent: crownwatchbot\nDisallow: /checkout';

    expect(allows(body, '/products.json')).toBe(true);
    expect(allows(body, '/checkout')).toBe(false);
  });

  it('lets a longer Allow carve an exception out of a broad Disallow', () => {
    // Shopify's stock robots.txt is shaped exactly like this.
    const body = 'User-agent: *\nDisallow: /\nAllow: /products.json';

    expect(allows(body, '/products.json')).toBe(true);
    expect(allows(body, '/anything-else')).toBe(false);
  });

  it('treats an empty Disallow as permission, not prohibition', () => {
    expect(allows('User-agent: *\nDisallow:', '/products.json')).toBe(true);
  });

  it('understands wildcards and end-anchors', () => {
    const body = 'User-agent: *\nDisallow: /*/preview$\nDisallow: /*.pdf';

    expect(allows(body, '/collections/preview')).toBe(false);
    expect(allows(body, '/collections/preview/live')).toBe(true); // $ anchored
    expect(allows(body, '/files/catalogue.pdf')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const body = '# store rules\n\nUser-agent: *   # everyone\nDisallow: /cart\n';

    expect(allows(body, '/cart')).toBe(false);
    expect(allows(body, '/products.json')).toBe(true);
  });

  it('groups consecutive user-agent lines together', () => {
    const body = 'User-agent: BadBot\nUser-agent: *\nDisallow: /private';

    expect(allows(body, '/private')).toBe(false);
  });

  it('reads a crawl delay when the site asks for one', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 10', UA).crawlDelay).toBe(10);
    expect(parseRobots('User-agent: *\nDisallow: /x', UA).crawlDelay).toBeNull();
  });

  it('matches our bot on the token before the version', () => {
    expect(userAgentToken(UA)).toBe('crownwatchbot');
  });
});
