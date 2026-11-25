from sqlalchemy import text
from app.database import engine
from app.config import settings


async def check_database() -> dict:
    """Check database connectivity."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "healthy", "message": "Database connected"}
    except Exception as e:
        return {"status": "unhealthy", "message": str(e)}


async def check_qdrant() -> dict:
    """Check Qdrant connectivity."""
    try:
        import httpx
        headers = {"api-key": settings.qdrant_api_key} if settings.qdrant_api_key else {}
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{settings.qdrant_url}/collections", timeout=5.0, headers=headers)
            if response.status_code == 200:
                return {"status": "healthy", "message": "Qdrant connected"}
            return {"status": "unhealthy", "message": f"Qdrant returned HTTP {response.status_code}"}
    except Exception as e:
        return {"status": "unhealthy", "message": f"Qdrant: {str(e)}"}


async def get_health_status() -> dict:
    """Get comprehensive health status."""
    db_status = await check_database()
    qdrant_status = await check_qdrant()

    overall = "healthy"
    if any(s["status"] == "unhealthy" for s in [db_status, qdrant_status]):
        overall = "degraded"

    return {
        "status": overall,
        "components": {
            "database": db_status,
            "qdrant": qdrant_status,
        }
    }
