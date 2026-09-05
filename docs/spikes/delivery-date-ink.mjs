/**
 * The delivery date pills state their own text colour.
 *
 * Reported from a phone: the four unpicked dates rendered in link blue while
 * the picked one rendered white. The rule set `background: #fff` and stopped
 * there, so the text fell through to the user agent's default button ink.
 * Desktop resolves that to black — which is why the screen looked right every
 * time it was checked on a Mac — and iOS resolves it to the system blue, the
 * colour it paints native tappable controls. Four of the five dates in the buy
 * flow therefore read as links, and the fifth did not, on the device most of
 * the traffic arrives on.
 *
 * The Colour pills directly above are <label>s wrapping hidden radios. A label
 * inherits the page, so it was never affected, and having one control right
 * and its neighbour wrong on the same screen is what made this look like a
 * quirk of the dates rather than a missing declaration.
 *
 * WHY THIS IS A TEXT CHECK AND NOT A RENDER. Every other spike here drives a
 * browser, and one would be worthless for this: the bug IS the default, and
 * the only browser available resolves that default to the correct-looking
 * black. A render would pass on the broken file. What can be checked is the
 * thing that was actually missing — a rule that paints a control's background
 * and leaves its ink to whatever is asking.
 *
 *   node docs/spikes/delivery-date-ink.mjs
 */

import { readFileSync } from 'node:fs'

const SNIPPET = 'snippets/delivery-date-buttons.liquid'
const src = readFileSync(new URL(`../../${SNIPPET}`, import.meta.url), 'utf8')

const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

// The snippet carries its own <style> block; read the rules out of it.
const style = src.match(/<style>([\s\S]*?)<\/style>/)
check(Boolean(style), `${SNIPPET} no longer carries a <style> block`)

const rules = new Map()
for (const [, sel, body] of (style?.[1] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rules.set(sel.trim(), body)
}

const decl = (body, prop) => {
  // Strip comments first: the explanation beside this fix names both `color`
  // and the colours it is about, and a naive search would read the prose as
  // the declaration and pass a file that had lost it.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '')
  return code.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim()
}

const RESTING = '.delivery-date-button-custom'
const PICKED = '.delivery-date-button-custom.active-custom'

const resting = rules.get(RESTING)
const picked = rules.get(PICKED)
check(Boolean(resting), `${RESTING} is gone`)
check(Boolean(picked), `${PICKED} is gone`)

// 1. The reported defect, in its own terms.
const restingInk = resting && decl(resting, 'color')
check(
  Boolean(restingInk),
  'an unpicked delivery date states no text colour, so the phone chooses it — ' +
    'which is what drew the dates in link blue on iOS',
)

// 2. Both states are spelled out, not just the one somebody noticed.
check(Boolean(picked && decl(picked, 'color')), 'the picked date states no text colour')

// 3. And they differ, or the pill is one colour on itself.
if (restingInk && picked) {
  const pickedInk = decl(picked, 'color')
  check(restingInk !== pickedInk, `both states paint their text ${restingInk}`)
  // Invisible text is ink against ITS OWN ground. Black at rest and a black
  // ground when picked is the design, not a clash — an earlier draft of this
  // check compared across the two states and failed the correct file.
  for (const [label, rule, ink] of [['unpicked', resting, restingInk], ['picked', picked, pickedInk]]) {
    const bg = decl(rule, 'background') ?? decl(rule, 'background-color')
    if (bg) check(ink !== bg, `the ${label} date paints its text and its ground both ${ink}`)
  }
}

// 4. The class of defect, not just this instance: anything in this block that
//    paints a control's background owes it an ink. Left to the user agent, the
//    two travel apart — which is the whole of this bug.
for (const [sel, body] of rules) {
  const bg = decl(body, 'background') ?? decl(body, 'background-color')
  if (!bg || bg === 'none' || bg === 'transparent') continue
  if (!decl(body, 'color')) {
    // A rule that only changes the background of a state whose base rule
    // already states an ink is fine; require the pairing on base rules.
    const base = sel.split(/[:.]/)[0] + (sel.startsWith('.') ? '' : '')
    const inherits = [...rules.keys()].some(
      (other) => other !== sel && sel.startsWith(other) && decl(rules.get(other), 'color'),
    )
    check(inherits, `${sel} paints a background but leaves its text to the browser`)
  }
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS: every pill in the delivery date block states its own ink')
