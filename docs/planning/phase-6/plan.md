# Phase 6 — Harden Signature Extraction + Sender Detection in Email Webhook

## Purpose
Stop signature extraction from failing on malformed/truncated AI responses and ensure inbound email processing doesn’t incorrectly decide “not from lead” due to parsing errors.

## Context
- The inbound email webhook (`/api/webhooks/email`) runs an enrichment pipeline that includes signature-based extraction.
- Current logs show the signature extractor can fail to parse the AI response (truncated JSON), followed by a decision path that skips enrichment because the email is treated as “not from lead”.
- These failures degrade enrichment reliability and can hide real lead contact details included in signatures.

## Objectives
* [x] Reproduce and isolate the signature-extractor parse failure (without storing/logging PII).
* [x] Make AI output parsing resilient (strict JSON enforcement + safe fallback parsing).
* [x] Ensure “isFromLead” decisions are robust and do not default to false on parse errors.
* [x] Add diagnostics/metrics to detect and quantify future parse drift.

## Constraints
- Webhooks are untrusted input; avoid logging/storing raw email bodies, addresses, or names in diagnostics.
- Prefer deterministic extraction (regex) where possible and use AI only when needed.
- Keep changes localized to existing utilities under `lib/` and the email webhook.

## Success Criteria
- [x] Signature extraction no longer fails due to truncated/malformed AI JSON (or gracefully falls back).
- [x] When the AI response cannot be parsed, the system does not incorrectly mark emails as “not from lead” by default.
- [x] Logs include enough context to debug (event id / lead id / client id + error category) without exposing PII.

## Subphase Index
* a — Trace + reproduce signature extractor parse failures
* b — Enforce structured output + resilient parsing
* c — Fix “isFromLead” defaulting + add fallbacks
* d — Verification checklist + monitoring

## Phase Summary
- Root cause: truncated/invalid AI JSON caused `lib/signature-extractor.ts` to return a default result (`isFromLead=false`), which downstream misread as “assistant reply”.
- Hardened JSON parsing and logging:
  - Brace-balanced JSON extraction in `lib/ai/response-utils.ts`
  - PII-safe parse-failure logging + stricter “JSON only” backstop in `lib/signature-extractor.ts`
- Fixed downstream behavior:
  - `SignatureExtractionResult.isFromLead` is now `"yes" | "no" | "unknown"`; email webhook treats `"unknown"` as inconclusive and avoids misleading logs, with a cautious regex fallback in `app/api/webhooks/email/route.ts`
  - Callers updated (`lib/phone-enrichment.ts`)
- Repro/verification:
  - `scripts/repro-signature-ai-parse.js`
  - `npm run lint` and `npm run build` succeeded; `npx tsc --noEmit` still has unrelated pre-existing type errors.
