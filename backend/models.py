from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


StepEventType = Literal["entered", "repeated", "completed", "flagged"]
SessionStatus = Literal["idle", "active", "ended"]


class ProtocolStep(BaseModel):
    index: int
    title: str
    action: str


class ProtocolDefinition(BaseModel):
    name: str
    steps: list[ProtocolStep]


class ObservationRecord(BaseModel):
    timestamp: str
    step_index: int
    step_title: str
    transcript: str


class StepEvent(BaseModel):
    timestamp: str
    step_index: int
    step_title: str
    event_type: StepEventType
    detail: Optional[str] = None


class SessionRecord(BaseModel):
    session_id: str
    started_at: str
    ended_at: Optional[str] = None
    protocol_name: str
    confirmation_required: bool = False
    status: SessionStatus = "idle"
    current_step_index: int = 1
    observations: list[ObservationRecord] = Field(default_factory=list)
    step_events: list[StepEvent] = Field(default_factory=list)


class StartSessionRequest(BaseModel):
    confirmation_required: bool = False


class StepEventRequest(BaseModel):
    step_index: int
    step_title: str
    event_type: StepEventType
    detail: Optional[str] = None


class ObservationRequest(BaseModel):
    step_index: int
    step_title: str
    transcript: str
