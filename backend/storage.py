from __future__ import annotations

import json
from pathlib import Path

from .models import ProtocolDefinition, SessionRecord

ROOT_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = Path(__file__).resolve().parent / "storage"
SESSIONS_DIR = STORAGE_DIR / "sessions"
EXPORTS_DIR = STORAGE_DIR / "exports"
ACTIVE_SESSION_PATH = STORAGE_DIR / "active-session.json"
PROTOCOL_PATH = ROOT_DIR / "public" / "protocol.json"


def ensure_storage() -> None:
    STORAGE_DIR.mkdir(exist_ok=True)
    SESSIONS_DIR.mkdir(exist_ok=True)
    EXPORTS_DIR.mkdir(exist_ok=True)


def load_protocol() -> ProtocolDefinition:
    content = PROTOCOL_PATH.read_text(encoding="utf-8")
    return ProtocolDefinition.model_validate_json(content)


def get_step_title(step_index: int) -> str:
    protocol = load_protocol()
    for step in protocol.steps:
        if step.index == step_index:
            return step.title
    raise KeyError(f"Unknown protocol step: {step_index}")


def save_active_session(session: SessionRecord) -> None:
    ACTIVE_SESSION_PATH.write_text(
        session.model_dump_json(indent=2),
        encoding="utf-8",
    )


def load_active_session() -> SessionRecord | None:
    if not ACTIVE_SESSION_PATH.exists():
      return None

    content = ACTIVE_SESSION_PATH.read_text(encoding="utf-8")
    return SessionRecord.model_validate_json(content)


def archive_session(session: SessionRecord) -> Path:
    target = SESSIONS_DIR / f"{session.session_id}.json"
    target.write_text(session.model_dump_json(indent=2), encoding="utf-8")
    return target


def clear_active_session() -> None:
    if ACTIVE_SESSION_PATH.exists():
        ACTIVE_SESSION_PATH.unlink()


def load_session(session_id: str) -> SessionRecord:
    active = load_active_session()
    if active and active.session_id == session_id:
        return active

    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        raise FileNotFoundError(session_id)
    return SessionRecord.model_validate_json(path.read_text(encoding="utf-8"))


def list_sessions() -> list[SessionRecord]:
    sessions: list[SessionRecord] = []
    active = load_active_session()
    if active:
        sessions.append(active)

    for path in sorted(SESSIONS_DIR.glob("*.json"), reverse=True):
        session = SessionRecord.model_validate_json(path.read_text(encoding="utf-8"))
        if active and session.session_id == active.session_id:
            continue
        sessions.append(session)

    return sorted(sessions, key=lambda item: item.started_at, reverse=True)


def serialize_session(session: SessionRecord) -> bytes:
    return json.dumps(session.model_dump(), indent=2).encode("utf-8")
