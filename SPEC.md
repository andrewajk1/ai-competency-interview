# SPEC: Claims list & submission flow reliability (backlog item 1)

**Status:** Approved (2026-10-26; all ASSUMED decisions accepted as written)

## Goal
The claims list never shows "No claims found" when the real cause is a failure. Every submit or status update
either changes the claim and shows the change, or tells the user why it didn't.

Root causes (reproduced with curl against the running app, 2026-10-26):
1. **The list swallows errors.** `ClaimList` ignores `res.ok` and does `.catch(() => {})`. A backend error or restart therefore renders as "No claims found".
2. **Every valid status change commits, then returns 500.** The route reads `updated_at` after the commit without a refresh (`MissingGreenlet`, routes.py:100).
3. **The route's own transition table rejects PENDING→REJECTED.** It doesn't use `ClaimService.VALID_TRANSITIONS`, so the "Reject Claim" button returns 400 and nothing changes.
4. **An unknown procedure code returns 500.** `KeyError` in `ValidationService`.
5. **Submit and status update ignore the server's error.** `SubmitClaim` reads `detail.message`, a field that never exists. `ClaimDetail` never checks the PATCH response.

## Interface

### Backend (`src/api/routes.py`, `src/services/validation_service.py`)
```python
# PATCH /api/claims/{claim_id}/status?practice_id=…   body: {"status": "<ClaimStatus>"}
#   200 -> Claim.to_dict()                       (status changed, committed)
#   400 -> {"detail": "Cannot transition from 'pending' to 'accepted'"}   (nothing changed)
#   404 -> {"detail": "Not found"}               (unknown id or other practice)
#   The route delegates to ClaimService.transition_status (the one transition table).

# POST /api/claims  (unchanged shape)
#   422 -> {"detail": {"validation_errors": ["Procedure D9999: unknown procedure code", ...]}}

class ValidationService:
    def validate_claim(self, procedures: list[dict]) -> list[str]: ...  # never raises for an unknown code
```

### Frontend
- `ClaimList`: renders exactly one of these states: loading, error (banner + Retry), empty, or table.
- `SubmitClaim`: shows the server's error text. On success it navigates to `/`, which shows a success banner and the refetched list.
- `ClaimDetail`: checks the PATCH response. On 2xx it renders the returned claim. Otherwise it shows the server's `detail` in an error banner.
  A failed initial load (e.g. 404) shows an error and does not crash.
- New shared helper `frontend/src/api/errors.ts`:
  ```ts
  export async function errorMessage(res: Response): Promise<string>
  ```

## Examples (test oracle, worked by hand)

Seed state for the backend examples: one payer. Claim A is `pending`, Claim B is `validated`, Claim C is `accepted`, all in `practice-1`.
Max amounts come from `data/procedure_codes.json`: D0120 = 75.00, D7210 = 350.00.

| # | Input | Expected | Why |
|---|---|---|---|
| E1 | PATCH B `{"status":"accepted"}` | 200, body `status == "accepted"`; then GET list shows B `accepted` | VALIDATED→ACCEPTED is allowed (ARCHITECTURE table). |
| E2 | PATCH A `{"status":"rejected"}` | 200, body `status == "rejected"` | PENDING→REJECTED is allowed (ARCHITECTURE). Today the route returns 400. |
| E3 | PATCH A `{"status":"validated"}` | 200, body `status == "validated"` | PENDING→VALIDATED is allowed. |
| E4 (error) | PATCH A `{"status":"accepted"}` | 400, detail `"Cannot transition from 'pending' to 'accepted'"`; A still `pending` | PENDING→ACCEPTED is not in the table. |
| E5 (error) | PATCH C `{"status":"rejected"}` | 400, detail `"Cannot transition from 'accepted' to 'rejected'"`; C still `accepted` | ACCEPTED is terminal. |
| E6 (error) | PATCH B with `practice_id=practice-2` | 404 `"Not found"`; B still `validated` | Practice scoping. |
| E7 (error) | PATCH id 9999 | 404 | No such claim. |
| E8 (error) | POST procedures `[{"code":"D9999","amount":10}]` | 422, `validation_errors == ["Procedure D9999: unknown procedure code"]`; list total unchanged | Unknown code: a validation error, not a 500. |
| E9 (error) | POST `[{"code":"d0120","amount":50}]` | 422, `["Procedure d0120: unknown procedure code"]` | Codes match exactly; no case folding (D4). |
| E10 (boundary) | POST `[{"code":"D0120","amount":75.00}]` | 200, status `pending` | 75.00 ≤ max 75.00, so the max is inclusive. |
| E11 (boundary) | POST `[{"code":"D0120","amount":75.01}]` | 422, `["Procedure D0120: amount $75.01 exceeds maximum $75.00"]` | 75.01 > 75.00. |
| E12 (error) | POST `[{"code":"D9999","amount":10},{"code":"D7210","amount":400}]` | 422, errors in input order: `["Procedure D9999: unknown procedure code", "Procedure D7210: amount $400.00 exceeds maximum $350.00"]` | All problems are reported; the unknown code doesn't stop the check. |
| E13 | POST valid claim, then GET list | list `total` = previous + 1; the new claim is in `claims` | The list reflects writes immediately. |

Frontend examples (fetch is mocked; the error-text rules are D6/D7):

| # | Input | Expected |
|---|---|---|
| F1 (error) | List GET → 500, empty `text/plain` body | Banner "Couldn't load claims (HTTP 500)." + **Retry** button; "No claims found" is **not** shown |
| F2 (error) | List GET → fetch rejects (network down) | Banner "Couldn't load claims (network error)." + Retry |
| F3 | List GET → 200 `{"claims":[],"total":0}` | "No claims yet." + link "Submit a claim" → `/submit`; no error banner |
| F4 | F1, then click Retry → 200 with one claim "Alice" | The banner disappears and the "Alice" row is shown |
| F5 | List GET → 200 with 2 claims | 2 rows; neither the empty text nor the error banner is shown |
| F6 (error) | Submit → 422 `{"detail":{"validation_errors":["A","B"]}}` | Error banner contains "A" and "B"; the form keeps its values |
| F7 (error) | Submit → 422 `{"detail":[{"loc":["body","payer_id"],"msg":"Input should be a valid integer"}]}` | Error banner "payer_id: Input should be a valid integer" |
| F8 (error) | Submit → 500 with `text/plain` "Internal Server Error" | Error banner "Server error (HTTP 500)" |
| F9 | Submit → 200 | Navigates to `/`; banner "Claim submitted successfully" |
| F10 (error) | Detail: PATCH → 400 `{"detail":"Cannot transition from 'pending' to 'accepted'"}` | Error banner with exactly that text; the status badge is unchanged |
| F11 | Detail: PATCH → 200 with the claim in status `rejected` | Badge shows `rejected` (taken from the response body) |
| F12 (error) | Detail: GET → 404 `{"detail":"Not found"}` | "Claim not found." is shown; no crash |

## Requirements
**Backend**
- **R1**: WHEN a status PATCH requests an allowed transition, THE SYSTEM SHALL commit it and respond 200 with the updated claim. (E1–E3)
- **R2**: THE SYSTEM SHALL decide allowed transitions from the single table in `ClaimService`:
  PENDING→{VALIDATED, REJECTED}; VALIDATED→{ACCEPTED, REJECTED}; ACCEPTED and REJECTED are terminal. (E1–E5)
- **R3**: IF a requested transition is not allowed, THEN THE SYSTEM SHALL respond 400 with detail `Cannot transition from '<from>' to '<to>'` and leave the claim unchanged. (E4, E5)
- **R4**: IF the claim doesn't exist in the caller's practice, THEN THE SYSTEM SHALL respond 404 and change nothing. (E6, E7)
- **R5**: IF a submitted procedure code is not in the allowed code set, THEN THE SYSTEM SHALL respond 422 with
  `Procedure <code>: unknown procedure code` in `validation_errors` and persist nothing. (E8, E9, E12)
- **R6**: THE SYSTEM SHALL report every validation error on a claim, in procedure input order. (E12)
- **R7**: WHEN a claim is created or updated, THE SYSTEM SHALL include the change in the next list response. (E1, E13)

**Frontend**
- **R8**: WHILE the list request is in flight, THE SYSTEM SHALL show a loading indicator and not the empty state.
- **R9**: IF the list request fails (non-2xx or network error), THEN THE SYSTEM SHALL show an error banner naming the cause and a Retry action, and SHALL NOT show the empty state. (F1, F2, F4)
- **R10**: WHEN the list loads successfully with zero claims, THE SYSTEM SHALL show an empty state that links to Submit. (F3)
- **R11**: IF a submit fails, THEN THE SYSTEM SHALL show the server's error text (D6) and keep the form's values. (F6–F8)
- **R12**: WHEN a submit succeeds, THE SYSTEM SHALL navigate to the claims list and show a success message. (F9)
- **R13**: IF a status update fails, THEN THE SYSTEM SHALL show the server's `detail` and keep the displayed status. (F10)
- **R14**: WHEN a status update succeeds, THE SYSTEM SHALL display the claim returned by the server. (F11)
- **R15**: IF the claim detail fails to load, THEN THE SYSTEM SHALL show an error ("Claim not found." for a 404) instead of crashing. (F12)

## Decisions
| # | Question | Decision | Status |
|---|---|---|---|
| D1 | Fix order | Backend first (R1–R7), then frontend. If the frontend checked `res.ok` while the PATCH still returned 500, users would see errors for changes that actually saved. | Accepted |
| D2 | Where the transition table lives | It lives only in `ClaimService.VALID_TRANSITIONS`. The route calls `transition_status`, which already refreshes after commit, and maps `InvalidStatusTransitionError` to 400. The route's duplicate table is deleted. | Accepted |
| D3 | 400 detail text | Use the service exception's message, `Cannot transition from 'x' to 'y'`, instead of the vaguer "Invalid status transition". | Accepted |
| D4 | Procedure-code case and whitespace | Codes must match exactly, so `d0120` is unknown (422). The frontend does not normalize codes. | Accepted |
| D5 | Max-amount boundary | Inclusive: amount == max is valid. This matches the existing `>` check. | Accepted |
| D6 | Error text shown to users | `validation_errors` list → each item on its own line. Pydantic `detail` array → `<last loc>: <msg>`, one per line. String `detail` → as-is. Non-JSON body or anything else → `Server error (HTTP <code>)`. | Accepted |
| D7 | List error copy | Non-2xx: `Couldn't load claims (HTTP <code>).` Network failure: `Couldn't load claims (network error).` Each has a Retry button. | Accepted |
| D8 | After a successful submit | Navigate to `/` with a router-state flash "Claim submitted successfully". The list refetches on mount, so the new claim appears. | Accepted |
| D9 | Frontend test tooling | Add dev deps `vitest`, `jsdom` and `@testing-library/react`, and a `"test": "vitest run"` script (run with `pnpm --ignore-workspace test`). This changes `package.json` and `pnpm-lock.yaml`. | Accepted |
| D10 | Backend API tests | Use `httpx.AsyncClient(transport=ASGITransport(app))` against an in-memory SQLite DB (`StaticPool`), with `get_session` overridden. Each request gets a fresh session, as in production, so the expired-attribute bug reproduces. | Accepted |
| D11 | Money | Out of scope for this item. No new money arithmetic is added; existing float fields are left untouched. | Accepted |

## Out of scope
- VALIDATED→PENDING (backlog item 4), a Validate button, void/restore, pagination, filtering.
- Checking that the payer exists (`payer_id=999` is still accepted) and checking `total_amount` against the procedure sum. Both are real gaps; they belong in a later spec.
- Delete's 403-vs-404 response and the relative `claims.db` path (documented in CLAUDE.md).
- Converting money from float to `Decimal`/cents.
- Repo-wide ruff cleanup. Only touched files are linted.

## Tasks
- [ ] T1: API test harness (`tests/conftest.py` client fixture + seed of A/B/C) and failing tests for E1–E7 — verify: `uv run pytest -q tests/test_api_claims.py`
- [ ] T2: Status route delegates to `ClaimService.transition_status`; 400/404 mapping (R1–R4) — verify: `uv run pytest -q`
- [ ] T3: Unknown code → validation error, all errors in input order (R5, R6; E8–E12) — verify: `uv run pytest -q`
- [ ] T4: List reflects writes (R7; E13) — verify: `uv run pytest -q`
- [ ] T5: Frontend test tooling (D9) + `errorMessage` helper with unit tests (D6) — verify: `pnpm --ignore-workspace test`
- [ ] T6: `ClaimList` loading/error/retry/empty states (R8–R10; F1–F5) — verify: `pnpm --ignore-workspace test && pnpm --ignore-workspace exec tsc`
- [ ] T7: `SubmitClaim` server errors + navigate on success (R11, R12; F6–F9) — verify: same
- [ ] T8: `ClaimDetail` PATCH handling + load errors (R13–R15; F10–F12) — verify: same
- [ ] T9: Full run: `uv run pytest -q`, `uv run ruff check <touched>`, frontend tests + tsc, manual smoke test through the browser or curl via :5173
