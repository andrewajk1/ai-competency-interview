from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.db import get_session
from src.common.exceptions import InvalidStatusTransitionError
from src.models.claim import ClaimStatus
from src.services.claim_service import ClaimService
from src.services.validation_service import ValidationService

router = APIRouter(prefix="/api")


def get_claim_service(session: AsyncSession = Depends(get_session)) -> ClaimService:
    return ClaimService(session)


class ProcedureInput(BaseModel):
    code: str
    description: str = ""
    amount: float


class ClaimCreateRequest(BaseModel):
    practice_id: str
    patient_name: str
    payer_id: int
    procedures: list[ProcedureInput]
    total_amount: float


class ClaimStatusUpdateRequest(BaseModel):
    status: ClaimStatus


@router.get("/claims")
async def list_claims(
    practice_id: str,
    service: ClaimService = Depends(get_claim_service),
):
    claims = await service.get_claims(practice_id)
    return {"claims": [c.to_dict() for c in claims], "total": len(claims)}


@router.get("/claims/{claim_id}")
async def get_claim(
    claim_id: int,
    practice_id: str,
    service: ClaimService = Depends(get_claim_service),
):
    claim = await service.get_claim(claim_id, practice_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Not found")
    return claim.to_dict()


@router.post("/claims")
async def create_claim(
    data: ClaimCreateRequest,
    service: ClaimService = Depends(get_claim_service),
):
    validation_service = ValidationService()
    errors = validation_service.validate_claim([p.model_dump() for p in data.procedures])
    if errors:
        raise HTTPException(status_code=422, detail={"validation_errors": errors})

    claim = await service.create_claim(
        practice_id=data.practice_id,
        patient_name=data.patient_name,
        payer_id=data.payer_id,
        procedures=[p.model_dump() for p in data.procedures],
        total_amount=data.total_amount,
    )
    return {"claim": claim.to_dict(), "message": "Claim submitted successfully"}


@router.patch("/claims/{claim_id}/status")
async def update_claim_status(
    claim_id: int,
    practice_id: str,
    data: ClaimStatusUpdateRequest,
    service: ClaimService = Depends(get_claim_service),
):
    claim = await service.get_claim(claim_id, practice_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        claim = await service.transition_status(claim, data.status)
    except InvalidStatusTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return claim.to_dict()


@router.delete("/claims/{claim_id}")
async def delete_claim(
    claim_id: int,
    practice_id: str,
    service: ClaimService = Depends(get_claim_service),
):
    claim = await service.get_claim_unrestricted(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Not found")
    if claim.practice_id != practice_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await service.delete_claim(claim)
    return {"deleted": True}
