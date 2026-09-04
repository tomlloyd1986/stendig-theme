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

The branded wallet buttons under the product form — Shop Pay, PayPal, Apple
Pay, Google Pay, rendered by `{{ form | payment_button }}` inside
`.custom-payment-btn` — build a checkout straight from that form. They never
touch the cart, so a cart attribute cannot exist on one of those orders however
well it was written. Dynamic checkout is enabled in all four product templates,
so this is not a rare route: **every express-checkout order reached Brevo with
no market, no language and no path**, while every order that went through the
cart was fine. That is the "some but not all" the markers were missing on.

> The theme's own **"Buy it now"** text button beside them is not that route
> today, and this is worth fixing separately. It carries class `ctm-buy-btn`,
> while the handler meant to proxy it to the wallet button
> (`sections/main-product.liquid`) looks for `ctm_buy_it_now` — a class nothing
> carries. Being a bare `<button>` inside the product form it therefore submits
> as an ordinary add to cart, so the button labelled Buy it now opens the cart
> drawer instead of checkout.

The properties fix a second, smaller hole at the same time. A cart attribute
only sticks to a cart that has items, so the first write has to wait for the
add to land — and a shopper who adds one item and goes straight to checkout can
be gone before it does. A property rides the add itself, so there is nothing to
wait for.

## What Shopify Flow has to do

The Flow that forwards these to Brevo reads the cart attributes today. It needs
to fall back to the line item's when the order's own are empty. Until it does,
express-checkout orders keep arriving bare — the theme is writing the markers,
but nothing is picking them up.

The basket is read FIRST and the line only as a fallback, in that order and not
the other way round. The basket's attributes say where the shopper was when
they checked out; a line's say where they were when they added THAT item, which
stops being the same thing the moment somebody changes language mid-visit. The
basket is also the only one of the two that a line the drawer's cross-sell
added carries at all, because that add posts straight to the cart rather than
through a product form.

### The workflow

**Trigger** — Order created (or Order paid, whichever the existing Flow uses;
leave it as it is).

**Condition** — `Order → Email` *is not empty*. An order with no email address
has no contact to update, and Brevo refuses the call.

**Action** — Send HTTP request.

| | |
|---|---|
| Method | `POST` |
| URL | `https://api.brevo.com/v3/contacts` |
| Headers | `api-key: <your Brevo v3 API key>`, `content-type: application/json`, `accept: application/json` |

### The body, to paste in whole

```liquid
{%- assign st_path = '' -%}
{%- assign st_market = '' -%}
{%- assign st_lang = '' -%}
{%- assign found = false -%}

{%- comment -%} 1. The basket's own attributes — an order that went through the cart or the drawer. {%- endcomment -%}
{%- for a in order.customAttributes -%}
  {%- if a.key == '_st_market' and a.value != blank -%}{%- assign st_market = a.value -%}{%- assign found = true -%}{%- endif -%}
  {%- if a.key == '_st_lang' and a.value != blank -%}{%- assign st_lang = a.value -%}{%- endif -%}
  {%- if a.key == '_st_path' and a.value != blank -%}{%- assign st_path = a.value -%}{%- endif -%}
{%- endfor -%}

{%- comment -%} 2. Nothing on the basket — an express checkout. Read it off the line instead. {%- endcomment -%}
{%- unless found -%}
  {%- for li in order.lineItems -%}
    {%- for a in li.customAttributes -%}
      {%- if a.key == '_st_market' and a.value != blank -%}{%- assign st_market = a.value -%}{%- assign found = true -%}{%- endif -%}
      {%- if a.key == '_st_lang' and a.value != blank -%}{%- assign st_lang = a.value -%}{%- endif -%}
      {%- if a.key == '_st_path' and a.value != blank -%}{%- assign st_path = a.value -%}{%- endif -%}
    {%- endfor -%}
  {%- endfor -%}
{%- endunless -%}

{%- assign contact_email = order.email -%}
{%- if contact_email == blank -%}{%- assign contact_email = order.customer.email -%}{%- endif -%}
{%- if found -%}
{"email":{{ contact_email | json }},"updateEnabled":true,"attributes":{"MARKET":{{ st_market | json }},"LANGUAGE":{{ st_lang | json }},"PATH":{{ st_path | json }}}}
{%- else -%}
{"email":{{ contact_email | json }},"updateEnabled":true}
{%- endif -%}
```

Three things in there are deliberate, and each one is a way this can go wrong:

- **An order carrying nothing sends no attributes at all.** A POS sale, a draft
  order, or a basket built before this shipped has none of the three. Sending
  them as empty strings would wipe whatever the contact already had — the
  markers a signup put there months ago included. The `found` flag is what
  stops that: with nothing to say, the call says nothing.
- **`PATH` is sent even when it is empty**, as long as something else was
  found. That is the primary market, where an empty path is the right answer.
- **`updateEnabled: true`** makes this a create-or-update. Brevo's own Shopify
  integration has usually created the contact by the time this runs; the flag
  is what stops the call failing when it has not.

If Flow rejects the `json` filter, the three values are all our own — `de`,
`en`, `/en-de` — so plain quotes work: `"MARKET":"{{ st_market }}"`. Keep
`json` on the email, which is the one field a stranger supplies.

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
cd docs/spikes && npm i jsdom liquidjs
node market-stamp.mjs        # the theme's half — what lands on the order
node brevo-flow-body.mjs     # the Flow's half — read out of the block above
```

`brevo-flow-body.mjs` renders the Liquid block in **this file** against every
shape of order the store produces, so the pin cannot drift away from the text
that is actually pasted in.

What it cannot prove is Shopify's own behaviour — that a hidden line item
property survives an express checkout. That is the same behaviour the
`Delivery Date` property on the product form already relies on, and it is
confirmed by placing one Buy it now order and looking at it in the admin under
**Additional details**.
