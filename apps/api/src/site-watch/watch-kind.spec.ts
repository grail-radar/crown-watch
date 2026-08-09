/**
 * What a store product is — pure, no I/O.
 *
 * Written as a table of cases, like `watch-identity.spec.ts` and for the same
 * reason (ADR-0003): the rule is deliberately simple, so what it does and does
 * not catch has to be readable at a glance and correctable by editing a row.
 *
 * Every title below is real. They come from the four registered store brands,
 * and most of them were announced to both public Channels as watch releases.
 */
import { classifyWatchKind } from './watch-kind';

const isAccessory = (title: string) => classifyWatchKind(title) === 'accessory';

describe('classifyWatchKind', () => {
  describe('things a shop sells that are not watches', () => {
    it.each([
      // YEMA — ten of these reached the Channels as new releases.
      'Leather Strap',
      'Satin Leather Strap',
      'Rallye Leather Strap',
      'Vintage Grained Leather Strap',
      'Black Smooth Leather Strap',
      'FKM Viton® Integrated Strap',
      'Full Lume Rubber Fkm Viton® Scales Strap',
      'Marine Nationale Parachute Strap',
      'Canvas Strap',
      'Rubber Strap with your watch',
      // Bracelets, including ones carrying a movement reference.
      'Mesh Bracelet',
      'Military Steel Bracelet',
      'Scales Slim Steel Bracelet CMM.10',
      'Wristmaster Slim Tapered Bracelet',
      'Signature Beads of Rice Bracelet',
      // Serica, in French.
      'Bracelet Lézard - Marron',
      "Bracelet 'Parade' - Alligator Noir",
      'Boucle SERICA',
      "Sangle 'PLD' Vert Olive",
      'Étui de transport',
      'Ajouter votre gravure',
      'Ajouter pièces de bout',
      'Pièces de bout',
      // Merchandise and shop furniture.
      'YEMA Travel Case',
      "YEMA Collectors' Watch Box",
      'YEMA Gift Card',
      'YEMA Spring Bar Tool',
      'YEMA Card Holder',
      'Warranty Product',
      'CRONUS ART Strap Model A',
      "CRONUS ART Women's Strap",
      'Handmade Crocodile Strap',
      // Named outright rather than by pattern. Nothing in these titles gives
      // them away, and matching the whole title costs no watch its release:
      // none of them could ever be a watch's exact name.
      'Bonklip®',
      'Vesper Mesh',
      "'Black Tie'", // spring bars
      'SERICA Expédition',
      'YEMA Cap',
    ])('treats "%s" as an accessory', (title) => {
      expect(isAccessory(title)).toBe(true);
    });
  });

  describe('watches, which must keep reaching the feed', () => {
    it.each([
      'Superman Bronze CMM.10',
      'Superman Dato CMM.10',
      'Urban Traveller',
      'Radiance',
      'Granvelle Renaissance CMM.29',
      'Skin Diver CMM.20',
      'Wristmaster Slim Small Seconds CMM.29',
      'Navygraf Marine Nationale 400th Anniversary Edition',
      'Flygraf Bi-Compax French Air Force',
      'Rallygraf Meca-Quartz II Reverse Panda',
      'Yachtingraf Croisière Meca-Quartz',
      'Pearldiver',
      'Diver',
      'Scalegraph Classic - Reverse Panda',
      'L2 Chronograph',
      'Legacy Automatic: Azure',
      'Viajero SE',
      'CRONUS ART CM002-15A Daytona Limited Edition',
      'Réf. 8315-2',
      'Réf. 6190 California',
    ])('treats "%s" as a watch', (title) => {
      expect(isAccessory(title)).toBe(false);
    });

    it('does not mistake a watch line for the strap named after it', () => {
      // Serica sells both "Parade - Réf. 1174-1" (a watch) and
      // "Bracelet 'Parade' - Noir" (a strap). Only one of them says bracelet.
      expect(isAccessory('Parade - Réf. 1174-1')).toBe(false);
      expect(isAccessory("Bracelet 'Parade' - Noir")).toBe(true);
    });

    it('matches whole words, so a watch is not caught by a fragment', () => {
      // A rule doing a bare substring search would silence these.
      expect(isAccessory('Strapper Chronograph')).toBe(false);
      expect(isAccessory('Capstan Diver')).toBe(false);
      expect(isAccessory('Bracelettino')).toBe(false);
    });
  });

  it('names a product outright rather than adding a risky keyword', () => {
    // "YEMA Cap" is a hat, so `cap` looks like an obvious keyword — until you
    // notice Cap Horn. Naming the exact title catches the hat and costs the
    // watch nothing, which a keyword could not do.
    expect(isAccessory('YEMA Cap')).toBe(true);
    expect(isAccessory('Cap Horn Chronograph')).toBe(false);
  });

  it('gives up rather than guess when a title says nothing', () => {
    // The rule only knows what it has been told. Anything else stays a watch,
    // because wrongly silencing a real release is the worse mistake — it fails
    // the one promise the feed makes (ADR-0006) — and `kind_override` is how
    // the remainder gets fixed.
    expect(isAccessory('Sport - Blanc vanilla')).toBe(false);
    expect(isAccessory('Ajouter pièces')).toBe(false);
  });

  it('leaves out words that appear inside watch listings', () => {
    // Each of these was tried and removed: a store lists a watch on a given
    // bracelet, and "tool watch" is ordinary trade vocabulary. They silenced
    // real watches to catch accessories the nouns already catch.
    expect(isAccessory('Skin Diver CMM.20 NATO')).toBe(false);
    expect(isAccessory('Superman Bronze Mesh')).toBe(false);
    expect(isAccessory('Barrel Roll Chronograph')).toBe(false);
    expect(isAccessory('Field Tool Watch')).toBe(false);
    expect(isAccessory('Steel Band Diver')).toBe(false);
  });

  it('ignores case, accents and padding', () => {
    expect(isAccessory('  BRACELET LÉZARD  ')).toBe(true);
    expect(isAccessory('bracelet lezard')).toBe(true);
  });
});
