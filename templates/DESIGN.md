---
# The method's docs/DESIGN.md template (metodo:design). Copy it into the project and fill it in at the first
# interface planning, before the first page. The structure and the order of the sections follow Google's DESIGN.md
# spec (github.com/google-labs-code/design.md), which has a lint for references and contrast. The tokens below are
# the normative values, and every name is a role: a role the product does not use is removed, one that is missing
# is added, always with the comment that says what it is for.
version: alpha
name: PROJECT NAME
description: what it is, and which device it is mostly used from.

colors:
  # Surfaces and text
  background: ""          # the page background
  surface: ""             # cards, dialogs, the header
  surface-low: ""         # alternate rows, section backgrounds
  border: ""
  border-control: ""     # inputs and selects: 3:1 on the background
  text: ""                # 4.5:1 on the background and on the surface
  text-secondary: ""      # subtitles, help: 4.5:1
  text-muted: ""          # decorative only, never for reading
  # Roles
  primary: ""             # the main action, links, the active menu item
  primary-strong: ""      # hover and focus of the primary
  primary-light: ""       # background of the active item, of the highlighted row
  danger: ""              # actions that cannot be undone
  danger-light: ""        # background of the error alert
  danger-text: ""         # text of the error alert
  warning: ""             # something to do, a conflict
  warning-light: ""
  warning-text: ""
  success: ""             # saved, active
  success-light: ""
  success-text: ""
  # Domain colors (a person, a state, a category) are added here, each with its role.

typography:
  family:
    fontFamily: ""
  body:
    fontSize: ""
    lineHeight: ""
  small:
    fontSize: ""     # the minimum, never under 12px
    lineHeight: ""
  label:
    fontSize: ""
    fontWeight: ""
  page-title:
    fontSize: ""
    fontWeight: ""
  section-title:
    fontSize: ""
    fontWeight: ""

rounded:
  control: ""     # buttons, inputs, selects, badges
  surface: ""    # cards, dialogs, alerts
  full: 9999px

spacing:
  base: ""
  card-padding: ""
  between-fields: ""
  between-sections: ""
  page-margin: ""
  min-target: 44px      # the method's threshold: raise it, never lower it

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "{spacing.min-target}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "{spacing.min-target}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    height: "{spacing.min-target}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "{spacing.min-target}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
    padding: "{spacing.card-padding}"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  alert-error:
    backgroundColor: "{colors.danger-light}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.surface}"
  alert-warning:
    backgroundColor: "{colors.warning-light}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.surface}"
  alert-success:
    backgroundColor: "{colors.success-light}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.surface}"
---

# How the interface looks and behaves

**Status:** *(skeleton from the method's template; then: who decided the values and when, with the decision log entry)*. Empty values and italic paragraphs are written at the first interface planning; rules without italics already hold, and change only with an entry in the decision log.

This document owns *the look and behavior of the interface*: colors and their roles, text, spacing, components, patterns (a dialog, an error, a loading state, an empty state) and wording. It does not own *what a page does*: that is in the software architecture document. The why of the choices is in the decision log: link to it here, do not repeat it.

The tokens at the top are the normative values. They live in the frontend configuration under the same names, and the code uses the names (`bg-primary`, not the color). A value that is not a token is not written in a page: it is added here, in the same commit, with its role.

Whoever writes code reads this document before touching a page. The `delivery-check` sub-agent uses it as a checklist. The contrast, size and keyboard thresholds are the method's (`METHOD.md`, «Design»): the values here are chosen to respect them.

---

## 1. Overview

*The interface's character in three adjectives, the tone of the wording, and the table of devices: where it is used, for what, how it is tested and in what order.*

| Where | What | How it is tested |
|---|---|---|

*The point where «phone» becomes «computer», in px: a single number, for the menu, for dialogs and for everything else.*

## 2. Colors

Every color has a **role**, and is used for that. Color is never the only signal.

*How many primaries, whether they change by section, how many colors a new element gets, the domain colors and their meaning. The dark theme: decided or not; until there is a decision, nothing is written.*

## 3. Typography

*The family, the sizes of body, labels and titles, capitalization, ellipses, ranges, the format of dates and times, with a single function for each format.*

## 4. Layout

*Margins and maximum width; what is in the first screen on a phone; where a dialog's actions are and in what order; how a dialog opens on a phone; how a page is composed.*

## 5. Elevation

*How many levels, and which ones have a shadow.*

## 6. Shapes

*The radii for controls and for surfaces; the icon library, one only, at one size only.*

## 7. Components

*The folder of primitives in the frontend.* **A component that exists is used, not remade in a page.** Each has a file, an example in a non-routed examples page, which a test renders in full and passes through `axe`, and an accessibility note at the top of the file.

| Component | Variants | What it guarantees |
|---|---|---|

*The primitives almost every product has, to choose from: the button, the dialog, the confirmation of a destructive action, the field, the alert, the loading state, the empty state, the tabs, the badge. For each, what it guarantees: the dialog keeps focus inside, closes with Escape and returns it to where it started; the field has a visible label and the error below it, linked; the alert is announced.*

What a page does by itself: the content. What it does not do by itself: a button, a dialog, an alert, a field, a state.

## 8. Do and don't

**Do**
- *How a save is confirmed, where an error is shown, when a loading state is shown.*

**Don't**
- A color, radius or size written in a page instead of the token.
- A `div` with `onClick`: it is a `button`, or an `a`, or it has `role`, `tabIndex` and the keyboard.
- A text that says something different from what the button does.
- *The rest, with examples taken from the product.*

## 9. Wording

A glossary. Every verb has a single meaning, across the whole product.

| Word | Means | Does not mean |
|---|---|---|

*The verbs of the actions, the names of the domain's things, one per thing, and the fixed phrases: in progress, the server not answering, a field's error, the greeting.*

## 10. Accessibility

Not a separate project: the threshold under which a delivery goes back. The method's thresholds hold (`METHOD.md`, «Design»).

*What the project adds to the method's thresholds.*

---

## The guard on the sources

The first checkpoint with an interface brings a test that reads the frontend sources and fails on every size under 12 px, every color written outside the token configuration, and what §8 forbids. It is what keeps the document true without anyone having to remember it.
