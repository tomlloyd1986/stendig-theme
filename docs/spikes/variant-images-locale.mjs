/**
 * Hiding a product's images by colourway, on a storefront that is not English.
 *
 * The product page shows one colourway's photographs at a time, matching each
 * media item's ALT TEXT against the selected option value. Two things about
 * that are language-dependent, and both were wrong:
 *
 *  1. The colour option was found by looking for an option NAME containing
 *     "color" or "colour". Shopify translates option names, so on /de-de it is
 *     "Farbe" and on /ja-jp "カラー" — nothing matched, the block returned
 *     early, and no filtering happened at all. English worked, so it looked
 *     correct wherever anybody checked.
 *
 *  2. The option VALUE is translated too, while the alt text is typed once in
 *     the media library and is almost never translated. "rot" matches no alt
 *     saying "red", so every image was hidden — a product page with no
 *     pictures, which is worse than one that is merely unfiltered.
 *
 * The second cannot be MATCHED correctly from the theme: nothing in Liquid
 * hands back the option value in the language the alt was written in. What is
 * fixed is how it fails — nothing matching means the two vocabularies do not
 * meet, so every picture shows.
 *
 * The functions are lifted out of the section VERBATIM rather than retyped, so
 * this tests what ships. Not liquidjs: the code under test is the JavaScript
 * inside the section, and its Liquid inputs are supplied here.
 *
 *   node docs/spikes/variant-images-locale.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = readFileSync(join(root, 'sections/main-product.liquid'), 'utf8')
const faults = []
const ok = (m) => console.log(`  ok  ${m}`)

/* ---------- the code under test, lifted from the section ---------- */

const metaBlock = /const colorOptionMeta = \(\(\) => \{[\s\S]*?\}\)\(\);/.exec(src)
if (!metaBlock) throw new Error('colorOptionMeta is no longer where this spike looks for it')
const colourOption = (productOptions) =>
  new Function('productOptions', `${metaBlock[0]}; return colorOptionMeta`)(productOptions)

const aliasBlock = /const COLOUR_ALIASES = \{[\s\S]*?\n  \};/.exec(src)
if (!aliasBlock) throw new Error('COLOUR_ALIASES is no longer where this spike looks for it')
const canonBlock = /const canonicalColour = \(value\) => \{[\s\S]*?\n  \};/.exec(src)
if (!canonBlock) throw new Error('canonicalColour is no longer where this spike looks for it')
const thumbBlock = /const updateThumbnails = \(targetProduct, colorValue\) => \{[\s\S]*?\n  \};/.exec(src)
if (!thumbBlock) throw new Error('updateThumbnails is no longer where this spike looks for it')

const prelude = `${aliasBlock[0]}\n${canonBlock[0]}`
const canonicalColour = new Function(`${prelude}; return canonicalColour`)()
const updateThumbnails = new Function(`${prelude}\n${thumbBlock[0]}; return updateThumbnails`)()

/* ---------- the smallest DOM these two actually touch ---------- */

const media = (alt) => ({
  dataset: { mediaAlt: alt },
  style: {},
  classList: { add() {}, remove() {} },
  querySelector: () => null,
})
const productEl = (alts) => {
  const items = alts.map(media)
  return { el: { querySelectorAll: () => items }, items }
}
const shown = (items) => items.filter((i) => i.style.display !== 'none').length

/* ---------- 1. the option is found in every language ---------- */

const LANGS = [
  ['en', [{ name: 'Color', values: ['Black', 'Red'] }]],
  ['de', [{ name: 'Farbe', values: ['Schwarz', 'Rot'] }]],
  ['ja', [{ name: 'カラー', values: ['ブラック', 'レッド'] }]],
  ['zh-TW', [{ name: '顏色', values: ['黑色', '紅色'] }]],
]
for (const [lang, opts] of LANGS) {
  const m = colourOption(opts)
  if (!m.enabled) faults.push(`the colour option is not found on ${lang} (${opts[0].name}), so nothing is filtered at all`)
  else if (m.index !== 1) faults.push(`${lang} found the option at index ${m.index}, not 1`)
}
ok('the colour option is found whatever the storefront calls it')

/* A product with SEVERAL options is not guessed at: the fallback is the sole
   option, never the first of many. On Size + Colour with translated names,
   taking the first would filter the photographs by size. */
const many = colourOption([{ name: 'Größe', values: ['S'] }, { name: 'Farbe', values: ['Rot'] }])
if (many.enabled) faults.push('a product with two translated options was guessed at rather than left alone')
else ok('two options and no recognisable name: left alone rather than guessed')

/* Where the name IS recognisable it still wins, so a multi-option English
   product picks the colour option and not the first one. */
const sized = colourOption([{ name: 'Size', values: ['S'] }, { name: 'Colour', values: ['Red'] }])
if (sized.index !== 2) faults.push(`a named colour option must win on a multi-option product; got index ${sized.index}`)
else ok('a recognisable name still picks the right option out of several')

/* ---------- 2. what gets shown ---------- */

const ALTS = ['Stendig Red front', 'Stendig Red detail', 'Stendig Black front']

/* English, or any storefront whose option values are untranslated: the filter
   does its job and only the matching colourway is drawn. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Red')
  if (shown(items) !== 2) faults.push(`English filters to the two red images; ${shown(items)} were shown`)
  else ok('the matching colourway is filtered to, as it always did')
}

/* The translated value against untranslated alt text — the case that hid every
   image. It now names the colourway and filters to it, exactly as English does:
   two red photographs out of three, not none and not all. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Rot')
  if (shown(items) === 0) faults.push('a translated colour value hid EVERY image — the page has no pictures at all')
  else if (shown(items) !== 2) faults.push(`"Rot" filters to the two red photographs; ${shown(items)} of ${ALTS.length} were shown`)
  else ok('a translated value filters to its own colourway, like English does')
}

/* No colour selected at all: unchanged, everything shows. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, '')
  if (shown(items) !== ALTS.length) faults.push(`no colour selected shows everything; ${shown(items)} of ${ALTS.length}`)
  else ok('no colour selected still shows everything')
}

/* A colourway that genuinely has no photographs is the same case as a language
   mismatch from here, and takes the same answer rather than an empty gallery. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Yellow')
  if (shown(items) !== ALTS.length) faults.push(`a colourway with no images of its own shows the rest; ${shown(items)} shown`)
  else ok('a colourway with no photographs of its own shows the product’s, not a blank gallery')
}

/* ---------- 3. every value the shop actually shows ---------- */
/* Taken from the live product pages, one screenshot per storefront. These are
   the strings the filter is handed; each has to name its colourway. */
const LIVE = {
  en: { 'Red': 'red', 'Double Blue': 'double blue', 'Light Blue': 'light blue', 'Black': 'black', 'White': 'white' },
  fr: { 'Rouge': 'red', 'Bleu double': 'double blue', 'Bleu clair': 'light blue', 'Noir': 'black', 'Blanc': 'white' },
  de: { 'Rot': 'red', 'Doppelblau': 'double blue', 'Hellblau': 'light blue', 'Schwarz': 'black', 'Weiß': 'white' },
  it: { 'Rosso': 'red', 'Blu doppio': 'double blue', 'Azzurro': 'light blue', 'Nero': 'black', 'Bianco': 'white' },
  es: { 'Rojo': 'red', 'Doble azul': 'double blue', 'Azul claro': 'light blue', 'Negro': 'black', 'Blanco': 'white' },
  ja: { '赤': 'red', 'ダブルブルー': 'double blue', 'ライトブルー': 'light blue', '黒': 'black', '白': 'white' },
  ko: { '빨간색': 'red', '더블 블루': 'double blue', '라이트 블루': 'light blue', '검은색': 'black', '하얀색': 'white' },
  'zh-TW': { '紅色的': 'red', '雙藍色': 'double blue', '淺藍色': 'light blue', '黑色的': 'black', '白色的': 'white' },
}
for (const [lang, values] of Object.entries(LIVE)) {
  for (const [shown, want] of Object.entries(values)) {
    const got = canonicalColour(shown)
    if (got !== want) faults.push(`${lang}: "${shown}" names ${JSON.stringify(want)}, but resolved to ${JSON.stringify(got)}`)
  }
}
ok(`every colourway on all ${Object.keys(LIVE).length} storefronts names its English word`)

/* The one pair that can collide: both blues carry the word for "blue" in most
   of these languages, so a loose match must never answer one with the other. */
for (const [lang, values] of Object.entries(LIVE)) {
  const dbl = Object.keys(values).find((k) => values[k] === 'double blue')
  const lgt = Object.keys(values).find((k) => values[k] === 'light blue')
  if (canonicalColour(dbl) === canonicalColour(lgt))
    faults.push(`${lang}: "${dbl}" and "${lgt}" resolved to the same colourway`)
}
ok('the two blues are never confused for one another')

/* A value carrying a season or a suffix still names its colourway. */
for (const [shown, want] of [['Rot – 2027', 'red'], ['Bleu double (2027)', 'double blue'], ['Light Blue 2027', 'light blue']]) {
  const got = canonicalColour(shown)
  if (got !== want) faults.push(`a suffixed value must still name its colourway: "${shown}" gave ${JSON.stringify(got)}`)
}
ok('a value carrying a season or a suffix still names its colourway')

/* And the filter end to end: a German shopper picking Hellblau sees the light
   blue photographs, which is the whole point. */
{
  const alts = ['V Calendar Light Blue front', 'V Calendar Light Blue detail', 'V Calendar Double Blue front', 'V Calendar Red front']
  const { el, items } = productEl(alts)
  updateThumbnails(el, 'Hellblau')
  const visible = items.filter((i) => i.style.display !== 'none').length
  if (visible !== 2) faults.push(`Hellblau shows the two light blue photographs; ${visible} of ${alts.length} were shown`)
  else ok('a German shopper picking Hellblau sees the light blue photographs, not all four')
}

/* An unlisted colourway still degrades to the whole gallery rather than none. */
{
  const { el, items } = productEl(['V Calendar Red front'])
  updateThumbnails(el, 'Türkis')
  if (items.filter((i) => i.style.display !== 'none').length !== 1)
    faults.push('a colourway nobody has listed must still show the gallery, not empty it')
  else ok('a colourway nobody has listed shows the gallery rather than emptying it')
}

if (faults.length) {
  console.error('\nvariant images by locale:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nvariant images: the colourway filter works in every language, and never empties the gallery')
