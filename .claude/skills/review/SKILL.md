---
name: review
description: >-
  Check the current build against specs/<name>.md, requirement by requirement.
  List every gap, bug, or missing piece and name the exact spec item it fails;
  if anything fails, write concrete fixes and hand them back so /build can
  address them. Pass only when every requirement in the spec is fully met. Use
  when the user runs /review, or asks to verify/QA a build against its spec.
---

# Review — check the build against the spec, requirement by requirement

You are the gate between "built" and "done". The spec in `specs/<name>.md` is
the **single source of truth**; your job is to prove, item by item, whether the
current build actually meets it.

> This skill **assesses and hands back fixes — it does not implement them.** Do
> not edit code. Inspect, verify, and produce a verdict plus a fix list that
> `/build` can act on.

## Stage 0 — Load the spec

1. Pick the spec: if the user gave a name, read `specs/<name>.md`. Otherwise
   look in `specs/` (one → use it; several → ask which; none → stop and say
   there is nothing to review against).
2. Read the whole spec: Objective, Scope (in/out), Requirements (R1, R2, …),
   Constraints, Edge cases, Definition of done. This is your checklist.

## Stage 1 — Verify, don't assume

Go through the spec **one item at a time** and check the real codebase against
each. Be skeptical and adversarial — the goal is to find what's wrong, not to
confirm it's fine.

- Read the actual code that implements each requirement; don't trust comments,
  commit messages, or a previous build report.
- Run the project's tests / build / linter where they exist, and exercise the
  Definition-of-done checks. Report real results; never assume a check passes.
- Probe the **edge cases** the spec lists — confirm each is handled the way the
  spec says, not just the happy path.
- Check the **Constraints** (stack, integrations, performance, security) are
  respected.

## Stage 2 — Report every gap, tied to a spec item

For **each** requirement `R#`, each edge case, and each Definition-of-done item,
give a verdict:

- **PASS** — met. Cite where (file · function/line) and how you confirmed it.
- **FAIL** — not met, buggy, or missing. State the exact gap/bug/missing piece
  and **name the spec item it fails** (e.g. "fails R4" / "fails edge case:
  empty input" / "fails DoD #2").

Also flag (secondary): anything in the build that is **not in the spec**
(features/changes that shouldn't be there), since the build is meant to match
the spec exactly.

## Stage 3 — Verdict and handoff

- **Overall verdict:**
  - **PASS** — only if **every** requirement, edge case, and Definition-of-done
    item is fully met. Say so clearly.
  - **FAIL** — if anything at all is unmet. List the failing spec items up front.
- If the verdict is FAIL, produce a **fix list for `/build`**: one entry per
  problem, each containing
  - the spec item it addresses (`R#` / edge case / DoD item),
  - what's wrong now,
  - the concrete change needed to satisfy it.

  Write it so `/build` can pick it up and implement the fixes directly, then the
  build can be reviewed again. Do not implement the fixes yourself.

Keep iterating (build → review) until the verdict is PASS. **Never pass a build
while any requirement in the spec is unmet.**
