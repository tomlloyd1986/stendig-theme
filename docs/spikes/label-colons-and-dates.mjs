/**
 * A colon typed after a translated label, and a date printed in English.
 *
 * The native speakers' review, 15 Sep 2026. French: "Location: France" —
 * *"In French, there is a space before a ':'"*. The word was translatable and
 * the colon was not: `{{ 'localization.location' | t }}:` types it in the
 * Liquid after whatever the language said, so no translation could ever put
 * the space in. Four labels were built that way — the location picker's, the
 * cart's live subtotal, the collection banner's hidden label and the cart
 * drawer's delivery date (which the Japanese reviewer met as "配送日: 26 Oct").
 * The colon is PART of the string now ("Location:") and the Liquid types
 * nothing after it, so French can say "Location :" and Japanese "配送日：".
 * What it costs: the four English strings changed, so their seven
 * translations read as outdated in Website › Translations until they are
 * drafted again — with the colon, under the guide's own rule for it.
 *
 * And the journal LIST printed its dates with `date: '%B %-d, %Y'` — English
 * month names on every storefront ("May 6, 2026" on /fr-fr, where the
 * reviewer asked for "6 mai 2026"), while the article page beside it already
 * used `time_tag: format: 'date'`, which Shopify localises. The list does
 * the same now.
 *
 * THE SWEEP (the faults are in the source, so the proof is a read of it):
 * no `| t }}:` anywhere in sections/, snippets/ or layout/; each of the four
 * keys carries its colon in `locales/en.default.json`; and no `published_at`
 * is printed through a strftime pattern with a month NAME in it (`%B`, `%b`).
 *
 * Before the change this reported four typed colons and one English date; it
 * must.
 *
 *   node docs/spikes/label-colons-and-dates.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const faults = []
const fail = (s) => faults.push(s)
const files = (dir) => readdirSync(dir).filter((f) => f.endsWith('.liquid')).map((f) => join(dir, f))

for (const f of ['sections', 'snippets', 'layout'].flatMap(files)) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/\|\s*t\s*}}:/.test(line)) fail(`${f}:${i + 1} types a colon after a translated label: ${line.trim().slice(0, 90)}`)
    if (/published_at\s*\|\s*date:\s*'[^']*%[Bb]/.test(line)) fail(`${f}:${i + 1} prints a date with an English month name: ${line.trim().slice(0, 90)}`)
  })
}

/* The locale file opens with a comment block, which JSON does not allow and Shopify does. */
const en = JSON.parse(readFileSync('locales/en.default.json', 'utf8').replace(/^\s*\/\*[\s\S]*?\*\//, ''))
const at = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), en)
for (const key of ['localization.location', 'sections.cart.new_subtotal', 'sections.collection_template.title', 'delivery.date_title']) {
  const v = at(key)
  if (typeof v !== 'string') fail(`${key} is not in locales/en.default.json`)
  else if (!v.endsWith(':')) fail(`${key} reads ${JSON.stringify(v)} — the colon belongs in the string, where a language can space it`)
}

if (faults.length) {
  console.error(`label-colons-and-dates: ${faults.length} fault(s)\n  - ${faults.join('\n  - ')}`)
  process.exit(1)
}
console.log('label-colons-and-dates: every label carries its own colon, and the journal list dates in the reader’s language')
