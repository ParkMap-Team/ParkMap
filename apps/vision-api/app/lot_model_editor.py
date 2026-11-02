"""Operator-only lot model authoring. The student-facing API still serves active models only."""

import hmac
import os
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Path as ApiPath
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.models import IDENTIFIER_PATTERN, LotModelDefinition, LotModelDraftActivate, LotModelDraftState, LotModelDraftWrite
from app.services.live_state_service import validate_lot_model
from app.services import lot_model_editor_service as editor

TEMPLATE = Path(__file__).resolve().parents[1] / "fixtures" / "spu-cam-01-lot-model.json"


def require_editor_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("PARKMAP_EDITOR_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Lot model editor is not configured.")
    if authorization is None or not hmac.compare_digest(authorization.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(401, "Invalid editor token.")


router = APIRouter(prefix="/api/operator/lot-model", dependencies=[Depends(require_editor_token)], tags=["Lot model editor"])


def template_definition() -> LotModelDefinition:
    try:
        definition = LotModelDefinition.model_validate_json(TEMPLATE.read_text(encoding="utf-8"))
        validate_lot_model(definition)
        return definition
    except (OSError, ValueError) as error:
        raise HTTPException(503, "Lot model template is unavailable.") from error


@router.get("/template", response_model=LotModelDefinition)
def get_template() -> LotModelDefinition:
    return template_definition()


def editor_exception(error: ValueError) -> HTTPException:
    code = 404 if isinstance(error, editor.EditorNotFoundError) else 409 if isinstance(error, editor.EditorConflictError) else 422
    return HTTPException(code, str(error))


@router.get("/sites/{site_id}/draft", response_model=LotModelDraftState)
def get_draft(site_id: str = ApiPath(pattern=IDENTIFIER_PATTERN), session: Session = Depends(get_session)) -> LotModelDraftState:
    try:
        return editor.draft_state(session, site_id, template_definition())
    except ValueError as error:
        raise editor_exception(error) from error


@router.put("/sites/{site_id}/draft", response_model=LotModelDraftState)
def put_draft(request: LotModelDraftWrite, site_id: str = ApiPath(pattern=IDENTIFIER_PATTERN), session: Session = Depends(get_session)) -> LotModelDraftState:
    try:
        template = template_definition()
        editor.save_draft(session, site_id, request, template)
        result = editor.draft_state(session, site_id, template)
        session.commit()
        return result
    except ValueError as error:
        raise editor_exception(error) from error


@router.post("/sites/{site_id}/activate", response_model=LotModelDraftState)
def post_activate(request: LotModelDraftActivate, site_id: str = ApiPath(pattern=IDENTIFIER_PATTERN), session: Session = Depends(get_session)) -> LotModelDraftState:
    try:
        editor.activate_draft(session, site_id, request)
        result = editor.draft_state(session, site_id, template_definition())
        session.commit()
        return result
    except ValueError as error:
        raise editor_exception(error) from error


@router.post("/validate", response_model=LotModelDefinition)
def validate_definition(definition: LotModelDefinition) -> LotModelDefinition:
    try:
        validate_lot_model(definition)
        return definition
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
