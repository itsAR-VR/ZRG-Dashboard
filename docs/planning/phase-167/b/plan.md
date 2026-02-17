# Phase 167b — Timeout Contract Verification (Context7 + Platform Limits)

## Focus
Validate timeout controls and upper bounds from current documentation before code/config changes.

## Inputs
- Phase 167a hypothesis matrix
- Context7 docs for Vercel and Inngest timeout configuration
- Existing project deployment/runtime settings

## Work
- Resolve and query relevant docs for Vercel function duration controls and Inngest run/invoke timeout semantics.
- Confirm whether `800s` is supported directly on this stack; if not, identify highest supported bound and required workaround pattern.
- Map verified doc guidance to exact files/fields in this repository.

## Output
A verified timeout contract: what value can be set, where, and why (with doc-backed constraints).

## Handoff
Provide concrete edit list and expected behavior changes to Phase 167c.
