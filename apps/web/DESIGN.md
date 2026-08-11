---
name: Crown Watch
description: Microbrand watch drop & waitlist radar — an independent catalogue with an opinion
colors:
  night: "light-dark(#f5f2ec, #101014)"
  panel: "light-dark(#fbf9f6, #17171c)"
  panel-2: "light-dark(#ffffff, #1e1e24)"
  line: "light-dark(#e0d9cc, #26262e)"
  ink: "light-dark(#22201b, #ece9e2)"
  faint: "light-dark(#5f5a50, #918e86)"
  gold: "light-dark(#7d5f27, #c9a96a)"
  gold-bright: "light-dark(#5f4718, #e0c690)"
  on-gold: "light-dark(#fffcf5, #101014)"
  scrim: "#101014"
typography:
  display:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.2em"
rounded:
  pill: "9999px"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
spacing:
  section-gap: "3.5rem"
  section-rule: "2.5rem"
  card-pad: "1rem"
  gutter: "1.5rem"
  container: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.25rem"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.gold-bright}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.gold}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.25rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card-pad}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1rem"
  input-in-panel:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1rem"
  input-label:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
    typography: "{typography.title}"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1.25rem 1.5rem"
  chip-curated:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
  chip-listed:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
---

# Design System: Crown Watch

## Overview

**Creative North Star: "The Auction House Catalogue"**

An independent specialist's catalogue, not a shop. Warm ground, gilt marking what
matters, sparse type, and a written opinion set under each lot. The system's whole
job is to make one honest sentence about a brand feel like the most valuable thing
on the page — because it is. Everything else is furniture arranged so the reader
reaches that sentence and believes it.

The atmosphere is **warm, exacting, unhurried**. Nothing here is cold: both
palettes refuse pure black and pure white, and the neutrals carry a paper warmth
that keeps a dense catalogue from reading as a database. Precision lives in the
spacing and the type rather than in ornament — sections are separated by a single
hairline rule and a generous run of air, never by a box, a shadow, or a color
block. Nothing is rushed: no countdown, no urgency, no motion that isn't a
response to the reader's own cursor.

The dark palette is the considered one, and light is not its inversion. A
champagne accent on paper reads at about 1.9:1 and disappears, so gold becomes an
antique bronze at 5.31:1 rather than dimming into decoration. This is the system's
governing habit: when a theme flips, roles are re-derived, never mirrored.

**Key Characteristics:**
- Nine indirected color tokens; not one hex value or `dark:` variant in any component
- Depth drawn in line and tone — the only shadow in the interface is on the overlay layer
- A serif display voice (Fraunces) against a neutral sans body (Instrument Sans)
- Gold is scarce and structural: state, judgement, and action, nothing else
- Generated per-brand art instead of borrowed logos or publishers' photography
- Absence stated in prose, never rendered as a placeholder or a warning

## Colors

A warm two-mode palette of nine tokens: three stacked surfaces, one hairline, two
text weights, and a single accent that changes metal between themes.

### Primary

- **Champagne & Bronze** — the one accent, and it has two faces. **Champagne Gold**
  (`#c9a96a`) on dark reads as the warm yellow of a case back; **Antique Bronze**
  (`#7d5f27`) on paper is the same metal in different light, chosen for legibility
  (5.31:1) rather than mood. It marks exactly four things: the wordmark's first
  word, an approved judgement, a state worth trusting (Curated), and the action a
  reader can take. **Gold Bright** (`#e0c690` dark / `#5f4718` light) is its hover
  and its emphasis — never a second accent.
- **On Gold** (`#101014` dark / `#fffcf5` light) — text sitting *on* a gold fill.
  Deliberately its own token rather than the page color it happened to match while
  the site was dark-only; reusing the page color here is exactly what makes an
  inverted palette illegible.

### Neutral

- **Night** (`#101014` dark / `#f5f2ec` light) — the page ground. Layered warm
  charcoal, never true black; warm paper, never white.
- **Panel** (`#17171c` / `#fbf9f6`) — the resting surface for every card, the
  digest block, and search fields. One step from the ground, no more.
- **Panel Two** (`#1e1e24` / `#ffffff`) — the innermost layer: image wells behind
  photography, the active theme-switch key.
- **Line** (`#26262e` / `#e0d9cc`) — the hairline that does the work shadows would
  do elsewhere. Usually at 70–80% opacity so it separates without drawing.
- **Ink** (`#ece9e2` / `#22201b`) — body and heading text. Warm off-white on dark,
  warm near-black on paper.
- **Faint** (`#918e86` / `#5f5a50`) — metadata, provenance, timestamps, and every
  honest admission of absence. The second voice, not a disabled state.
- **Scrim** (`#101014`, fixed) — backdrops and badges over photography. Dark in
  *both* themes on purpose: a scrim exists to sink what is behind it, and a light
  scrim over a light page does nothing.

### Tertiary

Four muted signal hues carry Drop type only — emerald (Kickstarter), sky
(Waitlist open), amber (Restock), and gold itself (Pre-order) — always as a
10%-fill / 25%-ring pair, never as a solid. They are a taxonomy, not a palette.

### Named Rules

**The Nine Token Rule.** Every color in the app resolves through `--cw-*`. A
component that carries a hex value, or a `dark:` variant, is a defect — a palette
change must be one file and nothing else.

**The Scarce Metal Rule.** Gold marks judgement, approved state, and action.
It never becomes a background wash, a heading color for ordinary headings, or a
decorative rule. Its rarity is what makes an Annotation look like the point.

**The Re-derive, Never Mirror Rule.** A light palette is not a dark one inverted.
When a token changes theme, its *role* is re-satisfied — contrast, warmth, and
legibility measured again — not its value flipped.

## Typography

**Display Font:** Fraunces (with Georgia, "Times New Roman", serif)
**Body Font:** Instrument Sans (with ui-sans-serif, system-ui, sans-serif)

**Character:** A soft-edged, slightly old-style serif doing the talking, against a
neutral grotesque doing the recording. The serif is reserved for what a person
wrote or named — the judgement, the brand, the price, the section that begins an
argument. The sans handles everything a machine gathered. You can tell who is
speaking by the shape of the letters, which is the entire point of the pairing.

### Hierarchy

- **Display** (Fraunces 500, `clamp(2.25rem, 5vw, 3.75rem)`, 1.08, `-0.025em`):
  the homepage proposition and brand names. One per page.
- **Headline** (Fraunces 400, 1.5rem, `-0.025em`): section titles that open an
  argument — "What YEMA makes", "Recent drops".
- **Annotation** (Fraunces 500, 1.5rem → 1.875rem, 1.375, `-0.025em`): the
  judgement itself, and the largest prose on any Brand page. Also the price band.
- **Title** (Instrument Sans 500, 1rem, 1.375): card titles and Drop headlines.
- **Body** (Instrument Sans 400, 1.125rem, 1.625, `text-faint`): explanatory prose,
  capped at `max-w-2xl`/`max-w-3xl` (~65–75ch).
- **Label** (Instrument Sans 500, 0.75rem, `0.2em` tracking, uppercase): the
  catalogue's lot markers — "OUR TAKE", "WHAT IT COSTS", brand names on cards
  (`0.18em`), the eyebrow above the homepage headline (`0.3em`).

### Named Rules

**The Two Voices Rule.** Serif for what a person judged or named; sans for what
was gathered. A machine-extracted fact never sets in Fraunces, and the Annotation
never sets in Instrument Sans.

**The Unabridged Judgement Rule.** The Annotation renders exactly as written — no
truncation, no line clamp, no fade, nothing appended. An Annotation that says the
lume is poor has to say the lume is poor, in full, or the whole exercise is
marketing. `break-words` is permitted solely so a long token cannot push the page
sideways.

**The Uppercase Label Rule.** All-caps appears only at label size with ≥`0.18em`
tracking. Never on a heading, never on a button, never on a brand's own name in
running text.

## Layout

A single centered column, `max-w-6xl` (72rem) with a 1.5rem gutter that never
changes across breakpoints — the container narrows, the padding doesn't.

**Section rhythm** is the page's structural grammar: `mt-14` of air, a `border-t`
hairline at 70% opacity, then `pt-10` before the heading. Repeated identically
down every page, so a reader learns where a new argument begins without a box
being drawn around it. The homepage hero sits above the first rule with `py-16`
(`sm:py-20`).

**Grids** step by content weight, not by a single system: Drop cards 1 → 2 → 3
(`gap-5`), brand cards 1 → 2 → 3 (`gap-3.5`), Watch cards **2** → 3 → 4
(`gap-4`) — the only grid that stays two-up on the smallest screen, because a
watch is recognisable at thumbnail size and a single-column catalogue reads as a
list of links.

**Breakpoints** are Tailwind defaults; only `sm` (640px) and `lg` (1024px) are
used. Both mobile and desktop are primary scenes — the header sheds labels rather
than wrapping (`Get the digest` → `Digest`, Telegram to icon-only, Submit hidden),
and the Brand hero's avatar and negative-margin overlap scale rather than restack.

## Elevation & Depth

**No shadows on the page.** Not "few" — no surface in the document flow casts
one. Depth is drawn, not lit: three stacked surface tones (night → panel →
panel-2) and a 1px hairline are the entire vocabulary. This is a catalogue
printed on paper, where an object is separated from its ground by a rule and a
change of stock.

Two things that look like exceptions are not. The `box-shadow: inset` ring on the
brand lettermark is a drawn edge rather than a cast shadow, and the `ring-*`
utilities are visible 1px strokes on badges and the avatar's cutout.

**The one real exception is the overlay layer.** A dialog leaves the page's
plane, so it is allowed the full lighting treatment: a `scrim/80` backdrop with
`backdrop-blur-sm` beneath it and `shadow-2xl` on the panel itself. This is the
only `box-shadow` in the interface, and it is licensed by leaving the document
flow — not by being important.

**Elevation is an event, not a property.** The only lift in the page system is
`hover:-translate-y-0.5` (2px) paired with the border warming from `line` to
`gold/40`, over 300ms. A surface at rest is flat by definition.

### Named Rules

**The Drawn Depth Rule.** Separate surfaces in the page with tone and a hairline.
Reaching for a `box-shadow` on anything that scrolls with the document means the
tonal stack was not used properly.

**The Leaving-The-Plane Rule.** Shadow is the privilege of a layer that floats
over the page, and nothing else earns it. A dialog gets scrim, blur, and
`shadow-2xl`; a card that happens to matter does not.

**The Lift-On-Approach Rule.** 2px and a warmed border, 300ms, and nothing else.
No scale, no shadow bloom, no color fill on hover of a card.

## Shapes

Rounded, generous, and consistent by role rather than by size. Cards and empty
states take `rounded-2xl` (1rem); buttons, inputs, and small tiles `rounded-xl`
(0.75rem); thumbnails `rounded-lg` (0.5rem); every badge, chip, pill, and the
theme switch take a full pill (`9999px`). Brand lettermarks are circles.

Borders are always 1px and usually translucent (`border-line/70`, `/80`). The
recurring silhouette is **a soft rectangle opened by a full-bleed image well at
its top edge** — Drop cards at 16:10, Watch cards at 1:1, brand cards with a 3.5rem
generated banner. Media meets the card's own corner radius with no inset frame.

Empty states use a **dashed** border of the same hairline color — the one place
the stroke changes character, marking "nothing here yet" without a color or an
icon.

## Components

### Buttons

- **Shape:** softly rounded (`rounded-xl`, 0.75rem); pill only at chip scale.
- **Primary:** gold fill with `on-gold` text, `0.625rem 1.25rem`, 500 weight.
  Reserved for the single action a screen wants — join the digest, buy from the
  brand. Hover deepens the fill to `gold-bright`.
- **Ghost:** a `gold/40` hairline with gold text on no fill, same metrics. For an
  honest but weaker action — a brand-site link where the reader still has to find
  the watch when they arrive. Hover brings the border to full gold.
- **Quiet:** a `line` hairline with `faint` text, for the secondary path out of a
  hero. Hover warms the border to `gold/50` and the text to `ink`.
- **Focus:** `focus-visible:outline-2 outline-offset-2 outline-gold`.

### Chips

- **Drop type:** a 10% tint, a 25% ring, and text in the same hue, at
  `text-[11px]` with a pill radius. Four hues carry the taxonomy; anything unknown
  falls back to `panel-2` / `faint` / `line` rather than picking a color.
- **Curated:** `gold/10` fill, `gold/25` ring, gold text. The only badge granted
  the accent.
- **Listed:** a plain `line` border with `faint` text on the Brand page — and
  **nothing at all** on a directory card. Absence of a badge is the design.
- **Facts** (country, founded, tally): identical `line`-bordered pills, so a fact
  never outranks a state.

### Cards / Containers

- **Corner Style:** `rounded-2xl` (1rem), overflow hidden so media meets the corner.
- **Background:** `panel`, on the `night` ground, with the image well in `panel-2`.
- **Shadow Strategy:** none. See Elevation & Depth.
- **Border:** 1px `line` at 70–80%, warming to `gold/40` on hover.
- **Internal Padding:** 1rem (`p-4`) on Drop cards, 0.75rem on the denser Watch grid.

### Inputs / Fields

- **Style:** one shared field treatment for every control — text, url, search,
  select, textarea, password. 1px `line` border, `rounded-xl`, `0.625rem 1rem`,
  placeholder at `faint/60`. The ground is `panel` on the page and `night` inside
  a panel block, so a field always sits one step *below* what contains it.
- **Label:** `text-sm` `faint` above the field with `mb-1.5`, inside a `<label>`
  wrapper. Required is marked by a single gold asterisk and nothing else — no
  "(required)", no red.
- **Focus:** the border warms to `gold/60`. `outline: none` is replaced by that
  border shift, never simply removed.
- **Success:** an emerald block **replaces** the form, with its heading in
  Fraunces and a way back ("Submit another drop") rather than a dead end.
- **Error:** red text beside or below the control; the form stays filled, mounted,
  and usable.

### Dialog / Overlay

The one layer permitted to leave the page's plane. A `scrim/80` backdrop with
`backdrop-blur-sm`, and a `rounded-2xl` `panel` card with a `line` border and
`shadow-2xl`. Structure is three bands separated by the same hairline the page
uses: a header (gold `0.16em` label, Fraunces title, `faint` standfirst), a
`divide-y divide-line/50` list, and an action stack of ghost buttons.

Bottom-sheet on small screens (`items-end`), centered from `sm` up. Dismissal is
offered three ways — the corner control, Escape, and the backdrop — and the
"maybe later" path is a full-width `faint` text button, never a styled competitor
to the action above it.

### Moderation Queue (internal)

The admin surface deliberately invents no vocabulary of its own: it reuses the
Drop card, the type chip, the shared field, and the same empty state. It adds
exactly two things — a decision border (`emerald-400/50` approved,
`red-400/40` plus 60% opacity rejected) and a confidence badge on `scrim/80` over
the image. An internal tool built from the public system stays honest about what
the public system can express.

### Navigation

Sans, `text-sm`, `faint` at rest, `ink` on hover, no underline and no active
treatment — the header is a set of exits, not a location indicator. The digest CTA
is the only bordered element in the bar. The wordmark sets in Fraunces with
"Crown" in gold and "Watch" in ink. Below `sm`, labels shorten rather than wrap.

### Brand Art (signature)

With no logos in the data and no right to decorate with a publisher's photograph,
every Brand generates its own art from its slug: a three-layer banner (an
off-center radial glow, a repeating 1px pinstripe, and a diagonal base gradient)
plus a circular lettermark of up to two initials in Fraunces, tinted to the same
hue and cut into the banner with a ring in the surface color. Hue comes from the
slug; lightness and saturation come from the theme, so a band that reads deep and
saturated in dark becomes a pale tint in light rather than a hole punched in the
card. Both are `aria-hidden` — they carry nothing a screen reader needs.

### The Annotation Block (signature)

The reason the rest of the system is quiet. A `0.2em` uppercase gold label reading
"Our take", then the judgement in Fraunces at 1.5–1.875rem on `max-w-3xl`, then a
`faint` line of provenance: written and approved by a person, and unpurchasable.
When no Annotation exists, the same block appears with a `faint` label and prose
admitting it in plain words — never a skeleton, a placeholder, or a warning color.

## Do's and Don'ts

### Do:
- **Do** resolve every color through the nine `--cw-*` tokens, and add a token to
  `globals.css` rather than a hex to a component.
- **Do** separate sections with `mt-14`, a `border-t border-line/70`, and `pt-10`.
  It is the page's grammar; a new section that skips it reads as part of the last.
- **Do** set anything a person wrote or named in Fraunces, and anything gathered
  in Instrument Sans.
- **Do** state absence in a full sentence, in `faint`, in the place the content
  would have been — "we just have nothing considered to say about the brand
  itself, and would rather admit that than pad it".
- **Do** keep uppercase to label size with ≥`0.18em` tracking.
- **Do** pair every hover with the same 300ms transition and, on cards, the same
  2px lift and gold-warmed border.
- **Do** give any new interactive element a `focus-visible` outline in gold.
- **Do** replace a form with its success state and leave a way back; keep an error
  beside a form that stays filled and mounted.
- **Do** build internal tools out of the public primitives, as the moderation
  queue does.
- **Do** leave room for Ukrainian: no layout may depend on an English string's
  length, and the header's shed-labels-before-wrapping habit is the pattern.

### Don't:
- **Don't** add a `box-shadow` to anything that scrolls with the document. Depth is
  tone and a hairline; shadow belongs to the overlay layer alone.
- **Don't** spend gold on anything but judgement, approved state, or action — no
  gold headings, gold rules, or gold backgrounds.
- **Don't** truncate, clamp, fade, or append to an Annotation.
- **Don't** badge a Listed Brand on a directory card. Absence is deliberate; a grey
  "unreviewed" chip would read as a warning about the brand rather than about us.
- **Don't** introduce marketplace chrome: star ratings, urgency badges, countdown
  timers, "only 2 left", sale ribbons, or strike-through pricing. Nothing here is
  being sold.
- **Don't** introduce dark-SaaS neon: gradients as decoration, glassmorphism,
  glow, or any synthetic hue. The dark palette is warm and material.
- **Don't** render a metric, counter, or stat tile. The product forbids the numbers;
  the visual system must not build furniture that invites them back.
- **Don't** decorate a Brand with a publisher's photograph or a scraped logo. Brand
  art is generated, and attribution links out.
- **Don't** write a `dark:` variant. The palette switches beneath the component.
