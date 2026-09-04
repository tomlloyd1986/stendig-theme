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

const thumbBlock = /const updateThumbnails = \(targetProduct, colorValue\) => \{[\s\S]*?\n  \};/.exec(src)
if (!thumbBlock) throw new Error('updateThumbnails is no longer where this spike looks for it')
const updateThumbnails = new Function(`${thumbBlock[0]}; return updateThumbnails`)()

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

/* The translated value against untranslated alt text. Nothing matches, and the
   page must not end up with no pictures. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Rot')
  if (shown(items) === 0) faults.push('a translated colour value hid EVERY image — the page has no pictures at all')
  else if (shown(items) !== ALTS.length) faults.push(`nothing matched, so every image shows; ${shown(items)} of ${ALTS.length} did`)
  else ok('a value in a language the alt text does not speak shows every image, never none')
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

if (faults.length) {
  console.error('\nvariant images by locale:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nvariant images: the colourway filter works in every language, and never empties the gallery')
