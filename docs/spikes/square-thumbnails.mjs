/**
 * The square product thumbnail, and a 4:5 photograph.
 *
 * The product offer boxes draw a product's photograph in a box the markup
 * declares square — `width="150" height="150"` on the img, with no CSS
 * anywhere to loosen it. The photographs are 4:5 (2048 × 2560), so a square
 * ask has to lose something: `crop: 'center'` kept the full width and took the
 * middle 80% of the height, cutting the bottom rows off every calendar.
 *
 * Shopify's CDN can PAD to the box instead of cropping into it —
 * `?width=&height=&pad_color=` — so the whole calendar survives and the box
 * stays square. `image_url` is the filter that emits those parameters;
 * `img_url`, which this file used, cannot.
 *
 * The colour is not a guess. It is sampled from the photographs themselves:
 * the V Calendar's own background is #eae9e7, and at 150px the Stendig's
 * #e2e2e2 is indistinguishable from it. Hanging Strips is already 1:1 and
 * never pads at all, so it is unaffected either way.
 *
 * This checks the source. What it cannot check is the CDN, which was verified
 * by hand against the live files:
 *
 *   ?width=200&height=200&crop=center      -> 200x200, bottom of the calendar gone
 *   ?width=200&height=200&pad_color=eae9e7 -> 200x200, whole calendar, seam invisible
 *
 *   node docs/spikes/square-thumbnails.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = readFileSync(join(root, 'sections/main-product.liquid'), 'utf8')
const faults = []
const ok = (m) => console.log(`  ok  ${m}`)

/* The photographs' own background, sampled from the live files. Written here
   so a change to it is a change somebody has to justify. */
const PAD = 'eae9e7'

/* No product photograph is centre-cropped into a square any more. */
const cropped = [...src.matchAll(/featured_image[^}]*?crop: *'(?:center|centre)'/g)]
if (cropped.length) {
  faults.push(`${cropped.length} product photographs are still centre-cropped, which cuts the calendar`)
} else {
  ok('no product photograph is centre-cropped into a square')
}

/* Every offer-box thumbnail pads, and pads with the sampled colour. */
const pads = [...src.matchAll(/(pro|addon)\.featured_image \| image_url: width: (\d+), height: (\d+), pad_color: '([0-9a-f]{6})'/g)]
if (pads.length !== 84) {
  faults.push(`84 offer-box thumbnails were converted; this found ${pads.length}`)
} else {
  ok(`all ${pads.length} offer-box thumbnails pad rather than crop`)
}
for (const [, , w, h, colour] of pads) {
  if (w !== h) faults.push(`a thumbnail asks for ${w}x${h}, which is not the square the markup declares`)
  if (colour !== PAD) faults.push(`a thumbnail pads with #${colour}, not the photographs' own #${PAD}`)
}
ok(`each asks for a square and pads with the photographs' own #${PAD}`)

/* `img_url` cannot emit pad_color, so a reversion to it would silently crop
   again — the failure this whole change is about. */
if (/featured_image *\| *img_url/.test(src)) {
  faults.push('a product photograph is back on img_url, which cannot pad and will crop again')
} else {
  ok('nothing is back on img_url, which cannot pad')
}

/* The box is declared square in the markup, which is WHY the image has to be
   made square rather than merely scaled: an aspect-preserving file dropped
   into width=150 height=150 would be squashed, not letterboxed.

   Forty-two boxes against eighty-four filter calls, because each img uses the
   filter twice — once for src and once for srcset. Counted as a pair, or a
   correct file looks like a mismatch. */
const boxes = [...src.matchAll(/width="150"\s+height="150"/g)]
if (boxes.length * 2 !== pads.length) {
  faults.push(`each thumbnail uses the filter twice, for src and srcset: ${boxes.length} boxes against ${pads.length} filter calls`)
} else {
  ok(`${boxes.length} square boxes, each padding twice over — src and srcset`)
}

if (faults.length) {
  console.error('\nsquare thumbnails:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nsquare thumbnails: a 4:5 photograph fills a square box whole, rather than being cut into it')
