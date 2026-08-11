---
name: Crown Watch
description: An independent reference for microbrand watchmaking — paper, ink, one hairline rule, and photographs for colour.
colors:
  paper: "light-dark(#ffffff, #0d0d0d)"
  ink: "light-dark(#0b0b0b, #ededed)"
  muted: "light-dark(#6b6b6b, #9a9a9a)"
  rule: "light-dark(#e3e3e3, #272727)"
  inverse: "light-dark(#ffffff, #0d0d0d)"
  plate: "light-dark(#f4f4f2, #171717)"
  danger: "light-dark(#a4142a, #ff8080)"
typography:
  display:
    fontFamily: "Noto Serif Display, Georgia, Times New Roman, serif"
    fontSize: "clamp(2.5rem, 7vw, 5rem)"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  annotation:
    fontFamily: "Noto Serif Display, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.75rem, 3.6vw, 3.25rem)"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Noto Serif Display, Georgia, Times New Roman, serif"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Noto Serif Display, Georgia, Times New Roman, serif"
    fontSize: "1.5rem"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  price:
    fontFamily: "Golos Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
    fontVariation: "tabular-nums"
  body:
    fontFamily: "Golos Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  fact:
    fontFamily: "Golos Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  micro:
    fontFamily: "Golos Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  none: "0px"
spacing:
  tight: "12px"
  stack: "32px"
  gutter: "24px"
  grid-y: "48px"
  section-gap: "56px"
  section-pad: "40px"
  major-gap: "80px"
components:
  action-fill:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.inverse}"
    typography: "{typography.fact}"
    rounded: "{rounded.none}"
    padding: "10px 20px"
  action-quiet:
    textColor: "{colors.ink}"
    typography: "{typography.fact}"
    rounded: "{rounded.none}"
    padding: "0"
  field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.fact}"
    rounded: "{rounded.none}"
    padding: "8px 0"
  nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.fact}"
    rounded: "{rounded.none}"
  nav-link-hover:
    textColor: "{colors.ink}"
  plate:
    backgroundColor: "{colors.plate}"
    rounded: "{rounded.none}"
    width: "100%"
  curated-mark:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "0.42em"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.fact}"
    rounded: "{rounded.none}"
    padding: "24px"
---

# Design System: Crown Watch

## Overview

**Creative North Star: "The Reference Shelf"**

This is a reference you consult about brands, not a shop that sells them. The
world is paper white, near-black ink, and one hairline rule — the arrangement a
serious reference work has used for a century, taken deliberately rather than
inherited. It was chosen over five invented alternatives with **A Collected Man**
and **Hodinkee** named as the craft bar, and the anti-reference is explicit: the
dark, gold-lit luxury-watch page where atmosphere stands in for having a view.
Nothing here glows. Nothing is dressed up. A page earns attention by saying
something true in a large enough size to be read.

The defining constraint is that there is **no accent colour at all**. Seven
tokens carry the entire system and six of them are neutral; the seventh is an
error red that never decorates anything. Photographs are the only colour on the
page, and they are a brand's own watches, which is the only colour a reference
about watches should be spending. That single refusal does most of the work: with
no brand hue to reach for, hierarchy has to come from size, weight, ground, and
the space around a thing — which is what makes the layout legible rather than
styled.

The surface is flat in the literal sense: every computed `border-radius` in the
app is `0px` and every computed `box-shadow` is `none`, including the one
overlay. An object is separated from the page by a hairline rule, by a change of
ground, or by nothing at all. Two faces divide the labour honestly — a light
high-contrast serif for the two things a person actually wrote (a Brand's name
and the judgement about it), and a neutral grotesque for every fact the machines
gathered. A reader can tell opinion from data without being told which is which.

**Key Characteristics:**
- Paper-white ground, near-black ink, one hairline rule (19.68:1 on paper)
- No accent colour; photographs supply all colour on the page
- Zero radius, zero shadow, everywhere, in both themes
- Serif for authored prose, grotesque for gathered fact
- Light is the considered palette; dark is re-derived, not inverted
- Filled elements are rare and earned; links are underlines
- Empty states are plain sentences, never dashed placeholder boxes

## Colors

Six neutrals and one error red, declared once as `light-dark()` pairs and
indirected through seven `--cw-*` custom properties so a theme swaps the whole
palette at the root.

### Primary

There is no primary accent, and its absence is the system's defining rule. Where
another site would place a brand hue, this one places ink, a rule, or a
photograph.

### Neutral

- **Paper** — the page ground. White on light, a near-black that is deliberately
  *not* pure black on dark, so the plate has somewhere to lighten to.
- **Ink** — all body text, every heading, filled buttons, the focus outline, the
  Curated mark, and the `::selection` background. 19.68:1 against paper.
- **Muted** — facts, captions, provenance lines, inactive navigation, and the
  supporting sentence under a heading. 5.33:1 against paper: quiet, still legible
  at 0.75rem.
- **Rule** — every hairline: section separators, card underlines, the field
  underline at rest, and link `text-decoration-color` before hover.
- **Inverse** — text on an ink fill. Equal to paper in both themes; it exists as
  its own token so a fill never has to name the page's colour.
- **Plate** — the ground a photograph is mounted on, a hair off paper. Store
  images arrive as everything from a white packshot to a wrist shot, and a plate
  that is exactly the page leaves a packshot floating with no edge at all. On
  dark it lightens *away* from the page rather than darkening, so the photograph
  still reads as mounted.

### Tertiary

- **Danger** — error text under a form field, and nothing else. It is the only
  hue in the system and it is never a brand colour, never a badge, never a
  decoration.

### Named Rules

**The Seven Tokens Rule.** Every colour in the app comes from one of seven
`--cw-*` tokens. No component carries a hex value and no component carries a
`dark:` variant — the theme is resolved once at the root by `light-dark()`, so a
component written correctly is already correct in both worlds.

**The No Accent Rule.** There is no accent colour. Photographs are the only
colour on the page. If a new surface needs emphasis, it gets size, ink, a rule,
or a fill — never a hue.

**The Considered Light Rule.** Light is the designed palette; dark is re-derived
from it, not inverted. Two values are re-thought rather than flipped: the display
weight steps 300 → 400 (`--dark-display-weight`), because a light serif that is
elegant on paper turns to wire on black; and the plate lightens away from the
page instead of darkening.

**The Danger-Is-Not-Decoration Rule.** The one non-neutral token is reserved for
errors. A status, a badge, a category, or a call to action never reaches for it.

## Typography

**Display Font:** Noto Serif Display (300, 400) — fallback Georgia, Times New
Roman, serif
**Body Font:** Golos Text (400, 500) — fallback ui-sans-serif, system-ui,
sans-serif

Both faces ship `latin` **and** `cyrillic` subsets. That is a requirement, not a
bonus: Ukrainian is coming to the site, and a display face that cannot set a
Brand's name in Ukrainian would have to be replaced the week that lands.

**Character:** A high-contrast editorial serif set light and tight against a
plain, wide-aperture grotesque. The serif reads as a person speaking; the
grotesque reads as a record. There is no third voice, no mono, and no uppercase
letterspaced label anywhere in the system.

### Hierarchy

- **Display** (300 light / 400 dark, `clamp(2.5rem, 7vw, 5rem)`, 1.06,
  -0.02em): a Brand's name on its own page. Measured at 80px at full width.
- **Annotation** (300/400, `clamp(1.75rem, 3.6vw, 3.25rem)`, 1.06, -0.02em): the
  judgement, and the largest prose a Curated Brand page carries.
- **Headline** (300/400, `clamp(2rem, 5vw, 3.5rem)`; the homepage runs
  `clamp(2.5rem, 6.5vw, 4.5rem)`): the h1 of every page that is not a Brand.
- **Title** (300/400, 1.5rem, 1.06): every section h2 — "What it costs", "What
  {brand} makes", "Recent drops". Always sits directly under a hairline rule.
- **Price** (500, 1.875rem → 2.25rem at `sm`, tabular figures): the price band on
  a Brand page. The only place the grotesque is set large, because a number is a
  gathered fact and must not borrow the serif's authority.
- **Body** (400, 1rem, 1.625): supporting prose and empty states. Capped at
  30–36rem, which measures 55–69ch.
- **Fact** (400, 0.875rem, muted): the facts line under a Brand name, card
  titles, prices in cards, navigation, footer.
- **Micro** (400, 0.75rem, muted): figure captions, source attributions, variant
  counts, stock state.

### Named Rules

**The Two Voices Rule.** The serif carries only what a person wrote — a Brand's
name and the judgement. Everything gathered by a machine is set in the grotesque.
A price, a country, a founding year, or a drop title in the serif is a category
error.

**The Unlabelled Annotation Rule.** The Annotation is rendered exactly as
written: never truncated, never line-clamped, never faded at the bottom, never
appended to. It carries no heading above it — the sentence is the largest prose
on the page and the small line beneath it says who wrote it, which is more than a
label would. An Annotation that says the lume is poor has to be able to say the
lume is poor.

**The Cyrillic Rule.** Both faces carry Cyrillic and no layout may depend on
English string lengths. Cyrillic runs roughly a third longer; headings wrap,
buttons grow, and nothing is sized to a specific English word.

**The No Eyebrow Rule.** There are no uppercase letterspaced kickers, eyebrows,
or all-caps labels in this system. A section is announced by a rule and a serif
h2, and by nothing else.

## Layout

One centred column, `max-w-6xl` (72rem) with a 24px gutter (`px-6`), used by the
homepage, the drops index, and the Brand page. A single Watch page narrows to
`max-w-4xl` (56rem), because its subject is one photograph and one list.

**Section rhythm.** Every major section on a content page is separated the same
way: `mt-14` (56px) + `border-t border-rule` + `pt-10` (40px). The homepage's
top-level sections run one step wider (`mt-20` + rule + `pt-14`). A heading
always sits immediately below its rule; the rule is what announces the section.

**Grids.** Drop cards run 1 / 2 / 3 columns with a 24px x-gutter and a 48px
y-gutter — the gutters do the separating that a border used to, which is what
lets photographs sit next to each other without forty rectangles competing with
them. Watch cards run 2 / 3 / 4 with a 40px y-gutter. The brand directory runs
1 / 2 / 3 with a wide 40px x-gutter, each row underlined rather than boxed.

**Breakpoints.** Tailwind defaults, and only two are used in layout: `sm` (640px)
and `lg` (1024px). `md` (768px) appears only in image `sizes` hints.

**Aspect ratios.** Every photograph declares one: 3:2 for the Brand lead (the
figure column measures 768×540, image plus a 12px caption), 4:3 for the Watch
page lead, 16:10 for a drop card, 1:1 for a watch card, and a 56px square for an
accessory thumbnail.

**Header and footer.** The header is a single 20px-tall padded row with the
wordmark in the serif at 1.25rem and the nav at `fact` size, closed by a hairline.
The footer sits 96px below the content on a `2fr 1fr 1fr` grid at `sm` and up.

**No horizontal overflow** at 375px or 1024px. The lead figure is a column and not
a full-width banner on purpose: at container width any honest ratio is 600–700px
tall, which is a masthead rather than a photograph, and a height clamp cannot
rescue it because an aspect-ratio box answers a height limit by narrowing.

### Named Rules

**The Section Rhythm Rule.** New sections use `mt-14` + `border-t border-rule` +
`pt-10`. Do not invent a second separator style; the hairline above a serif h2 is
the only section boundary this world has.

**The Measure Rule.** Prose is capped at 30–36rem (55–69ch). Nothing in this
system runs the full 72rem as a paragraph.

**The Laid Out Twice Rule.** The navigation is composed twice — a desktop row and
a named `Menu` panel below `sm` — rather than shrunk to fit. Shaving gaps until a
row *almost* fits is how a header ends up with its last control off-screen.

## Elevation & Depth

There is no elevation in this system. Every computed `border-radius` in the app
is `0px` and every computed `box-shadow` is `none` — in both themes, on every
surface, including the one modal overlay. There is no shadow vocabulary to
document because there are no shadows.

Depth is conveyed three ways and only three ways: a **hairline rule**
(`--cw-rule`, 1px) where two regions must be told apart; a **change of ground**
(`--cw-plate`, a hair off paper) where a photograph is mounted; and **nothing at
all** where a grid gutter already does the separating. The release-note dialog —
the one surface that genuinely floats — is handled with a `bg-ink/60` scrim and a
1px `border-ink` panel on paper. That is the house treatment for an overlay.

### Named Rules

**The Flat World Rule.** No `box-shadow`, no `drop-shadow`, no `filter: blur()`
on a surface, ever. If a new element needs to be told apart from the page, use a
rule, a plate, or space.

**The Three Separators Rule.** A hairline, a change of ground, or nothing at all.
An element that needs a fourth kind of separation is an element in the wrong
place.

## Shapes

Square, everywhere, enforced globally by `* { border-radius: 0 }`. Buttons,
plates, dialogs, thumbnails, inputs, and the Curated mark are all right-angled
rectangles. There is no rounded corner in the system to reach for.

Borders are always 1px and always `--cw-rule` at rest, promoted to `--cw-ink`
where something is active, focused, or complete: a field underline on focus, a
dialog panel edge, the rule above a success message.

**Links are underlines, not shapes.** The standing link form is
`text-decoration: underline` with a 4px offset and `text-decoration-color:
var(--color-rule)`, darkening to ink on hover. Cards use `group-hover:underline`
on their title rather than a border or a background change, so the photograph
stays the loudest thing in a grid.

The one drawn glyph in the whole system is the **Curated mark**: a filled ink
square of `0.42em`, aligned to the cap height of the name beside it. It is not a
badge, not a pill, and not a colour; its meaning is stated once in the
directory's legend.

## Components

### Buttons

- **Shape:** square (0px), no border.
- **Fill (primary):** ink ground, inverse text, 20px × 10px padding, `fact` size,
  regular weight, sentence case. Used in exactly three places — the homepage
  "Browse the brands", the digest submit, and a store purchase link.
- **Hover / Focus:** hover drops opacity to 0.8 with a transition; disabled sits
  at 0.5. Focus is the global 2px ink outline at 2px offset. No transform, no
  shadow, no colour change.
- **Quiet (default):** a text link with a rule-coloured underline at 4px offset,
  darkening to ink on hover. This — not a fill — is what a call to action looks
  like by default, including the header's "Get the digest".
- **Muted text control:** navigation items, the mobile `Menu` toggle, and the
  dialog's "Maybe later" are plain muted text that goes to ink on hover.

### Inputs / Fields

- **Style:** a rule under the input and nothing around it — transparent ground,
  `border-bottom: 1px solid var(--color-rule)`, 8px vertical padding, no radius,
  no box. A bordered box would be the only box on the page.
- **Focus:** the underline goes to ink, plus the global outline. Nothing grows,
  glows, or shifts.
- **Placeholder:** muted.
- **Error:** a `danger` sentence below the form at `fact` size. Fields are not
  recoloured.
- **Labels** sit above the field in muted `fact` size; a required marker is an
  ink asterisk. `select` and `textarea` take the identical treatment.

### Cards / Containers

There are no cards. A "card" in this system is a plate followed by text, with the
grid gutter doing the separating.

- **Drop card:** 16:10 plate, then a muted micro line (brand · type · when), the
  title at body size, and a baseline-aligned row holding the price and a purchase
  tag pushed to the bottom of the cell. Title underlines on group hover.
- **Watch card:** 1:1 plate, name at `fact` size, price in tabular figures, and
  an optional micro line for option count and stock state.
- **Brand row:** typographic, not pictorial — an optional Curated mark, the name
  in the serif at 1.125rem, a muted facts line, closed by a bottom hairline. A
  Listed Brand gets no mark rather than a "not reviewed" label: it is not a lesser
  tier, and marking the absence would read as a warning about the brand.
- **Internal padding:** none. Containers do not exist; spacing is vertical rhythm.

### Navigation

- **Desktop:** a single row of muted `fact`-size links at 28px gaps, going to ink
  on hover, ending with an underlined "Get the digest" text link and the theme
  switch.
- **Mobile:** everything collapses behind a word — `Menu` / `Close` — rather than
  a hamburger, because this world draws no icon it does not need. The panel is
  full-bleed paper, closed by a hairline, at 1.125rem.
- **Icons** appear only where a word cannot do the job: the Telegram mark, the
  three theme glyphs, and the dialog close. All are 1.6px-stroke inline SVG at
  14–16px, drawn in `currentColor`.

### Plate (signature component)

Every image on the site goes through one component, and that is the point. The
sources are brands' own stores and publishers' article images, arriving as
everything from a white packshot to a wrist shot on a beach; on a world with no
card, no border and no radius to hide behind, an unnormalised grid is the failure
mode.

- **Ground:** `--cw-plate`, a hair off paper.
- **Fit:** `object-fit: contain` by default — every grid on the site. A packshot
  cropped to fill loses the watch; a wide shot letterboxed on the plate loses
  nothing.
- **`cover` is opt-in and used in exactly one place**, the Brand page's lead,
  where letterboxing would fill the first viewport with plate instead of subject.
- **Caption:** a lead photograph is wrapped in a `<figure>` with a muted micro
  `<figcaption>` reading "From {brand}'s own store." — provenance at the image,
  where a reference work puts it, and phrased so it never claims a photographer.
- **Failure:** a missing or blocked image renders the bare plate. An empty frame
  is honest, and publisher CDNs do block hotlinks.

### Release-note dialog

The only floating surface. A `bg-ink/60` scrim, a paper panel with a 1px ink
border, no radius and no shadow, capped at 32rem and bottom-anchored below `sm`.
Its head is separated by a hairline, its list rows by `divide-y divide-rule`, and
its channel links are hairline-bordered rows that go to an ink border on hover.

### Theme switch

Three 16px glyph buttons — light, dark, system — with `aria-pressed`. Active is
ink; inactive is muted going to ink on hover. No track, no pill, no fill.

### Named Rules

**The Earned Fill Rule.** A filled ink rectangle is used only where the action is
that section's own subject: the digest form's submit, a store purchase link, the
homepage's one route into the catalogue. The header CTA is a text link, because a
black rectangle there would be the loudest object in every first viewport on the
site — outranking, on a Brand page, the brand's own name.

**The Normalised Photograph Rule.** Every image goes through `Plate`. `contain`
in grids; `cover` only on a lead photograph. Every lead carries a `<figcaption>`
naming whose photograph it is.

**The Plain Empty State Rule.** An empty state is a sentence in muted body prose
that says what is missing and why. No dashed box, no placeholder graphic, no
illustration, no icon.

**The One Focus Rule.** One focus treatment for the whole site: a 2px solid ink
outline at 2px offset on every link, button, input, select and textarea. It is
visible on both grounds and is never removed for a custom ring.

## Do's and Don'ts

### Do:
- **Do** read every colour from the seven `--cw-*` tokens; a component written
  correctly needs no `dark:` variant.
- **Do** set a Brand's name and the judgement in the display serif, and every
  gathered fact in Golos Text.
- **Do** separate sections with `mt-14` + `border-t border-rule` + `pt-10`, and
  put the serif h2 immediately under the rule.
- **Do** cap prose at 30–36rem (55–69ch).
- **Do** route every image through `Plate`, `contain` by default, and caption a
  lead with "From {brand}'s own store."
- **Do** write empty states as plain sentences that admit what is missing.
- **Do** state a Listed Brand's absence at the size of every other fact, and lead
  its page with the photograph instead.
- **Do** compose a responsive layout twice when one arrangement cannot serve both
  375px and desktop.
- **Do** let both faces' Cyrillic carry the layout — size nothing to an English
  word.

### Don't:
- **Don't** introduce an accent colour, a brand hue, or a coloured badge.
  Photographs are the only colour on this page.
- **Don't** add a `border-radius` or a `box-shadow` to anything, including
  overlays. Use a hairline, a plate, or space.
- **Don't** truncate, line-clamp, fade, or append to an Annotation, and don't put
  a label above it.
- **Don't** put a filled ink button anywhere the action is not that section's own
  subject — the header CTA stays a text link.
- **Don't** crop a grid image with `cover`; `cover` belongs to the Brand lead
  alone.
- **Don't** wrap a field in a box. A rule under the input is the whole field.
- **Don't** use uppercase letterspaced kickers, eyebrows, or all-caps labels.
- **Don't** draw an icon where a word will do — the mobile menu says `Menu`.
- **Don't** style a Listed Brand as an error, a warning, or a missing Curated one.
- **Don't** use `--cw-danger` for anything but error text.
- **Don't** replace an empty state with a dashed placeholder box or an
  illustration.
