---
name: build
description: >-
  Read a spec in specs/<name>.md and implement exactly what it describes —
  no extra features, no unrelated refactors, no invented requirements. When
  finished, report which spec requirements were covered (mapped to files), so a
  review step can check the build against the spec. Use when the user runs
  /build, or asks to implement/build a feature from an existing spec.
---

# Build — implement exactly what the spec says

The spec in `specs/<name>.md` is the **single source of truth**. Your job is to
make the codebase match it — no more, no less.

## Stage 0 — Load the spec

1. Figure out which spec to build:
   - If the user gave a name/argument, read `specs/<name>.md`.
   - Otherwise look in `specs/`: exactly one file → use it; several → ask which
     one; none → stop and tell the user to run `/spec` first.
2. Read the **entire** spec before touching any code: Objective, Scope
   (in/out), Requirements (R1, R2, …), Constraints, Edge cases, and Definition
   of done. These are the checklist you build against.

## Stage 1 — Build to spec, nothing more

- **Implement exactly what the spec describes.** Every in-scope requirement and
  every listed edge case, handled the way the spec says.
- **Do not add anything that isn't in the spec.** Specifically:
  - No features, options, or UI beyond the requirements.
  - No refactoring of unrelated code, no renames, no "while I'm here" cleanups.
  - No invented requirements, edge cases, or success criteria.
  - Honor the **Out of scope / non-goals** — deliberately leave those unbuilt.
- **Respect the Constraints** (tech stack, integrations, performance, security).
- **Match the existing codebase** — follow its conventions, structure, naming,
  and patterns rather than introducing new ones.
- **Keep it minimal and reviewable** — the smallest change set that satisfies
  the spec.
- **When in doubt, ask — don't invent.** If the spec is ambiguous, incomplete,
  or self-contradictory, stop and ask the user. If you spot a real problem or
  risk in the spec, raise it rather than silently deviating from it.
- **Verify as you go** against the Definition of done. Run the project's tests /
  build / linter where they exist. Never claim a check passed unless you
  actually ran it and saw it pass.

## Stage 2 — Coverage report (for the review step)

When finished, output a report that maps the spec to what you built, so the
review step can check it item by item:

- **Requirements** — for each `R#`: status (✅ done / 🟡 partial / ❌ not done),
  where it's implemented (file · function/line), and a one-line note. Anything
  partial or not done must say **why**.
- **Edge cases** — for each one: how it's handled (and where).
- **Definition of done** — for each item: status and exactly how to verify it
  (command to run, what to click, expected result). Report real results for
  anything you ran.
- **Intentionally not built** — list what you left out because it was out of
  scope or not in the spec.
- **Deviations** — any place the implementation differs from the spec, and why.
  This should be rare; ideally none.

Format it as a checklist keyed to the spec's `R#` numbers so the requirements
can be ticked off one by one.
