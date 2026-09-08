/**
 * How a row of editorial images lays out on a phone.
 *
 * The Images block in `sections/blog-content.liquid` is a flex row whose
 * children took `flex: 1 1 0`, so a PAIR sat side by side at every width —
 * on a 390px phone that is two photographs 179px wide, which is too small
 * to read a room in. A pair fills the column and stacks now; three or four
 * still wrap into two columns, because that row is a contact sheet rather
 * than a picture and stacked it would be a screen and a half of scrolling.
 *
 * Two halves have to agree and they live in different parts of the file:
 * the CSS in the `{% style %}` block, and the `sizes` attribute on each
 * `<img>`, which is what tells the browser WHICH file to fetch. A pair left
 * at `50vw` would stack at full width and fetch a half-width source, so the
 * change would look right on a laptop and soft on the phone it is for.
 *
 * A layout is the one thing a static read cannot answer, so this renders
 * the block's own stylesheet against its own markup, measures the boxes,
 * and then reads the sizes attribute back.
 *
 *   node docs/spikes/editorial-image-stacking.mjs
 *
 * It needs playwright — installed for the repo or globally (`npm i -g
 * playwright`). The browser is the whole point, so a run that cannot start
 * one fails and says so rather than passing quietly.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = readFileSync(join(root, 'sections/blog-content.liquid'), 'utf8')
const faults = []

/* This repo carries no node_modules of its own, so a global install is the
   ordinary way to have playwright here — and an ESM import does not read
   NODE_PATH, which is why the global root is asked for by name. */
const loaded = await import('playwright').catch(async () => {
  const global = execSync('npm root -g', { encoding: 'utf8' }).trim()
  return import(pathToFileURL(join(global, 'playwright', 'index.js')).href)
}).catch(() => null)
/* Reached by its path playwright arrives as a CommonJS namespace, whose
   exports hang off `default`; reached by name they are on the module. */
const playwright = loaded?.chromium ? loaded : loaded?.default

if (!playwright?.chromium) {
  console.error('The editorial image row: playwright is not installed, so nothing was measured.\n  npm i -g playwright')
  process.exit(1)
}

/* The section's own stylesheet with the one interpolation it carries filled
   in — never a copy of the rules, which would drift from them. */
const style = src
  .slice(src.indexOf('{% style %}') + '{% style %}'.length, src.indexOf('{% endstyle %}'))
  .replaceAll('{{ section.id }}', 'spike')

/* A 3:2 photograph, so a stacked pair is unmistakably taller than a row. */
const box = (n) => `<div><img src="data:image/svg+xml,${
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>')
}" width="1200" height="800" alt="${n}"></div>`

const row = (count) => `
  <figure class="blogc__media blogc__w-wide" style="margin-inline: auto;">
    <div class="blogc__media-row${count > 2 ? ' has-many' : ''}" data-count="${count}">
      ${Array.from({ length: count }, (_, i) => box(i + 1)).join('')}
    </div>
  </figure>`

const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>html,body{margin:0}${style}</style></head>
  <body><div id="shopify-section-spike"><div class="blogc">
    ${row(1)}${row(2)}${row(4)}
  </div></div></body></html>`

/* The sandbox keeps its browser outside the package; a laptop uses the one
   playwright installed for itself. */
const bundled = '/opt/pw-browsers/chromium'
const browser = await playwright.chromium.launch(existsSync(bundled) ? { executablePath: bundled } : {})

/** Each photograph's rect, by how many are in its row. */
const shots = async (viewport) => {
  const page = await browser.newPage({ viewport })
  await page.setContent(html)
  const out = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.blogc__media-row')].map((r) => [
      r.dataset.count,
      [...r.children].map((d) => {
        const b = d.getBoundingClientRect()
        return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width) }
      }),
    ])),
  )
  await page.close()
  return out
}

const phone = await shots({ width: 390, height: 900 })
const desk = await shots({ width: 1400, height: 900 })
await browser.close()

const stacked = (r) => r.every((b) => b.left === r[0].left) && new Set(r.map((b) => b.top)).size === r.length
const across = (r) => r.every((b) => b.top === r[0].top)
/* 390 less the .blogc gutters, 12 a side. */
const column = 390 - 24

/* On a phone one and two fill the column; three or four go two across. */
for (const count of ['1', '2']) {
  const r = phone[count]
  if (!stacked(r)) faults.push(`${count} image(s): not stacked at 390px — ${JSON.stringify(r)}`)
  if (r.some((b) => b.width !== column)) faults.push(`${count} image(s): ${r[0].width}px wide at 390px, not the full ${column}px column`)
}
const four = phone['4']
if (!across(four.slice(0, 2)) || four[0].top === four[2].top) {
  faults.push(`4 images: no longer two by two at 390px — ${JSON.stringify(four)}`)
}

/* On a desktop both rows are one row, which is what stacking must not cost. */
for (const count of ['2', '4']) {
  if (!across(desk[count])) faults.push(`${count} images: no longer one row at 1400px — ${JSON.stringify(desk[count])}`)
}

/* And the sizes attribute follows the same split. */
const sizes = /sizes="\(max-width: 749px\) ([^,]+),/.exec(src)
if (!sizes) {
  faults.push('the images block no longer carries a phone branch in its sizes attribute')
} else if (!/img_count > 2/.test(sizes[1]) || !/50vw/.test(sizes[1]) || !/100vw/.test(sizes[1])) {
  faults.push(`sizes says "${sizes[1]}" — a phone is 50vw only where the row is 3 or 4 across`)
}

if (faults.length) {
  console.error('The editorial image row:\n' + faults.map((f) => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
console.log(`The editorial image row: a pair stacks at 390px (${phone['2'][0].width}px each), four stay two by two, both are one row at 1400px, and sizes follows.`)
