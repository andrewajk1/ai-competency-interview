"""API tests for SPEC.md backlog item 1. Expected values are the hand-worked examples E1–E13."""

import httpx

from tests.conftest import SeededClaims

P = {"practice_id": "practice-1"}


async def patch_status(client: httpx.AsyncClient, claim_id: int, status: str, practice: str = "practice-1"):
    return await client.patch(
        f"/api/claims/{claim_id}/status", params={"practice_id": practice}, json={"status": status}
    )


async def status_of(client: httpx.AsyncClient, claim_id: int) -> str:
    res = await client.get(f"/api/claims/{claim_id}", params=P)
    return res.json()["status"]


def claim_body(procedures: list[dict], patient: str = "New Patient") -> dict:
    return {
        "practice_id": "practice-1",
        "patient_name": patient,
        "payer_id": 1,
        "procedures": procedures,
        "total_amount": sum(p["amount"] for p in procedures),
    }


# --- Status transitions (R1–R4, R7) ---


async def test_r1_r7_e1_validated_to_accepted_returns_200_and_list_reflects_it(
    client: httpx.AsyncClient, seeded: SeededClaims
) -> None:
    res = await patch_status(client, seeded.validated, "accepted")
    assert res.status_code == 200
    assert res.json()["status"] == "accepted"

    listed = (await client.get("/api/claims", params=P)).json()["claims"]
    assert {c["id"]: c["status"] for c in listed}[seeded.validated] == "accepted"


async def test_r1_r2_e2_pending_to_rejected_is_allowed(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await patch_status(client, seeded.pending, "rejected")
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


async def test_r1_r2_e3_pending_to_validated_is_allowed(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await patch_status(client, seeded.pending, "validated")
    assert res.status_code == 200
    assert res.json()["status"] == "validated"


async def test_r3_e4_pending_to_accepted_is_400_and_unchanged(
    client: httpx.AsyncClient, seeded: SeededClaims
) -> None:
    res = await patch_status(client, seeded.pending, "accepted")
    assert res.status_code == 400
    assert res.json() == {"detail": "Cannot transition from 'pending' to 'accepted'"}
    assert await status_of(client, seeded.pending) == "pending"


async def test_r3_e5_accepted_is_terminal(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await patch_status(client, seeded.accepted, "rejected")
    assert res.status_code == 400
    assert res.json() == {"detail": "Cannot transition from 'accepted' to 'rejected'"}
    assert await status_of(client, seeded.accepted) == "accepted"


async def test_r4_e6_other_practice_gets_404_and_nothing_changes(
    client: httpx.AsyncClient, seeded: SeededClaims
) -> None:
    res = await patch_status(client, seeded.validated, "accepted", practice="practice-2")
    assert res.status_code == 404
    assert res.json() == {"detail": "Not found"}
    assert await status_of(client, seeded.validated) == "validated"


async def test_r4_e7_unknown_claim_is_404(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await patch_status(client, 9999, "accepted")
    assert res.status_code == 404


# --- Submission validation (R5, R6, R7) ---


async def list_total(client: httpx.AsyncClient) -> int:
    return (await client.get("/api/claims", params=P)).json()["total"]


async def test_r5_e8_unknown_code_is_422_and_nothing_persisted(
    client: httpx.AsyncClient, seeded: SeededClaims
) -> None:
    before = await list_total(client)
    res = await client.post("/api/claims", json=claim_body([{"code": "D9999", "amount": 10}]))
    assert res.status_code == 422
    assert res.json() == {"detail": {"validation_errors": ["Procedure D9999: unknown procedure code"]}}
    assert await list_total(client) == before


async def test_r5_e9_codes_are_case_sensitive(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await client.post("/api/claims", json=claim_body([{"code": "d0120", "amount": 50}]))
    assert res.status_code == 422
    assert res.json() == {"detail": {"validation_errors": ["Procedure d0120: unknown procedure code"]}}


async def test_e10_amount_equal_to_max_is_accepted(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await client.post("/api/claims", json=claim_body([{"code": "D0120", "amount": 75.00}]))
    assert res.status_code == 200
    assert res.json()["claim"]["status"] == "pending"


async def test_e11_amount_one_cent_over_max_is_422(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await client.post("/api/claims", json=claim_body([{"code": "D0120", "amount": 75.01}]))
    assert res.status_code == 422
    assert res.json() == {
        "detail": {"validation_errors": ["Procedure D0120: amount $75.01 exceeds maximum $75.00"]}
    }


async def test_r6_e12_all_errors_reported_in_input_order(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    res = await client.post(
        "/api/claims",
        json=claim_body([{"code": "D9999", "amount": 10}, {"code": "D7210", "amount": 400}]),
    )
    assert res.status_code == 422
    assert res.json() == {
        "detail": {
            "validation_errors": [
                "Procedure D9999: unknown procedure code",
                "Procedure D7210: amount $400.00 exceeds maximum $350.00",
            ]
        }
    }


async def test_r7_e13_list_reflects_new_claim(client: httpx.AsyncClient, seeded: SeededClaims) -> None:
    before = await list_total(client)
    res = await client.post("/api/claims", json=claim_body([{"code": "D0120", "amount": 50}], patient="Zed"))
    assert res.status_code == 200
    new_id = res.json()["claim"]["id"]

    body = (await client.get("/api/claims", params=P)).json()
    assert body["total"] == before + 1
    assert new_id in [c["id"] for c in body["claims"]]
