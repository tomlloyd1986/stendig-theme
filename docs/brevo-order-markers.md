# How an order tells Brevo which market it came from

A contact in Brevo carries `MARKET`, `LANGUAGE` and `PATH`. On a **signup**
they are filled by the form itself — the popup, the waitlist and the footer
newsletter all POST them to Brevo alongside the email address.

On an **order** they have to arrive a longer way round: the theme writes them
onto the order, Shopify Flow reads them off it, and Flow updates the contact in
Brevo. That is the path that was losing them.

The workflow is real and was read on 4 Sep 2026: **Order → Send HTTP request →
`https://api.brevo.com/v3/contacts`**, with a Liquid body that loops
`order.customAttributes`. It was correct for every order that went through the
cart and blind to every order that did not.

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

The workflow already reads `order.customAttributes` and sends `MARKET`,
`LANGUAGE` and `PATH` to Brevo. **One block is missing: the fallback to the
line item's attributes when the order's own are empty.** That is the whole
change — the endpoint, the attribute names, the values and the empty-order
branch are all already right.

The basket is read FIRST and the line only as a fallback, in that order and not
the other way round. The basket's attributes say where the shopper was when
they checked out; a line's say where they were when they added THAT item, which
stops being the same thing the moment somebody changes language mid-visit. The
basket is also the only one of the two that a line the drawer's cross-sell
added carries at all, because that add posts straight to the cart rather than
through a product form.

### The block to insert

Directly after the existing `{% endfor %}` that closes the
`order.customAttributes` loop, and before the `{% if mkt != "" %}` that opens
the JSON:

```liquid
{% comment %} Nothing on the basket means an express checkout — Shop Pay, PayPal,
   Apple Pay, Google Pay — which never touches the cart. Read it off the line. {% endcomment %}
{% if mkt == "" %}
{% for li in order.lineItems %}
{% for a in li.customAttributes %}
{% if a.key == "_st_market" %}{% assign mkt = a.value %}{% endif %}
{% if a.key == "_st_path" %}{% assign path = a.value %}{% endif %}
{% if a.key == "_st_lang" %}{% assign lang = a.value %}{% endif %}
{% endfor %}
{% endfor %}
{% endif %}
```

Nothing else in the workflow changes. Its trigger, its condition, its headers
and its `"attributes": {}` branch all stay as they are — an empty attributes
object sets no keys, so an order carrying nothing already leaves the contact's
existing markers alone, which is the right behaviour and was there before this.

### The whole body, after the insert

This is what the action holds once the block is in. `brevo-flow-body.mjs`
renders THIS text, so what is proved is what is live.

```liquid
{% assign mkt = "" %}{% assign path = "" %}{% assign lang = "" %}
{% for a in order.customAttributes %}
{% if a.key == "_st_market" %}{% assign mkt = a.value %}{% endif %}
{% if a.key == "_st_path" %}{% assign path = a.value %}{% endif %}
{% if a.key == "_st_lang" %}{% assign lang = a.value %}{% endif %}
{% endfor %}
{% comment %} Nothing on the basket means an express checkout — Shop Pay, PayPal,
   Apple Pay, Google Pay — which never touches the cart. Read it off the line. {% endcomment %}
{% if mkt == "" %}
{% for li in order.lineItems %}
{% for a in li.customAttributes %}
{% if a.key == "_st_market" %}{% assign mkt = a.value %}{% endif %}
{% if a.key == "_st_path" %}{% assign path = a.value %}{% endif %}
{% if a.key == "_st_lang" %}{% assign lang = a.value %}{% endif %}
{% endfor %}
{% endfor %}
{% endif %}
{% if mkt != "" %}
{
  "email": {{ order.email | json }},
  "updateEnabled": true,
  "attributes": {
    "MARKET": {{ mkt | json }},
    "LANGUAGE": {{ lang | json }},
    "PATH": {{ path | json }}
  }
}
{% else %}
{
  "email": {{ order.email | json }},
  "updateEnabled": true,
  "attributes": {}
}
{% endif %}
```

### What it does and does not change

| Order | Before | After |
|---|---|---|
| Cart checkout, `/en-de` | `de` / `en` / `/en-de` | unchanged |
| Cart checkout, bare domain | `primary` / `en` / `""` | unchanged |
| **Express checkout, `/en-de`** | **nothing sent** | **`de` / `en` / `/en-de`** |
| **Express checkout, bare domain** | **nothing sent** | **`primary` / `en` / `""`** |
| **Express, first line a bare cross-sell** | **nothing sent** | **read off the next line** |
| POS sale, draft order, pre-change basket | nothing sent | unchanged |
| Basket and line disagree | basket wins | unchanged |

### One weakness left, deliberately

`order.email` is sent as-is. On the rare order with no email address — a
phone-only checkout — it renders `null` and Brevo refuses the call. Adding

```liquid
{% assign contact_email = order.email %}
{% if contact_email == blank %}{% assign contact_email = order.customer.email %}{% endif %}
```

and sending `contact_email` fixes it, but it is a second edit to a live
workflow for a case that has not been seen. Guard it with the workflow's
condition instead — `Order → Email` *is not empty* — if it is not there
already.

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
