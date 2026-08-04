from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agent import run_chat
from app.config import Settings, get_settings
from app.database import get_db
from app.schemas import ChatRequest, ChatResponse

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ChatResponse:
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY is not configured",
        )

    try:
        reply, tools_used = await run_chat(
            message=payload.message,
            history=[item.model_dump() for item in payload.history],
            db=db,
            settings=settings,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"LLM request failed: {exc}",
        ) from exc

    return ChatResponse(reply=reply, tools_used=tools_used)
