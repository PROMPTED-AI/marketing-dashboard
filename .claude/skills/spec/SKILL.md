---
name: spec
description: >-
  Interview the user one focused question at a time to fully understand a
  feature or app they want to build, then write a detailed specification to
  specs/<name>.md (objective, exact requirements, edge cases, and a concrete
  definition of done). Use when the user runs /spec, or asks to spec out,
  scope, plan, or write requirements for something before building. Does NOT
  write implementation code.
---

# Spec — interview, then write the spec

Your job in this workflow is to turn a vague idea into a precise, checkable
specification. You do this in two stages: **interview**, then **write**.

> Hard rule: **Do not build anything.** No implementation code, no scaffolding,
> no file changes other than the final spec document. If the user pushes you to
> start coding, remind them this command only produces a spec.

## Stage 1 — Interview (one question at a time)

Interview the user until you can confidently fill in every required section of
the spec. Rules for the interview:

- **Ask exactly ONE focused question per turn**, then stop and wait for the
  answer. Never batch multiple questions into one message.
- **Start broad, then narrow.** Begin with the goal and the problem being
  solved; only then drill into specifics.
- **Follow up on vague answers.** If something is ambiguous, ask a clarifying
  question rather than assuming. State assumptions only when the user can't or
  won't decide, and mark them as assumptions.
- **Don't propose solutions or designs.** You are capturing intent, not
  deciding the implementation.
- **Stop when you have enough** — don't pad with unnecessary questions. You have
  enough when you can write all four required sections concretely.

Make sure the interview covers, at minimum:

1. **Objective** — what is being built and the problem/why behind it; who uses it.
2. **Must-have requirements** — the functionality that must exist. Separate these
   from nice-to-haves and explicit non-goals (out of scope).
3. **Constraints** — tech stack, existing systems to integrate with, data,
   performance, security/privacy, timeline, or anything that limits the solution.
4. **Edge cases** — unusual inputs, failure modes, empty/at-limit states, and
   what should happen in each.
5. **Definition of done** — how the user will know it's finished and correct;
   the concrete checks that must pass.

## Stage 2 — Confirm

Before writing, give a short summary of your understanding (a few bullet points
covering objective, key requirements, constraints, and what "done" means) and
ask whether anything is missing or wrong. Incorporate any corrections.

## Stage 3 — Write the spec

1. Pick a short, descriptive **kebab-case `<name>`** for the feature.
2. Create the `specs/` directory if it doesn't exist, and write the document to
   **`specs/<name>.md`**.
3. Use this structure (every section is required; add others only if useful):

   ```markdown
   # <Feature name>

   ## Objective
   What we're building and why. The problem it solves and who it's for.

   ## Scope
   ### In scope
   - ...
   ### Out of scope (non-goals)
   - ...

   ## Requirements
   Exact, numbered, individually testable statements (R1, R2, …). Each one
   should be specific enough that a reviewer can verify it as pass/fail.

   ## Constraints
   Tech stack, integrations, data, performance, security/privacy, timeline.

   ## Edge cases
   Each listed as "<situation> → <expected behavior>". Cover invalid input,
   empty/zero/at-limit states, failures, and concurrency where relevant.

   ## Definition of done
   A concrete checklist someone can run the build against. Each item is an
   observable, verifiable outcome (not "works well" but "X happens when Y").
   Tie items back to the requirements where possible.

   ## Open questions
   Anything still undecided, with the assumption taken in the meantime.
   ```

4. Keep requirements and the definition of done **precise and verifiable** —
   prefer concrete, checkable statements over adjectives.

5. After saving, tell the user the file path and give a one-line summary. Do not
   start building — that's a separate step the user initiates.
