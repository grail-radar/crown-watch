/**
 * Which store products are the same Watch — pure, no I/O.
 *
 * Written as a table of cases on purpose (ADR-0003): the rule is deliberately
 * simple, so what it does and does not merge has to be readable at a glance and
 * correctable by editing, rather than inferred from a poll.
 */
import { watchIdentity } from './watch-identity';

const key = (brand: string, title: string) => watchIdentity(brand, title).key;

describe('watchIdentity', () => {
  it('groups the three references YEMA lists as one model', () => {
    // The real case that started this: yema.com lists Superman Bronze CMM.10 as
    // three separate products — …-38-zn-u8, …-37-zn-u7, …-34-zn-u4 — with one
    // title between them. Three products, one watch, and so one alert.
    const titles = [
      'Superman Bronze CMM.10',
      'Superman Bronze CMM.10',
      'Superman Bronze CMM.10',
    ];

    expect(new Set(titles.map((t) => key('yema', t))).size).toBe(1);
  });

  it('keeps Baltic’s two dials as two watches', () => {
    // The boundary case. An enthusiast will tell you a Panda and a Reverse
    // Panda are two watches to want, not one watch in two flavours — which is
    // why the rule must not strip trailing words to find a common stem.
    expect(key('baltic', 'Scalegraph Classic - Panda')).not.toBe(
      key('baltic', 'Scalegraph Classic - Reverse Panda'),
    );
  });

  it('never merges across brands', () => {
    // Two brands may sell a "Diver 300"; they are not the same watch.
    expect(key('baltic', 'Aquascaphe')).not.toBe(key('yema', 'Aquascaphe'));
  });

  it('ignores case, padding and the shape of the dash', () => {
    // A store editing "  Superman   Bronze " into "Superman Bronze" is not a
    // new release, and en-dash versus hyphen is typography, not identity.
    const canonical = key('yema', 'Superman Bronze - Steel');

    expect(key('yema', '  superman   bronze - steel  ')).toBe(canonical);
    expect(key('yema', 'Superman Bronze – Steel')).toBe(canonical);
    expect(key('yema', 'Superman Bronze — Steel')).toBe(canonical);
  });

  it('drops a trailing reference in brackets', () => {
    // Some stores tack the SKU onto the title for one variant and not another.
    // Bracketed, at the end, is unambiguous enough to remove.
    expect(key('serica', 'Réf. 8315-2 (SYU66-20-SS)')).toBe(
      key('serica', 'Réf. 8315-2'),
    );
  });

  it('does not strip a trailing word that is part of the name', () => {
    // The conservative half of the rule, and the reason Baltic survives above:
    // a bare trailing token is far more often the model than a variant code.
    expect(key('baltic', 'Scalegraph Classic')).not.toBe(
      key('baltic', 'Scalegraph'),
    );
  });

  it('keeps a title that is nothing but a reference', () => {
    // Serica genuinely sells "Réf. 8315-2". Normalising it away would leave a
    // watch with no identity at all.
    expect(key('serica', 'Réf. 8315-2')).toBeTruthy();
  });

  it('is stable across calls, so a re-poll does not move a watch', () => {
    expect(key('yema', 'Superman Bronze CMM.10')).toBe(
      key('yema', 'Superman Bronze CMM.10'),
    );
  });

  it('offers a display name that reads like the store’s own', () => {
    // The key is for matching and is allowed to be ugly; what a reader sees is
    // the title as written, tidied but not case-folded.
    expect(watchIdentity('yema', '  superman   BRONZE  ').name).toBe(
      'superman BRONZE',
    );
  });

  it('produces a slug that is safe in a URL', () => {
    const { slug } = watchIdentity('serica', 'Réf. 8315-2 (SYU66-20-SS)');

    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps the reference it stripped, rather than discarding it', () => {
    // It is the one piece of per-variant identity a store hands us for free,
    // and a Variant is required to carry one.
    expect(watchIdentity('serica', 'Réf. 8315-2 (SYU66-20-SS)').reference).toBe(
      'SYU66-20-SS',
    );
    expect(watchIdentity('serica', 'Réf. 8315-2').reference).toBeNull();
  });

  it('gives two different watches two different slugs', () => {
    expect(watchIdentity('baltic', 'Scalegraph Classic - Panda').slug).not.toBe(
      watchIdentity('baltic', 'Scalegraph Classic - Reverse Panda').slug,
    );
  });
});
