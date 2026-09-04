# How an order tells Brevo which market it came from

A contact in Brevo carries `MARKET`, `LANGUAGE` and `PATH`. On a **signup**
they are filled by the form itself — the popup, the waitlist and the footer
newsletter all POST them to Brevo alongside the email address.

On an **order** they arrive a longer way round: the theme writes them onto the
order, Shopify Flow reads them off it, and Flow updates the contact in Brevo.
That is the path that was losing them.

## What the theme puts on an order

`layout/theme.liquid` resolves the storefront the visitor is actually on and
writes three values twice, under two different carriers:

| | `_st_path` | `_st_market` | `_st_lang` |
|---|---|---|---|
| `/en-de` | `/en-de` | `de` | `en` |
| `/fr-ch` | `/fr-ch` | `ch` | `fr` |
| bare domain | *(absent)* | `primary` | `en` |

- **Cart attributes** — `order.customAttributes`. What an order placed through
  the cart or the add-to-cart drawer carries.
- **Hidden line item properties** — `order.lineItems[].customAttributes`. What
  an order placed through an **express checkout** carries, and the only thing
  it carries.

Two carriers, because neither one reaches every order.

## Why one carrier was not enough

Buy it now, Shop Pay, PayPal, Apple Pay and Google Pay build a checkout
straight from the product form. They never touch the cart, so a cart attribute
cannot exist on one of those orders however well it was written. Buy it now is
enabled on every product template and drawn as a full-width button directly
under Add to cart, so this is not a rare route: **every express-checkout order
reached Brevo with no market, no language and no path**, while every order that
went through the cart was fine. That is the "some but not all" the markers were
missing on.

The properties fix a second, smaller hole at the same time. A cart attribute
only sticks to a cart that has items, so the first write has to wait for the
add to land — and a shopper who adds one item and goes straight to checkout can
be gone before it does. A property rides the add itself, so there is nothing to
wait for.

## What Shopify Flow has to do

The Flow that forwards these to Brevo reads the cart attributes today. It needs
to fall back to the line item's when the order's own are empty — take the first
line that has them, since every line on an order carries the same three:

```
order.customAttributes        → if empty, use
order.lineItems[0].customAttributes
```

Until Flow reads the second one, express-checkout orders keep arriving bare —
the theme is writing the markers, but nothing is picking them up.

## Reading a blank PATH

`PATH` is empty **on purpose** on the primary market: Brevo templates build
URLs as `domain + PATH + /page`, and the bare domain has no prefix. Shopify
drops an empty attribute and an empty property alike, so a primary-market order
carries no `_st_path` at all.

So a blank `PATH` never means "unstamped" by itself. **`MARKET` is what tells
the two apart:** `primary` is a bare-domain order that was stamped correctly;
genuinely blank is an order nothing wrote to.

## Proving it

`docs/spikes/market-stamp.mjs` runs the real block out of `theme.liquid`
against a scripted DOM and a scripted cart: which market each URL resolves to,
which fields land on a product form (including one mounted later by quick-add
or a page builder), what the cart write carries, and that a slow add is still
caught.

```sh
cd docs/spikes && npm i jsdom && node market-stamp.mjs
```

What it cannot prove is Shopify's own behaviour — that a hidden line item
property survives an express checkout. That is the same behaviour the
`Delivery Date` property on the product form already relies on, and it is
confirmed by placing one Buy it now order and looking at it in the admin under
**Additional details**.
