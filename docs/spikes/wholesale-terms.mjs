/**
 * The wholesale terms page carries the whole contract, unaltered.
 *
 * This is a legal document, so what matters is not that it looks right but
 * that nothing was dropped, renumbered or quietly reworded on its way from
 * the Word file into a theme template. A missing sub-clause is invisible on
 * screen and material in a dispute.
 *
 * The checks are therefore about the document, not the design:
 *
 * - Thirteen clauses, numbered 1 to 13, in order, each headed as the
 *   document heads it.
 * - Sub-clause numbers run CONTIGUOUSLY inside each clause — 4.1, 4.2, 4.3,
 *   4.4 with no gaps — and lettered items run (a), (b), (c) with none
 *   missing. A dropped paragraph leaves a hole, which is what makes this
 *   worth checking rather than counting words.
 * - Every clause the text CITES exists. The contract cross-references
 *   itself heavily ("a material breach of clauses 4, 5, 6, or 7", "the
 *   Territory as defined in clause 6.1"); a citation pointing at nothing
 *   means a clause was lost or renumbered.
 * - The one deliberately unfinished thing — the effective date — is still
 *   visibly marked, and nothing ELSE is left in square brackets, which is
 *   how the drafting placeholders in the source are written.
 * - The signature block is absent. It belongs on the copy a retailer signs,
 *   not on a public page, and a signature line nobody can sign reads as a
 *   broken form.
 *
 * Then it renders the page and checks the reader can actually get at it:
 * every clause reachable, and the whole contract present in the text of the
 * page rather than only in its markup.
 *
 *   npm i --no-save liquidjs playwright && node docs/spikes/wholesale-terms.mjs
 */
import { readFileSync } from 'node:fs'
import { Liquid } from 'liquidjs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

const TEMPLATE = 'templates/page.support-wholesale-terms.json'
const tpl = JSON.parse(read(TEMPLATE).replace(/^\s*\/\*[\s\S]*?\*\//, ''))
const main = tpl.sections.main
const clauses = main.block_order.map((k) => main.blocks[k].settings)

// ---------- the document ----------
check(main.type === 'support-page', `the page is built on ${main.type}, not the support-page section every other legal page uses`)
check(clauses.length === 13, `${clauses.length} clauses, not the document's 13`)

const numbers = clauses.map((c) => Number(/^(\d+)\./.exec(c.question)?.[1]))
check(numbers.every((n, i) => n === i + 1), `the clauses are numbered ${numbers.join(', ')}`)

const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const whole = [main.settings.intro, ...clauses.map((c) => `${c.question} ${c.answer}`)].map(textOf).join('\n')

// Sub-clauses run without gaps: a dropped paragraph leaves a hole. Read
// off the START of each paragraph, never from the running text — clause 4.3
// cites "clause 4.2", and a first draft of this counted that citation as a
// second 4.2 and failed a faithful copy.
const opensWith = (answer) => answer.split(/<\/p>/).map((p) => textOf(p)).filter(Boolean)
for (const [i, c] of clauses.entries()) {
  const n = i + 1
  const subs = opensWith(c.answer).map((p) => /^(\d+)\.(\d+)\s/.exec(p)).filter((m) => m && Number(m[1]) === n).map((m) => Number(m[2]))
  if (!subs.length) continue // clause 12 is one unnumbered paragraph, as in the document
  check(subs[0] === 1, `clause ${n} starts at ${n}.${subs[0]}`)
  check(subs.every((s, j) => s === j + 1), `clause ${n}'s sub-clauses run ${subs.join(', ')} — a gap means a paragraph was lost`)
}

// Lettered items likewise.
for (const [i, c] of clauses.entries()) {
  const letters = opensWith(c.answer).map((p) => /^\(([a-z])\)\s/.exec(p)).filter(Boolean).map((m) => m[1])
  if (!letters.length) continue
  const expected = letters.map((_, j) => String.fromCharCode(97 + j))
  check(letters.join('') === expected.join(''), `clause ${i + 1}'s lettered items run (${letters.join(') (')}) — expected (${expected.join(') (')})`)
}

// Every clause the contract cites exists.
const cited = new Set()
for (const m of whole.matchAll(/clauses?\s+([\d.]+(?:\s*,\s*\d+(?:\.\d+)?)*(?:\s*,?\s*(?:or|and)\s+\d+(?:\.\d+)?)?)/gi)) {
  for (const ref of m[1].split(/\s*(?:,|or|and)\s*/).filter(Boolean)) cited.add(ref.replace(/[.\s]+$/, ''))
}
check(cited.size > 5, `only ${cited.size} cross-references found — the citation reader is broken, not the document`)
for (const ref of [...cited].sort()) {
  const [top, sub] = ref.split('.')
  const clause = clauses[Number(top) - 1]
  check(Boolean(clause), `the text cites clause ${ref}, and there is no clause ${top}`)
  if (clause && sub) check(new RegExp(`(?:^|\\s)${top}\\.${sub}\\s`).test(textOf(clause.answer)), `the text cites clause ${ref}, which does not exist inside clause ${top}`)
}

// The one unfinished thing is marked, and it is the only one.
check(main.settings.intro.includes('[EFFECTIVE DATE]'), 'the effective date is no longer visibly marked as outstanding')
const brackets = [...whole.matchAll(/\[([^\]]{1,60})\]/g)].map((m) => m[1]).filter((b) => b !== 'EFFECTIVE DATE')
check(brackets.length === 0, `drafting placeholders left in the published text: ${JSON.stringify(brackets)}`)
check(/mailto:[\w.+-]+@/.test(clauses[12].answer), 'the notices address in clause 13 is not a mailto link')

// The signature block belongs on the signed copy.
check(!/Signed for and on behalf|Position:\s*_|Signature:\s*_/.test(whole), 'the signature block is on the public page')

// ---------- the page ----------
const section = read('sections/support-page.liquid')
const engine = new Liquid({ strictFilters: false })
engine.registerFilter('t', (k) => k)
engine.registerTag('style', {
  parse(token, remain) {
    this.tpls = []
    const s = this.liquid.parser.parseStream(remain).on('tag:endstyle', () => s.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('style not closed') })
    s.start()
  },
  * render(ctx, emitter) { emitter.write('<style>'); yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter); emitter.write('</style>') },
})
engine.registerTag('comment', {
  parse(token, remain) { const s = this.liquid.parser.parseStream(remain).on('tag:endcomment', () => s.stop()).on('template', () => {}).on('end', () => { throw new Error('comment not closed') }); s.start() },
  render() {},
})
engine.registerTag('schema', {
  parse(token, remain) { const s = this.liquid.parser.parseStream(remain).on('tag:endschema', () => s.stop()).on('template', () => {}).on('end', () => { throw new Error('schema not closed') }); s.start() },
  render() {},
})
// The section renders the theme's caret snippet; the harness has no
// snippet root, so `render` is answered with the shape, not the file.
engine.registerTag('render', {
  parse(token) { this.name = token.args },
  render(ctx, emitter) { if (this.name.includes('icon-caret')) emitter.write('<svg class="icon icon-caret" viewBox="0 0 10 6"><path d="M9 1L5 5 1 1" stroke="currentColor" fill="none"/></svg>') },
})

const html = await engine.parseAndRender(section, {
  section: { id: 'main', settings: main.settings, blocks: main.block_order.map((k) => ({ ...main.blocks[k], shopify_attributes: '' })) },
  page: { title: 'Wholesale terms of sale' },
})

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:62.5%}:root{--color-base-text:18,18,18;--color-base-background-1:255,255,255}${read('assets/base.css').replace(/@font-face[\s\S]*?\}/g, '')}</style></head><body><div id="shopify-section-main">${html}</div></body></html>`)
  // The section scopes every rule to #shopify-section-<id>; without that
  // wrapper the page renders unstyled and the layout checks below nothing.
  check(await page.locator('.sup').evaluate((el) => getComputedStyle(el).display) === 'flex', 'the section stylesheet is not reaching the page')

  const heads = await page.locator('.sup__q').allInnerTexts()
  check(heads.length === 13, `${heads.length} clauses on the page`)
  check(heads.every((h, i) => h.trim().startsWith(`${i + 1}.`)), `the page's clauses read ${JSON.stringify(heads.map((h) => h.trim().split(' ')[0]))}`)

  // Every clause opens, and its text is really there once opened.
  const items = page.locator('.sup__item')
  for (let i = 0; i < 13; i++) {
    const item = items.nth(i)
    check(!(await item.locator('.sup__a').isVisible()), `clause ${i + 1} is open before it is asked for`)
    await item.locator('summary').click()
    check(await item.locator('.sup__a').isVisible(), `clause ${i + 1} does not open`)
  }
  const shown = (await page.locator('.sup__content').innerText()).replace(/\s+/g, ' ')
  // Spot the clauses that carry the commercial teeth: if any of these went
  // missing the page would still look complete.
  for (const phrase of [
    'Minimum Advertised Price',
    'Title to the Products does not pass',
    'Passive sales are permitted',
    'Late payments accrue interest at 4% above the Bank of England base rate',
    'exclusive jurisdiction of the courts of England and Wales',
  ]) check(shown.includes(phrase), `the page does not contain: "${phrase}"`)

  const title = await page.locator('.sup__title').innerText()
  check(title.trim() === 'Wholesale terms of sale', `the page is titled "${title}"`)
  check((await page.locator('.sup__intro').innerText()).includes('[EFFECTIVE DATE]'), 'the outstanding effective date is not visible on the page')

  // On a phone the sidebar goes and the contract keeps the full width.
  await page.setViewportSize({ width: 390, height: 844 })
  check(!(await page.locator('.sup__side').isVisible()), 'the sidebar is still shown on a phone')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(overflow <= 0, `the page scrolls sideways by ${overflow}px on a phone`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`PASS: 13 clauses, ${[...cited].length} cross-references resolved, nothing dropped, signature block off the page`)
