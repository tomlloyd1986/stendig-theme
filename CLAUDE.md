# Stendig theme

The Shopify storefront theme for stendigcalendars.com. Liquid, plain CSS
and plain JS; no build step.

## Branches — the rule

**Work goes to `staging` first. `main` is the live storefront.** Develop on
`staging` (or a branch off it), and `main` receives it through a pull
request when the owner says it is ready — never by a direct push. The
owner's instruction, 8 Sep 2026, after four changes went straight to
`main` in one day: it was fine in the instance and it is not the practice.

Both branches are Shopify themes. The Shopify GitHub integration commits
theme-editor edits back to whichever branch that theme is connected to
("Update from Shopify for theme stendig-theme/<branch>"), so:

- `git fetch` before every push; the branch has usually moved.
- Squash-merges leave `staging` reading as "ahead" by commits whose content
  is already on `main`. `git cherry origin/main origin/staging` tells the
  two apart: a `-` is content `main` already has.
- Template JSON (`templates/*.json`, `config/settings_data.json`) is content
  the owner edits in the theme editor. In a conflict, the side with the
  newer editor commit is the owner's current intent; do not "fix" it from
  the other side.

## Verification

There is no test runner. A change is proved by a spike in `docs/spikes/`,
one file per finding, run with `node docs/spikes/<name>.mjs` after
`npm i --no-save liquidjs playwright jsdom` (never commit `node_modules`).
Two kinds, and the file says which:

- **Liquid under liquidjs** proves branching and markup, not Shopify's
  objects. Shopify's globals (`localization`, `settings`, `shop`) are visible
  inside `{% render %}`; liquidjs's render is scope-isolated, so a harness
  passes them as `globals` when constructing the engine. `{% form %}` and
  `{% style %}` are Shopify's and need a stub tag.
- **Chromium** (`/opt/pw-browsers/chromium` as `executablePath`; never run
  `playwright install`) proves the built thing: measure with
  `getBoundingClientRect()`, never read a stylesheet back and believe it.
  The theme's base colours (`--color-base-text` and kin) are set in
  `layout/theme.liquid`, and base.css derives `--color-foreground` FROM
  them — a harness page must set the base value or every
  `rgba(var(--color-foreground), …)` is invalid and renders black.

A spike must fail on the code as it stood, in the words of the reported
symptom, before it is trusted to pass on the fix. Run every spike before
pushing: a header change reaches more than the header.

## Things that have cost a day

- **A fixed drawer cannot live inside the header section.** The sticky
  header hides itself with a transform, and a transform makes its
  subtree's `position: fixed` mean "fixed to the section" — the parked
  drawer becomes horizontal page scroll. The cart drawer and the location
  picker both render from `layout/theme.liquid`; the header renders only
  their triggers.
- **A market is resolved from the subfolder suffix, not the market**
  (`/en-de` → `de`, `/fr-ch` → `ch`, the bare domain → `main`), through
  `snippets/market-context.liquid`. Ask it; do not re-derive it.
- **The stored delivery-date value stays English** (`7 Dec`, `ASAP`,
  `By Xmas`) whatever language the customer bought in; the display label
  may differ. It is the `Delivery Date` line-item property, and the 3PL's
  paperwork keys off the exact string.
- **A `<button>` with no `color` of its own is blue on iOS.** State the
  ink on anything that paints its own background.
- **Filters are forbidden inside `{% if %}`**; assign first, then test.
- The theme's content is localised by language in Translate & Adapt, which
  holds copies of section settings — image fields included. A homepage
  image changed in English can still be the old one in German until the
  override there is cleared.
