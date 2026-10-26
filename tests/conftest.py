from collections.abc import AsyncGenerator
from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.app import app
from src.common.db import get_session
from src.models.base import Base
from src.models.claim import Claim, ClaimStatus
from src.models.payer import Payer
from src.models.procedure import Procedure
from src.services.claim_service import ClaimService

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def session() -> AsyncSession:  # type: ignore[return]
    engine = create_async_engine(TEST_DATABASE_URL)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as s:
        yield s

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.fixture
def claim_service(session: AsyncSession) -> ClaimService:
    return ClaimService(session)


@pytest.fixture
async def payer(session: AsyncSession) -> Payer:
    p = Payer(name="Delta Dental", payer_code="DELTA")
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


@dataclass
class SeededClaims:
    pending: int
    validated: int
    accepted: int


@pytest.fixture
async def api_db() -> AsyncGenerator[async_sessionmaker[AsyncSession]]:
    # StaticPool shares the single in-memory DB across sessions; each request still gets a
    # fresh session, as in production, so post-commit expiry behaves the same way.
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=StaticPool)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_session() -> AsyncGenerator[AsyncSession]:
        async with sessionmaker() as s:
            yield s

    app.dependency_overrides[get_session] = override_get_session
    yield sessionmaker
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
async def seeded(api_db: async_sessionmaker[AsyncSession]) -> SeededClaims:
    """Claim A pending, B validated, C accepted — all in practice-1 (SPEC.md examples)."""
    async with api_db() as s:
        payer = Payer(name="Delta Dental", payer_code="DELTA")
        s.add(payer)
        await s.flush()
        claims = [
            Claim(
                practice_id="practice-1",
                patient_name=name,
                payer_id=payer.id,
                status=status,
                total_amount=50.0,
                procedures=[Procedure(code="D0120", description="", amount=50.0)],
            )
            for name, status in [
                ("A", ClaimStatus.PENDING),
                ("B", ClaimStatus.VALIDATED),
                ("C", ClaimStatus.ACCEPTED),
            ]
        ]
        s.add_all(claims)
        await s.commit()
        return SeededClaims(*(c.id for c in claims))


@pytest.fixture
async def client(api_db: async_sessionmaker[AsyncSession]) -> AsyncGenerator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
