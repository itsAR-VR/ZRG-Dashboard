# Phase 94 — Baseline (AI Timeouts + Token Truncation)

Collected: 2026-02-02T23:10:16Z

This document intentionally avoids PII (no lead emails, no message bodies).

## AIInteraction baseline (last 24h)

### Email Draft Verification (Step 3)
- `featureId`: `draft.verify.email.step3`
- Total calls: 888
- Total errors: 798

Errors by `source`:
| source | errors | avg latency (ms) | max latency (ms) |
|---|---:|---:|---:|
| `background-job/email-inbound-post-process` | 682 | 19999 | 24060 |
| `action:message.regenerate_draft` | 98 | 20035 | 22463 |
| `null` | 18 | 20230 | 20640 |

Latency distribution (source=`background-job/email-inbound-post-process`):
| status | calls | avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | max (ms) |
|---|---:|---:|---:|---:|---:|---:|
| error | 682 | 19999 | 20128 | 20173 | 20210 | 24060 |
| success | 82 | 17283 | 17557 | 19296 | 19680 | 20020 |

Recent error samples (no payload):
- Error message: `Request timed out.`
- Observed latencies cluster tightly around ~20.1s.

**Interpretation:** The Step 3 verifier is hitting a deterministic ~20s request-timeout cliff, consistent with the call-site timeout cap in `lib/ai-drafts.ts`.

### Signature Context (Drafts)
- `featureId`: `signature.context`

Errors by `source`:
| source | errors | avg latency (ms) | max latency (ms) |
|---|---:|---:|---:|
| `background-job/email-inbound-post-process` | 9 | 4502 | 4505 |
| `null` | 5 | 4505 | 4507 |

Latency distribution (source=`background-job/email-inbound-post-process`):
| status | calls | avg (ms) | p50 (ms) | p90 (ms) | max (ms) |
|---|---:|---:|---:|---:|---:|
| error | 9 | 4502 | 4502 | 4503 | 4505 |
| success | 386 | 2005 | 1784 | 3056 | 4474 |

**Interpretation:** The signature context extractor hits a deterministic ~4.5s timeout cliff, consistent with the call-site cap in `lib/ai-drafts.ts` and the default timeout fallback in `lib/email-signature-context.ts`.

### Follow-up proposed time parsing
- `featureId`: `followup.parse_proposed_times`
- Errors: 3 (source: `background-job/email-inbound-post-process`)

Error samples:
- `Post-process error: hit max_output_tokens (incomplete=max_output_tokens output_types=reasoning)`

**Interpretation:** This is a token budget issue; reasoning tokens consume the output budget before producing the JSON payload. Current `budget.retryMax` exists, but the retry path may not reach it if `OPENAI_PROMPT_MAX_ATTEMPTS` defaults to 2.

### Lead scoring
- `featureId`: `lead_scoring.score`
- Errors (last 24h): 5

Error samples:
- `500 An error occurred while processing your request... request ID req_...`
- `503 upstream connect error or disconnect/reset before headers. reset reason: connection timeout`

**Interpretation:** These look like transient upstream/provider failures. We should handle them via request-level retries (SDK `maxRetries`) rather than multiplying error rows via prompt-runner attempts.

## Vercel baseline
- Production deployment used for log spot-check: `https://zrg-dashboard-irworo8ht-zrg.vercel.app`
- `vercel logs` confirms:
  - `/api/cron/background-jobs` is executing (cron traffic observed).
  - `/api/webhooks/email` is receiving events (payload details intentionally omitted here).

## Environment baseline (Vercel Production)
Pulled via `vercel env pull --environment production` and inspected for non-secret keys only:
- Only `OPENAI_API_KEY` is set under `OPENAI_*`.
- No production env overrides exist for:
  - `OPENAI_TIMEOUT_MS` (OpenAI request timeout)
  - `OPENAI_MAX_RETRIES` (OpenAI SDK retries)
  - `OPENAI_PROMPT_MAX_ATTEMPTS` (prompt-runner attempts)
  - `OPENAI_DRAFT_TIMEOUT_MS`
  - `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS`

Therefore, current behavior is driven by code defaults:
- OpenAI request timeout default: 90,000ms (`lib/ai/openai-telemetry.ts`)
- OpenAI SDK retries default: 5 (`lib/ai/openai-telemetry.ts`)
- Prompt-runner max attempts default: 2 (`lib/ai/prompt-runner/runner.ts`)
- Draft generation default timeout: 120,000ms (`lib/ai-drafts.ts`)

## Key call sites to change in Phase 94b/94c
- Step 3 verifier timeout cap:
  - `lib/ai-drafts.ts` → `runEmailDraftVerificationStep3(...)` call site currently caps at 20,000ms.
- Signature context timeout cap:
  - `lib/ai-drafts.ts` → `extractImportantEmailSignatureContext(...)` call site currently caps at 4,500ms.
  - `lib/email-signature-context.ts` default timeout fallback is 4,500ms.
- Proposed-times truncation:
  - `lib/followup-engine.ts` → `parseProposedTimesFromMessage(...)` needs higher attempt/budget settings so retries reach `retryMax`.
- Cron overlap risk:
  - `app/api/cron/background-jobs/route.ts` currently has no advisory lock (unlike `app/api/cron/availability/route.ts`).

