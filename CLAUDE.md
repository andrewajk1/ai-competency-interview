# ai-competency-interview — dental claim processing

The working agreement (spec first, tests locked, small steps) lives in `../CLAUDE.md`.
This file covers repo-specific commands, structure and known defects.

Task brief: `Full Stack Tasks.md` (backlog). Docs: `README.md`, `ARCHITECTURE.md`. The docs use camelCase field
names (`patientName`, `totalAmount`); the code and API use snake_case. **Trust the code.**

## Commands (run from the repo root)
- Backend: Python 3.13, `uv`. Tests: `uv run pytest -q`. Lint/format: `uv run ruff check . && uv run ruff format .` (ruff + isort rules configured in `pyproject.toml`).
  Baseline (2026-10-26): 9 tests pass. `ruff check` reports 24 existing errors and `ruff format --check` would reformat 8 files.
  **Lint and format only the files you touch** (`uv run ruff check <files>`, `uv run ruff format <files>`), so diffs don't fill with unrelated reformatting.
- Frontend (`frontend/`): Node 20, `pnpm` 9.15. The **only** scripts are `dev`, `build` (`tsc && vite build`), `preview`.
  There are no frontend tests, no lint and no `typecheck` script.
  - **Every pnpm command needs `--ignore-workspace`.** `frontend/pnpm-workspace.yaml` has only `allowBuilds` (a newer-pnpm key) and no `packages`,
    so pnpm 9.15 fails with "packages field missing or empty". Don't edit that file: it is part of the candidate repo.
  - Commands: `pnpm --ignore-workspace install --frozen-lockfile` · `pnpm --ignore-workspace exec tsc` (type-check; tsconfig sets `noEmit`)
    · `pnpm --ignore-workspace build` · `pnpm --ignore-workspace dev`.
- Run: `uv run uvicorn src.app:app --reload` (:8000, `/docs`) + `pnpm --ignore-workspace dev` in `frontend/` (:5173, proxies `/api` → :8000).
  Before starting a server, check the port is free (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). A dev server may already be running.
- Data: `uv run python scripts/reset.py` deletes `claims.db` and reseeds (practice `practice-1`, payers 1–3, 5 claims).
  `scripts/seed.py` alone is **not** idempotent (unique `payer_code`).
- Money: integer cents or `Decimal`, never `float`. **Conflict:** the existing code is float end to end (SQLA `Float`
  columns, Pydantic `float`, JS `parseFloat`). Record a decision in SPEC.md before touching money: convert at the boundaries, or contain float to legacy code.

## Entry points
- Backend `src/app.py`: a FastAPI `app`. Its lifespan runs `init_db()` → `Base.metadata.create_all`.
  **No migrations.** A new column will not reach an existing `claims.db`, so run `scripts/reset.py` after model changes.
- DB `src/common/db.py`: SQLite `./claims.db`, relative to the CWD. Async SQLAlchemy with `expire_on_commit=False`.
  `get_session` is the FastAPI dependency.
- Routes `src/api/routes.py`: every route lives here, prefix `/api`, and every route takes a `practice_id` query param (the tenant).
- Services: `src/services/claim_service.py` (queries, create, `transition_status`, delete) and
  `src/services/validation_service.py` (loads `data/procedure_codes.json` and checks code and max amount).
- Models `src/models/`: `Claim` (+ `ClaimStatus` str enum), `Procedure`, `Payer`. Each has `to_dict()`, which is the API response shape.
- Frontend `frontend/src/main.tsx` → `App.tsx` routes: `/` `ClaimList`, `/submit` `SubmitClaim`, `/claims/:id` `ClaimDetail`.
  Shared types are in `types/api.ts`. Styles are inline CSS in `frontend/index.html` (`.status-*`, `.error-banner`, `.success-banner`).
  `PRACTICE_ID = "practice-1"` is hard-coded in each page. There is no API client layer: each page calls raw `fetch`.
- Tests `tests/`: **service-level only** (in-memory SQLite fixtures in `conftest.py`). There are no route/HTTP tests yet.
  `httpx` is installed, so new API tests can use `httpx.AsyncClient(transport=ASGITransport(app))` with `get_session` overridden.

## Critical paths and known defects (found by reading the code; not yet verified by running)
- **Submit** (`POST /api/claims`, routes.py:57):
  - An unknown procedure code raises `KeyError` → 500 (`validation_service.py:14`). ARCHITECTURE says an unknown code should mean reject.
  - `total_amount` comes from the client and is never checked against the sum of the procedures.
  - The claim is always created as `PENDING`.
  - `SubmitClaim.tsx` reads `data.detail?.message`, but the backend sends `detail.validation_errors` (a list) or Pydantic's `detail` array.
    The user therefore always sees the generic error.
  - Payer is a free-text ID and there is no payers endpoint. The form does not send `description`.
- **Status transition** (`PATCH /claims/{id}/status`, routes.py:77):
  - The route has **its own** transition table (routes.py:89). It does not call `ClaimService.transition_status`, and its table differs:
    the route lacks PENDING→REJECTED, while the service has it.
  - Neither table has VALIDATED→PENDING (a backlog item).
  - **Confirmed:** every valid transition **commits, then returns 500**. `MissingGreenlet` is raised at routes.py:100,
    where `to_dict()` reads the expired `updated_at` because the route never refreshes the claim. Fix this before any frontend code starts checking `res.ok`.
  - In `ClaimDetail.tsx`, the local `ClaimStatus` enum has no VALIDATED value, and the "Reject Claim" button on a pending claim gets a 400 from the route.
    The PATCH response is never checked.
- **List** (`GET /claims`):
  - It returns every row and computes `total = len(claims)`, so there is no pagination.
  - `ClaimList.tsx` ignores `res.ok` and swallows errors with `.catch(() => {})`. A failure therefore looks like "No claims found".
    So does a fresh, unseeded DB. **Confirmed:** with the backend down or restarting (`--reload`), the Vite proxy returns 500
    with an empty `text/plain` body, `res.json()` throws, and the error is swallowed.
  - `claims.db` is resolved relative to the CWD, so starting uvicorn from anywhere but the repo root silently creates an empty DB.
  - There are no cache headers, and the list always reflects writes immediately (verified with curl). Stale-looking data comes from writes that fail silently.
  - The list fetches once on mount.
- **Detail**: it shows `payer_id`, not the payer name. A 404 or error body is passed to `setClaim`, which makes the render crash on `.toFixed`.
- **Delete** (routes.py:103):
  - It uses `get_claim_unrestricted`, so another practice's claim returns 403 instead of 404, which leaks that the claim exists.
  - The claim is loaded without procedures, so the cascade delete may lazy-load in async. Verify this.
  - There is no delete button in the UI.
- **Void/restore procedures**: the README documents `PATCH /api/procedures/{id}` and `POST /api/procedures/{id}/restore`,
  but **neither exists**. `Procedure` has no `voided` column. Settle these in the spec first:
  - Does voiding change `total_amount`? (Rule: total = sum of procedures.)
  - Which claim statuses allow voiding?
  - How is practice scoping enforced? (Through the claim join.)
- **Transition rules (ARCHITECTURE.md)**: PENDING→{VALIDATED, REJECTED}; VALIDATED→{ACCEPTED, REJECTED, PENDING}.
  ACCEPTED and REJECTED are terminal.

## ARCHITECTURE.md vs the code
ARCHITECTURE.md is the documented intent, so treat it as the requirements baseline. It drifts from the code in these places;
when a task touches one of them, resolve it in SPEC.md Decisions rather than silently picking a side.

| ARCHITECTURE.md says | Code does |
|---|---|
| Fields `patientName`, `totalAmount`, `claimId`, `payerCode`; `totalAmount: float` | snake_case everywhere (`patient_name`, `total_amount`, …). The float type is real, but our rule says no float money. |
| PENDING→VALIDATED requires every code to be known and within its max; PENDING→REJECTED happens when any code fails | Validation runs **only at submit**, and a failing claim is refused with 422 and **never persisted**. So a stored claim can never "fail validation", and PENDING→REJECTED is unreachable by that rule. The PATCH to `validated` is a manual trigger that **does not re-run validation**. |
| Status flow: the route checks the transition | True, but the route keeps its own table, which drifts from `ClaimService.VALID_TRANSITIONS`. The service table is unused by the API (only the tests use it). Pick **one** source of truth (the service) when touching transitions. |
| VALIDATED→PENDING is a documented rule, "not yet implemented" | Missing from both tables. It is a backlog item. |
| `totalAmount` = sum of procedure amounts and "must stay consistent with the procedures attached" | The client sends the total and the server stores it unchecked. This rule decides void/restore: the total must exclude voided procedures, or be recomputed whenever a procedure is voided or restored. |
| `updated_at` changes on every write | It changes only when the `claims` row itself is updated. Voiding a procedure will not bump the claim's `updated_at` unless the code does so explicitly. |
| Practice scoping is enforced at the query level "for all standard operations" | `get_claim_unrestricted` bypasses it, and delete uses it (403 instead of 404). |
| The validation service checks that each code exists; it loads the code file "at initialization" | An unknown code raises `KeyError` → 500. The service is constructed **per request**, so the file is re-read on every submit. |
| Each claim is associated with a payer | `payer_id` is never checked. SQLite does not enforce foreign keys by default (no `PRAGMA foreign_keys=ON`), so `payer_id=999` is stored. There is also no payers API, so the UI cannot show payer names. |
| Domain exception types live in `exceptions.py` | `ClaimNotFoundError` and `ClaimValidationError` are never raised. `routes.py` imports `ClaimValidationError` and `InvalidStatusTransitionError` but uses neither. |
| ClaimDetail has "status update controls" | Partial: there is no Validate button, so pending claims are stuck in the UI. The Reject button on a pending claim gets a 400. |
| Not documented | Procedure void/restore (only in the README; the endpoints do not exist), pagination, filtering, and any payer endpoint. |

## Conventions
- Backend: thin routes call a service, which takes an `AsyncSession` in its constructor. Domain exceptions live in `src/common/exceptions.py`, but routes mostly raise `HTTPException` directly.
- Every query must filter by `practice_id`.
- Frontend: the patterns in `SubmitClaim.tsx` are the intended reference (`isSubmitting`/`error`/`success` state and banners).
