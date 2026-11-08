---
name: design
description: Design in the method: docs/DESIGN.md, tokens, accessibility thresholds (contrast, 44 px, keyboard) and the interface review. Load it for a checkpoint with an interface, or for a UI review.
---

## Design

The interface has its own document, `docs/DESIGN.md`, in the project's table of authoritative documents. It owns *how the interface looks and how it behaves*: colors and their roles, text, spacing, components, patterns and wording. It does not own *what a page does*, which is in the software architecture document, nor the *why* of the choices, which is in the decision log. It has the shape of Google's DESIGN.md spec (`github.com/google-labs-code/design.md`): tokens in YAML at the top, normative, and the prose that says how to use them, in the canonical sections. Start from the plugin's `templates/DESIGN.md`, which has the token roles and the structure, without values: the values, the palette, the components and the lexicon are the project's.

The rules that keep it true:

- **Before the first page**, planning decides its values, and the first checkpoint with an interface builds the components, puts the tokens in the frontend configuration under the same names, and brings in the guard on the sources. Without this, every checkpoint remakes its own buttons, dialogs and alerts, and the same error alert ends up copied dozens of times.
- **Every checkpoint with an interface** follows the interface lines in «How we work» (`templates/block.md`): components, tokens and glossary of `DESIGN.md`, two screenshots in the report, finger and keyboard tested. `delivery-check` checks it at item 7.
- **A value or component that is missing is added to `DESIGN.md` in the same commit**, not in the page. A rule that changes, the primary color, the dark theme, what asks for confirmation, is a decision: an entry in the decision log.

**The thresholds** hold for every project, and the colors, sizes and components of `DESIGN.md` are chosen to respect them:

- **contrast**: 4.5:1 for text, 3:1 for controls, field borders and large text (WCAG 1.4.3 and 1.4.11);
- **color is never the only signal**: an error also has text, a state also has a label;
- **everything you touch is at least 44×44 px** (WCAG 2.5.5, Apple HIG), never under 24 (WCAG 2.5.8), and **no text under 12 px**;
- **keyboard**: everything clickable is reachable with Tab and activated with Enter or Space; a dialog keeps focus inside, closes with Escape and returns it to where it started; focus is always visible;
- **every field has a real label**, every dialog a linked title, every icon-only button a name that says what it does, and alerts that appear by themselves are announced (`role="alert"` or `role="status"`);
- the pages and dialogs touched by a checkpoint pass `axe` with no serious violations.

### The interface review

It is planning work, not code. It is done when a block with an interface closes, or when the owner asks, and ends in a report in `reports/`: a report is not authoritative, it says how the interface is doing, what it was measured against and what is proposed. The method is this:

1. **What to look at**: the frontend code, counted (files, lines, copies of the same piece); the running application, on a phone (375 px) and a computer (1280 px), with screenshots, taken from a demo or a test stack with invented data, never with real people; the decisions in the log that touch the interface; the test notes, corrections and reports, that is, what users have already seen.
2. **The reference practices**, from primary sources or sources that agree with each other, listed at the end: Nielsen's heuristics, read for the type of product; forms and errors; finger, contrast and keyboard (WCAG 2.2, Apple HIG, Material); states, empty, loading, error, done; the practices of the product's domain; a component system suited to whoever writes the code.
3. **How it is doing, measured** against those practices: first what is fine and is not touched, then the defects, each with the number that measures it and the screenshot. The biggest usage defect goes first, even if it is not aesthetic.
4. **What is proposed**: the changes to `DESIGN.md`, the checkpoints that bring them into the code, and the lines for «How we work», for the prompt and for `delivery-check`, if they change.
5. **The decisions, for the owner**, numbered, each with the question, the alternatives and the recommendation. What is not a decision is the checkpoints' work, and is not listed.

What the owner approves goes into `DESIGN.md`, the block documents and the decision log; the report stays as it was.
