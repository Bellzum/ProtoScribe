from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx


class SttConfigurationError(RuntimeError):
    pass


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    provider = os.getenv("STT_PROVIDER", "whisper").strip().lower()

    if provider == "whisper":
        return await _transcribe_with_whisper(audio_bytes, filename)
    if provider == "deepgram":
        return await _transcribe_with_deepgram(audio_bytes)
    if provider == "assemblyai":
        return await _transcribe_with_assemblyai(audio_bytes)

    raise SttConfigurationError(f"Unsupported STT_PROVIDER: {provider}")


async def _transcribe_with_whisper(audio_bytes: bytes, filename: str) -> str:
    endpoint = os.getenv("WHISPER_API_URL", "http://127.0.0.1:8001/v1/audio/transcriptions")
    model = os.getenv("WHISPER_MODEL", "whisper-1")
    api_key = os.getenv("WHISPER_API_KEY", "").strip()
    language = os.getenv("STT_LANGUAGE", "en")

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    data = {
        "model": model,
        "language": language,
        "response_format": "json",
    }

    files = {"file": (filename, audio_bytes, "audio/wav")}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(endpoint, headers=headers, data=data, files=files)
        response.raise_for_status()
        payload = response.json()

    return _extract_text(payload)


async def _transcribe_with_deepgram(audio_bytes: bytes) -> str:
    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise SttConfigurationError("DEEPGRAM_API_KEY is not set.")

    endpoint = os.getenv(
        "DEEPGRAM_API_URL",
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
    )

    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "audio/wav",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(endpoint, headers=headers, content=audio_bytes)
        response.raise_for_status()
        payload = response.json()

    return (
        payload.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
        .strip()
    )


async def _transcribe_with_assemblyai(audio_bytes: bytes) -> str:
    api_key = os.getenv("ASSEMBLYAI_API_KEY", "").strip()
    if not api_key:
        raise SttConfigurationError("ASSEMBLYAI_API_KEY is not set.")

    upload_url = os.getenv("ASSEMBLYAI_UPLOAD_URL", "https://api.assemblyai.com/v2/upload")
    transcript_url = os.getenv("ASSEMBLYAI_TRANSCRIPT_URL", "https://api.assemblyai.com/v2/transcript")

    headers = {"authorization": api_key}

    async with httpx.AsyncClient(timeout=60.0) as client:
        upload_response = await client.post(upload_url, headers=headers, content=audio_bytes)
        upload_response.raise_for_status()
        uploaded_audio_url = upload_response.json()["upload_url"]

        transcript_response = await client.post(
            transcript_url,
            headers=headers,
            json={"audio_url": uploaded_audio_url},
        )
        transcript_response.raise_for_status()
        transcript_id = transcript_response.json()["id"]

        while True:
            poll_response = await client.get(f"{transcript_url}/{transcript_id}", headers=headers)
            poll_response.raise_for_status()
            payload = poll_response.json()
            status = payload.get("status")

            if status == "completed":
                return str(payload.get("text", "")).strip()
            if status == "error":
                raise RuntimeError(payload.get("error", "AssemblyAI transcription failed."))

            await asyncio.sleep(1.0)


def _extract_text(payload: Any) -> str:
    if isinstance(payload, dict):
        if isinstance(payload.get("text"), str):
            return payload["text"].strip()
        if isinstance(payload.get("transcript"), str):
            return payload["transcript"].strip()
    return ""
