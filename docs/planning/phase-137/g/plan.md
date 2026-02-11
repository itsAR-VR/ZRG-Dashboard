# Phase 137g — Deep RED TEAM Bug Fix Pass

## Focus
Fix all 14 bugs (3 Critical, 6 High, 5 Medium) discovered by the deep RED TEAM code audit of Phase 137's uncommitted changes. These are real defects in the code already written in 137c-137e that would ship broken behavior if not corrected.

## Inputs
- RED TEAM findings in `docs/planning/phase-137/plan.md` (section: "Deep RED TEAM Code Audit")
- RED TEAM review plan at `~/.claude/plans/encapsulated-rolling-pike.md`
- All files modified in 137c-137e (the code with bugs)

## Work

### Step 1 — Critical Fixes (Must complete first)

#### C1. Deferred Loader Race Condition — Workspace-Crossing State Corruption
- **File:** `components/dashboard/settings-view.tsx`
- **Location:** The deferred loading effect (~lines 1359-1544) and the `isStale()` helper
- **What to do:**
  1. Find the `isStale` closure inside the deferred loading effect
  2. Remove the `activeWorkspaceRef.current !== workspaceId` check
  3. Keep only the `cancelled` flag check: `const isStale = () => cancelled`
  4. The effect cleanup already sets `cancelled = true` on workspace/tab change — this is sufficient
  5. Verify `cancelled` is checked after every `await` in `loadIntegrationsSlice` and `loadBookingSlice`
- **Why this works:** The `cancelled` flag is scoped to the effect closure. When `activeWorkspace` or `activeTab` changes, React runs cleanup (`cancelled = true`) then re-runs the effect with a new `cancelled = false`. Any in-flight async from the old effect sees `cancelled === true` and bails. The `activeWorkspaceRef` was a redundant and fragile second check that introduced a timing dependency.
- **Verification:** After fix, rapidly switch workspaces while on Integrations tab. Confirm settings data always matches the selected workspace.

#### C2. LinkedIn Status Fetch — Runaway Effect Loop
- **File:** `components/dashboard/action-station.tsx`
- **Location:** `fetchLinkedInStatus` useCallback (~lines 436-460) and its calling effect (~lines 462-465)
- **What to do:**
  1. Find the `fetchLinkedInStatus` useCallback
  2. Change its dependency array from `[conversation, activeChannel, hasLinkedIn]` to use only stable primitives: `[conversation?.id, activeChannel, hasLinkedIn]`
  3. Inside the callback body, extract any values needed from `conversation` at the call site (the conversation object is still accessible in the closure — the dep array just controls when the callback reference changes)
  4. In the calling effect, add cleanup:
     ```typescript
     useEffect(() => {
       let cancelled = false
       fetchLinkedInStatus().then(() => {
         // only matters if fetchLinkedInStatus uses the cancelled flag
       })
       return () => { cancelled = true }
     }, [fetchLinkedInStatus])
     ```
  5. Inside `fetchLinkedInStatus`, check the component-level mounted ref or add a cancellation check before each `setLinkedInStatus()` call
- **Why this works:** The `conversation` object reference changes on every message update, but `conversation.id` is a stable primitive that only changes when the user actually switches conversations. This prevents the callback from recreating on every poll cycle.
- **Verification:** Open a conversation with LinkedIn channel. Send/receive messages. Confirm no repeated LinkedIn status fetches in Network tab.

#### C3. Progress Bar ARIA/Visual Mismatch
- **File:** `components/dashboard/crm-drawer.tsx`
- **Location:** Follow-up progress bar rendering (~lines 1519-1535)
- **What to do:**
  1. Find the `role="progressbar"` div
  2. Change the visual width calculation to match ARIA:
     - Current: `style={{ width: \`${(instance.currentStep / Math.max(1, instance.totalSteps)) * 100}%\` }}`
     - New: `style={{ width: \`${(Math.min(instance.currentStep + 1, Math.max(1, instance.totalSteps)) / Math.max(1, instance.totalSteps)) * 100}%\` }}`
  3. This ensures when `currentStep = 0`, both ARIA and visual show the same 1/N progress (first step indicator)
- **Why this works:** ARIA already uses `currentStep + 1` (capped at totalSteps). Making visual match means screen reader and sighted users see the same state.
- **Verification:** Open CRM drawer on a lead with an active follow-up sequence at step 0. Confirm the progress bar shows a non-zero width matching the "1 of N" ARIA announcement.

---

### Step 2 — High Fixes

#### H1. Dynamic Imports Missing Loading Fallbacks
- **File:** `app/page.tsx`
- **Location:** Lines 13-18 (dynamic import declarations)
- **What to do:**
  1. Add a loading fallback to each `dynamic()` call:
     ```typescript
     const InboxView = dynamic(
       () => import("@/components/dashboard/inbox-view").then((mod) => mod.InboxView),
       { loading: () => <div className="flex-1 animate-pulse bg-muted/30 rounded" /> }
     )
     ```
  2. Apply the same pattern to all six dynamic imports (InboxView, CrmView, AnalyticsView, InsightsView, SettingsView, ActionStation or similar)
- **Verification:** Throttle network in DevTools → Slow 3G. Reload page. Confirm shimmer placeholder appears instead of blank screen.

#### H2. Sidebar Image Loader — Passthrough Defeats next/image
- **File:** `components/dashboard/sidebar.tsx`
- **Location:** `passthroughImageLoader` definition and the `<Image>` usage (~lines 227-238)
- **What to do:**
  1. Remove the `passthroughImageLoader` function definition
  2. Remove `loader={passthroughImageLoader}` from the `<Image>` component
  3. Keep `unoptimized` prop (sufficient for external URLs without domain config)
  4. Add a guard to prevent infinite error loop on fallback:
     ```typescript
     const [logoErrored, setLogoErrored] = useState(false)
     // In Image component:
     onError={() => {
       if (!logoErrored) {
         setLogoErrored(true)
         setBrandLogoSrc("/images/zrg-logo-3.png")
       }
     }}
     ```
  5. Reset `logoErrored` when `displayBrandLogoUrl` changes (in the existing effect)
- **Verification:** Set a workspace brand logo to an invalid URL. Confirm fallback appears once without console spam.

#### H3. Unbounded Deferred Slice Cache — Memory Leak
- **File:** `components/dashboard/settings-view.tsx`
- **Location:** `markDeferredSliceLoaded` callback (~lines 727-734)
- **What to do:**
  1. After updating the cache entry, check if cache size exceeds 10:
     ```typescript
     const markDeferredSliceLoaded = useCallback((workspaceId: string, slice: DeferredSettingsSlice) => {
       deferredSliceLoadRef.current[workspaceId] = {
         integrations: deferredSliceLoadRef.current[workspaceId]?.integrations ?? false,
         booking: deferredSliceLoadRef.current[workspaceId]?.booking ?? false,
         [slice]: true,
       }
       // Evict oldest entries if cache exceeds 10 workspaces
       const keys = Object.keys(deferredSliceLoadRef.current)
       if (keys.length > 10) {
         for (const key of keys.slice(0, keys.length - 10)) {
           delete deferredSliceLoadRef.current[key]
         }
       }
     }, [])
     ```
- **Verification:** Not directly testable in short sessions. Code review confirmation sufficient.

#### H4. Workspace Brand Logo Clear — Inconsistent State
- **File:** `components/dashboard/settings-view.tsx`
- **Location:** `handleClearWorkspaceLogo` (~lines 2280-2294)
- **What to do:**
  1. Find `setWorkspaceBrand((prev) => ({ ...prev, brandLogoUrl: "" }))`
  2. Change `""` to `null`: `setWorkspaceBrand((prev) => ({ ...prev, brandLogoUrl: null }))`
  3. Verify `settings.brandLogoUrl` is also set to `null` (already is)
  4. Confirm downstream code handles `null` in brandLogoUrl (check truthiness checks, not `=== ""`)
- **Verification:** Upload a workspace logo. Clear it. Confirm sidebar updates and no console errors.

#### H5. File Upload MIME Type Validation — Magic Bytes
- **File:** `actions/settings-actions.ts`
- **Location:** `uploadWorkspaceBrandLogo` function (~lines 1072-1078)
- **What to do:**
  1. After `const bytes = Buffer.from(await file.arrayBuffer())`, add magic-byte validation:
     ```typescript
     function validateImageMagicBytes(bytes: Buffer): boolean {
       if (bytes.length < 12) return false
       // PNG: 89 50 4E 47
       if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true
       // JPEG: FF D8 FF
       if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true
       // WebP: RIFF....WEBP
       if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
           bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true
       return false
     }
     ```
  2. Call it after buffer creation, before upload:
     ```typescript
     if (!validateImageMagicBytes(bytes)) {
       return { success: false, error: "File does not appear to be a valid image. Use PNG, JPG, or WebP." }
     }
     ```
- **Verification:** Rename a .txt file to .png and try uploading. Should be rejected.

#### H6. LinkedIn Status Effect — No Cleanup on Unmount
- **File:** `components/dashboard/action-station.tsx`
- **Location:** The effect calling `fetchLinkedInStatus` (~lines 462-465)
- **What to do:**
  1. This is largely addressed by the C2 fix (adding `let cancelled = false` + cleanup)
  2. Ensure the cleanup function exists: `return () => { cancelled = true }`
  3. Inside `fetchLinkedInStatus`, add a check before each state setter:
     - Pass `cancelled` as a parameter or use a component-level ref
     - Before `setLinkedInStatus(...)`, check `if (cancelled) return`
- **Note:** May be combined with C2 implementation — same effect, same callback.
- **Verification:** Rapidly switch between conversations with/without LinkedIn. No console warnings about unmounted state updates.

---

### Step 3 — Medium Fixes

#### M1. Inbox Conversation Fetch — AbortController
- **File:** `components/dashboard/inbox-view.tsx`
- **Location:** The conversation fetch function (~lines 420-427)
- **What to do:**
  1. Create an `AbortController` at the start of the fetch effect
  2. Pass `controller.signal` to the fetch if the underlying function supports it (check `getConversation` signature)
  3. If `getConversation` is a server action (doesn't support signal), keep the current stale-response guard as-is. The AbortController only helps for native fetch calls.
  4. If it IS a native fetch: `return () => controller.abort()` in the cleanup
- **Note:** If `getConversation` is a Next.js server action, AbortController won't work. In that case, the existing `activeConversationRequestRef` guard is sufficient. Just verify the guard covers all state update paths.
- **Verification:** Check whether `getConversation` is a server action or fetch call. Apply the appropriate fix.

#### M2. SR-Only Live Region — Debounce
- **File:** `components/dashboard/inbox-view.tsx`
- **Location:** The sr-only live region div (~lines 1004-1008)
- **What to do:**
  1. Separate the live region into meaningful-only announcements:
     ```typescript
     <div className="sr-only" role="status" aria-live="polite">
       {newConversationCount > 0 ? `${newConversationCount} new conversations available.` : ""}
     </div>
     ```
  2. Remove the `isFetching` and `isLive` status from the live region (these change too frequently)
  3. If connection status announcements are important, use a separate region with `aria-live="off"` or a manual trigger
- **Verification:** Use a screen reader (VoiceOver on Mac). Navigate inbox. Confirm no rapid-fire announcements during polling.

#### M3. useLayoutEffect to useEffect — Verify
- **File:** `components/dashboard/insights-chat-sheet.tsx`
- **Location:** Workspace reset effect (~line 983)
- **What to do:**
  1. Manually test: switch workspaces in the Insights view
  2. Look for any brief flash of old workspace data
  3. If flickering observed: revert `useEffect` back to `useLayoutEffect`
  4. If no flickering: keep as `useEffect` (better for SSR compatibility)
- **Verification:** Visual inspection during workspace transition. No code change needed unless flickering is observed.

#### M4. Campaign Row Keyboard — Double-Toggle Guard
- **File:** `components/dashboard/insights-chat-sheet.tsx`
- **Location:** Campaign row + checkbox handlers (~lines 652-677)
- **What to do:**
  1. In the checkbox's `onChange` handler, add keyboard event propagation stop:
     ```typescript
     <input
       type="checkbox"
       checked={checked}
       onClick={(event) => event.stopPropagation()}
       onKeyDown={(event) => event.stopPropagation()}  // ADD THIS
       onChange={(event) => {
         event.stopPropagation()
         toggleSelection()
       }}
     />
     ```
  2. This ensures that when the checkbox is focused and Space is pressed, only the checkbox handler fires (not the row handler)
- **Verification:** Tab to a campaign checkbox. Press Space. Confirm it toggles once (not twice).

#### M5. Legacy Knowledge Assets — aiContextMode Backfill
- **After `npm run db:push`**, run this SQL against the database:
  ```sql
  UPDATE "KnowledgeAsset" SET "aiContextMode" = 'notes' WHERE "aiContextMode" IS NULL;
  ```
- This ensures existing records match the schema default for new records.
- **Verification:** Query `SELECT COUNT(*) FROM "KnowledgeAsset" WHERE "aiContextMode" IS NULL` — should return 0.

---

### Step 4 — Verification Gate

After all fixes are applied:

1. `npm run lint` — must pass with 0 errors
2. `npm run build` — must succeed
3. `npm run db:push` — push schema if not already done
4. Run M5 backfill SQL
5. Targeted manual testing:
   - **C1 test:** Rapid workspace switching in Settings while on Integrations/Booking tab. Data must match selected workspace.
   - **C2 test:** Open active LinkedIn conversation. Send messages. Check Network tab — no runaway status fetches.
   - **C3 test:** CRM drawer on lead with follow-up at step 0. Progress bar shows non-zero width.
   - **H1 test:** Throttle network → Slow 3G. Reload. Shimmer placeholder appears.
   - **H2 test:** Set invalid workspace logo URL. Fallback appears once, no console spam.
   - **H4 test:** Upload logo, clear it, sidebar reflects change.
   - **H5 test:** Rename .txt to .png, upload. Server rejects.
   - **M4 test:** Tab to campaign checkbox, press Space. Toggles once.

---

## Files to Modify

| File | Issues Fixed |
|------|-------------|
| `components/dashboard/settings-view.tsx` | C1, H3, H4 |
| `components/dashboard/action-station.tsx` | C2, H6 |
| `components/dashboard/crm-drawer.tsx` | C3 |
| `app/page.tsx` | H1 |
| `components/dashboard/sidebar.tsx` | H2 |
| `actions/settings-actions.ts` | H5 |
| `components/dashboard/inbox-view.tsx` | M1, M2 |
| `components/dashboard/insights-chat-sheet.tsx` | M3, M4 |

## Output
- Implemented code fixes for:
  - **C1** in `components/dashboard/settings-view.tsx` (deferred loader staleness now cancellation-based)
  - **C2/H6** in `components/dashboard/action-station.tsx` (stable callback deps + effect cleanup + cancellation-safe setters)
  - **C3** in `components/dashboard/crm-drawer.tsx` (ARIA/visual progress width parity)
  - **H1** in `app/page.tsx` (dynamic import loading fallbacks for all dashboard views)
  - **H2** in `components/dashboard/sidebar.tsx` (removed passthrough loader; added fallback-loop guard)
  - **H3/H4** in `components/dashboard/settings-view.tsx` (bounded deferred cache + null-safe logo clear state)
  - **H5** in `actions/settings-actions.ts` (server-side image magic-byte validation for workspace logo uploads)
  - **M2** in `components/dashboard/inbox-view.tsx` (SR-only live region reduced to meaningful new-conversation announcements)
  - **M4** in `components/dashboard/insights-chat-sheet.tsx` (checkbox keyboard propagation guard to prevent double-toggle)
- Confirmed **M1** remains intentionally handled by stale-response guards in `components/dashboard/inbox-view.tsx` because `getConversation` is a server action (AbortController does not apply).
- Added a minimal cross-phase compile-stability fix in `lib/background-jobs/email-inbound-post-process.ts` (typed fallback context + narrow) after multi-agent backend drift caused TypeScript build failures during 137 validation.
- Validation status:
  - `npm run lint` passes (0 errors, 15 warnings).
  - `npm run build -- --webpack` passes after resolving concurrent type errors and rerunning from a clean `.next` state.
- Remaining manual verification items (deferred to 137f execution packet):
  - **M3:** visual flicker check for workspace switch in Insights sheet.
  - targeted authenticated runtime checks for C1/C2/C3/H2/H4/H5 scenarios.
  - DB-side **M5** backfill (`aiContextMode`) once owning schema flow confirms `db:push` order.

## Handoff
- 137g code-remediation pass is complete; proceed with 137f final verification packet:
  - run authenticated checklist scenarios A1-A3, B1-B3, C1-C3 with screenshots and operator notes
  - explicitly execute M3 workspace-switch visual verification in Insights and document outcome
  - confirm M5 backfill execution timing with active schema phases, then run SQL and record row-count proof
  - finalize rollout go/no-go decision in 137f based on evidence, not just lint/build

## Coordination Notes
- **Backend overlap occurred during verification only:** `lib/background-jobs/email-inbound-post-process.ts` required a minimal type-safe correction because active backend phases introduced union drift that blocked `next build`.
- Applied fix was surgical and non-behavioral for auto-booking flow control; it restores compile stability while preserving existing logic.
- **Cross-phase merge order remains:** 137 → 140 → 138 → 139
- **Schema note:** M5 backfill must happen after `npm run db:push` for the Phase 137 schema changes.

## Validation (RED TEAM)
- Multi-agent preflight:
  - `git status --short` (dirty tree confirmed; scoped edits kept to 137g targets + one compile-stability backend file)
  - `ls -dt docs/planning/phase-* | head -10` (phases 138/139/140 active)
- Automated checks:
  - `npm run lint` — pass (0 errors, 15 warnings)
  - `npm run build -- --webpack` — pass
- Deep spot checks:
  - Verified unresolved-item audit with parallel explorer agents (settings/actions, action-station/crm-drawer, shell/inbox/insights)
  - Confirmed C2/C3/H6/H1/H2/H5/M2/M4 were unresolved before patch and closed after patch
  - Confirmed M1 handled by server-action stale guard semantics (no AbortController path available)

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed remaining 137g code fixes across dashboard shell, settings, inbox, insights, CRM drawer, and action station.
  - Added server-side magic-byte validation for workspace brand logo uploads.
  - Stabilized LinkedIn status effect to avoid runaway re-fetches and unmounted-state updates.
  - Applied one minimal backend type compatibility fix required to unblock build verification.
  - Revalidated lint/build after all patches.
- Commands run:
  - `git status --short` — pass (multi-agent dirty tree confirmed).
  - `ls -dt docs/planning/phase-* | head -10` — pass (active phase overlap scan).
  - `npm run lint` — pass (0 errors, 15 warnings).
  - `npm run build -- --webpack` — pass after compile-stability fixes.
  - targeted `rg`/`sed`/`nl` scans — pass (line-anchored verification before and after patches).
- Blockers:
  - Authenticated/manual verification evidence (M3 + scenario checklist) remains pending and must be completed in 137f.
  - DB-side M5 backfill execution requires schema-sequence confirmation with active backend phases.
- Next concrete steps:
  - Run 137f authenticated checklist and attach evidence.
  - Execute M5 backfill at the correct migration point and capture proof query.
  - Close 137f with rollout decision once evidence is complete.
