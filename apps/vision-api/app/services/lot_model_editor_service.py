"""Draft persistence and validation; availability decisions do not belong to the editor."""

from sqlalchemy.orm import Session

from app.db import repository
from app.db.tables import LotModelDraft, Site
from app.models import (
    LotModelDefinition,
    LotModelDraftActivate,
    LotModelDraftState,
    LotModelDraftWrite,
)
from app.services.live_state_service import validate_lot_model


class EditorNotFoundError(ValueError):
    pass


class EditorConflictError(ValueError):
    pass


def validate_site_definition(session: Session, site_id: str, definition: LotModelDefinition) -> None:
    if session.get(Site, site_id) is None:
        raise EditorNotFoundError(f"Site {site_id} does not exist.")
    validate_lot_model(definition)
    registered = {area.id for area in repository.site_areas(session, site_id)}
    unknown = sorted({area.parking_area_id for area in definition.parking_areas} - registered)
    if unknown:
        raise ValueError(f"Lot model references parking areas not registered for {site_id}: {', '.join(unknown)}.")


def draft_state(session: Session, site_id: str, template: LotModelDefinition) -> LotModelDraftState:
    if session.get(Site, site_id) is None:
        raise EditorNotFoundError(f"Site {site_id} does not exist.")
    active = repository.active_lot_model(session, site_id)
    version = active.version if active else 0
    draft = session.get(LotModelDraft, site_id)
    return LotModelDraftState(
        site_id=site_id, revision=draft.revision if draft else 0,
        base_version=draft.base_version if draft else version, active_version=version,
        is_published=bool(draft and active and draft.base_version == version and draft.payload == active.payload),
        definition=LotModelDefinition.model_validate(draft.payload) if draft else template,
    )


def save_draft(session: Session, site_id: str, request: LotModelDraftWrite, template: LotModelDefinition) -> None:
    if repository.lock_site(session, site_id) is None:
        raise EditorNotFoundError(f"Site {site_id} does not exist.")
    validate_site_definition(session, site_id, request.definition)
    active = repository.active_lot_model(session, site_id)
    version = active.version if active else 0
    draft = session.get(LotModelDraft, site_id)
    if request.expected_revision != (draft.revision if draft else 0) or request.base_version != version:
        raise EditorConflictError("The draft or active model changed. Reload before saving.")
    payload = request.definition.model_dump(mode="json")
    references = [template.model_dump(mode="json")]
    if active:
        references.append(active.payload)
    if draft:
        references.append(draft.payload)
    follows_sole_roi = len(payload["parking_areas"]) == 1 and payload["outline"] == payload["parking_areas"][0]["polygon"]
    if not follows_sole_roi and not any(payload["outline"] == reference["outline"] for reference in references):
        raise ValueError("Use an existing lot outline or explicitly match it to the sole parking ROI.")
    if draft and draft.payload == payload and draft.base_version == version:
        return
    if draft is None:
        draft = LotModelDraft(site_id=site_id, revision=0)
        session.add(draft)
    draft.revision += 1
    draft.base_version = version
    draft.payload = payload
    session.flush()


def activate_draft(session: Session, site_id: str, request: LotModelDraftActivate) -> None:
    if repository.lock_site(session, site_id) is None:
        raise EditorNotFoundError(f"Site {site_id} does not exist.")
    draft = session.get(LotModelDraft, site_id)
    if draft is None:
        raise EditorNotFoundError("Save a draft before activating it.")
    active = repository.active_lot_model(session, site_id)
    version = active.version if active else 0
    if draft.revision != request.expected_revision or draft.base_version != request.base_version or version != request.base_version:
        raise EditorConflictError("The draft or active model changed. Reload before activating.")
    definition = LotModelDefinition.model_validate(draft.payload)
    validate_site_definition(session, site_id, definition)
    if active and active.payload == draft.payload:
        return
    draft.base_version = repository.activate_lot_model(session, site_id, definition)
    draft.revision += 1
    session.flush()
