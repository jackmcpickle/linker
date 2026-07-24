# ADR 0001 — Admin row actions as a native `<details>` dropdown

Status: accepted Date: 2026-05-19

## Context

The admin link table's actions column grew past six entries (extend, edit,
revoke, delete, pair, QR×N) and was breaking the row layout with `flex-wrap`.
Each action also needs an in-flight indicator so the operator knows a mutation
is mid-flight.

## Decision

Collapse all per-row actions into one native `<details>` element rendered as a
`...` summary trigger. The dropdown contents are absolutely positioned. While
any HTMX request inside the dropdown is in-flight, CSS swaps the `...` trigger
for a spinner using `:has(.htmx-request)`.

- Trigger: `<summary>` element styled as the `...` button.
- Menu: absolutely-positioned panel revealed by native `<details>` open state.
- Busy state: a sibling spinner span; CSS
  `details:has(.htmx-request) > summary { display: none }` and the inverse on
  the spinner toggles visibility.
- High-frequency actions stay inline (copy URL next to each token).

## Trade-offs rejected

- **Hand-rolled ARIA menu with keyboard nav + outside-click close.** Proper menu
  semantics (`role=menu`, arrow-key navigation, focus management, click-outside
  dismiss) would cost ~40 lines of JS and ongoing maintenance. This is a
  single-operator admin tool with no public exposure — the cost is not
  justified.
- **One dropdown per URL block.** Mixed-scope actions (URL-scoped copy/QR +
  row-scoped edit/extend) split awkwardly. Single per-row dropdown with copy
  kept inline is simpler.

## Convention for future rows

Any new per-row action should drop into the same `<details>` block and use the
standard `<Spinner class="htmx-spinner">` pattern. The row-busy CSS picks it up
automatically — no per-action JS wiring needed.
