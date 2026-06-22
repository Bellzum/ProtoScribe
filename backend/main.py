from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from .models import (
    ObservationRecord,
    ObservationRequest,
    SessionRecord,
    StartSessionRequest,
    StepEvent,
    StepEventRequest,
)
from .pdf_report import build_pdf_report
from .storage import (
    EXPORTS_DIR,
    archive_session,
    clear_active_session,
    ensure_storage,
    list_sessions,
    load_active_session,
    load_protocol,
    load_session,
    save_active_session,
    serialize_session,
)
from .stt import SttConfigurationError, transcribe_audio

app = FastAPI(title="ProtoScribe Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def require_active_session(session_id: str) -> SessionRecord:
    session = load_active_session()
    if not session or session.session_id != session_id:
        raise HTTPException(status_code=404, detail="Active session not found.")
    return session


def sync_selected_session(session: SessionRecord) -> SessionRecord:
    if session.status == "active":
        save_active_session(session)
    else:
        archive_session(session)
    return session


@app.on_event("startup")
def startup_event() -> None:
    ensure_storage()


@app.get("/api/health")
def get_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/protocol")
def get_protocol():
    return load_protocol()


@app.get("/api/session/active")
def get_active_session():
    return load_active_session()


@app.post("/api/session/start")
def start_session(payload: StartSessionRequest) -> SessionRecord:
    protocol = load_protocol()
    first_step = protocol.steps[0]
    session = SessionRecord(
        session_id=f"session-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:6]}",
        started_at=iso_now(),
        protocol_name=protocol.name,
        confirmation_required=payload.confirmation_required,
        status="active",
        current_step_index=first_step.index,
        step_events=[
            StepEvent(
                timestamp=iso_now(),
                step_index=first_step.index,
                step_title=first_step.title,
                event_type="entered",
                detail="session started",
            )
        ],
    )

    save_active_session(session)
    return session


@app.post("/api/session/{session_id}/step")
def record_step(session_id: str, payload: StepEventRequest) -> SessionRecord:
    session = require_active_session(session_id)

    event = StepEvent(
        timestamp=iso_now(),
        step_index=payload.step_index,
        step_title=payload.step_title,
        event_type=payload.event_type,
        detail=payload.detail,
    )
    session.step_events.append(event)

    if payload.event_type in {"entered", "repeated"}:
        session.current_step_index = payload.step_index

    return sync_selected_session(session)


@app.post("/api/session/{session_id}/observation")
def add_observation(session_id: str, payload: ObservationRequest) -> SessionRecord:
    session = require_active_session(session_id)
    note = ObservationRecord(
        timestamp=iso_now(),
        step_index=payload.step_index,
        step_title=payload.step_title,
        transcript=payload.transcript,
    )
    session.observations.append(note)
    save_active_session(session)
    return session


@app.post("/api/session/{session_id}/end")
def end_session(session_id: str) -> SessionRecord:
    session = require_active_session(session_id)
    session.status = "ended"
    session.ended_at = iso_now()
    archive_session(session)
    clear_active_session()
    return session


@app.get("/api/sessions")
def get_sessions() -> list[SessionRecord]:
    return list_sessions()


@app.get("/api/session/{session_id}")
def get_session(session_id: str) -> SessionRecord:
    try:
        return load_session(session_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Session not found.") from error


@app.get("/api/session/{session_id}/export/json")
def export_session_json(session_id: str) -> Response:
    session = get_session(session_id)
    return Response(
        content=serialize_session(session),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{session_id}.json"'},
    )


@app.get("/api/session/{session_id}/export/pdf")
def export_session_pdf(session_id: str):
    session = get_session(session_id)
    pdf_path = EXPORTS_DIR / f"{session_id}.pdf"
    pdf_path.write_bytes(build_pdf_report(session))
    return FileResponse(pdf_path, media_type="application/pdf", filename=pdf_path.name)


@app.post("/api/stt/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing audio filename.")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio payload was empty.")

    try:
        text = await transcribe_audio(audio_bytes, file.filename)
    except SttConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:  # pragma: no cover - defensive path for provider errors
        raise HTTPException(status_code=502, detail=str(error)) from error

    return JSONResponse({"text": text})
