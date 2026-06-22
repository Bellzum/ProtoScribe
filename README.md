# ProtoScribe

ProtoScribe is a hands-free protocol guide and voice lab notebook for BSL-3 researchers on Even Realities G2 smart glasses. It starts from the official Even Hub ASR starter and adds:

- Voice-first step navigation on the glasses
- Timestamped spoken observation capture
- Session persistence across app backgrounding
- Companion review/export UI for phone or laptop
- FastAPI backend for JSON and PDF audit exports

## Project structure

| Path | Purpose |
|---|---|
| `src/main.ts` | App bootstrap, voice command handling, session lifecycle, Even Hub event routing |
| `src/asr/stt.ts` | Swappable STT adapter with browser fallback and backend-backed PCM transcription |
| `src/lib/` | Types, backend API client, voice command parser, and glasses renderer |
| `src/ui.ts` | Companion review and export interface in the paired WebView/browser |
| `public/protocol.json` | Placeholder protocol data you can replace with a real SOP |
| `backend/main.py` | FastAPI service for session persistence, export, and batch transcription |
| `backend/pdf_report.py` | PDF lab notebook report generation |
| `app.json` | Even Hub manifest for packaging and sideloading |

## Requirements

- Node.js 20+
- Python 3.10+
- Even Hub CLI and simulator are already included as dev dependencies
- Optional STT provider access:
  - `browser` for zero-config fallback
  - local Whisper-compatible transcription endpoint
  - Deepgram
  - AssemblyAI

## Frontend setup

```bash
cp .env.example .env.local
npm install
```

Recommended local fallback during development:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_STT_PROVIDER=browser
VITE_STT_LANGUAGE=en-US
```

If you want privacy-first local transcription, set:

```env
VITE_STT_PROVIDER=whisper
```

## Backend setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
uvicorn backend.main:app --reload --port 8000
```

Default local Whisper-compatible backend configuration:

```env
STT_PROVIDER=whisper
WHISPER_API_URL=http://127.0.0.1:8001/v1/audio/transcriptions
WHISPER_MODEL=whisper-1
```

For hosted providers, set `STT_PROVIDER=deepgram` or `STT_PROVIDER=assemblyai` and add the matching API key in `backend/.env`.

## Run and test

Start the FastAPI backend first, then the Vite app:

```bash
npm run dev
```

Run in the Even Hub simulator:

```bash
npm run simulate
```

Run on a device by QR sideload:

```bash
npx evenhub qr --url http://<your-local-ip>:5173
```

Package for the dev portal:

```bash
npm run build
evenhub pack app.json dist -o protoscribe.ehpk
```

Frontend validation:

```bash
npm run check
```

Backend quick health check:

```bash
curl http://localhost:8000/api/health
```

## Voice commands

- `start session`
- `end session`
- `next`
- `back`
- `repeat`
- `go to step 3`
- `note media looked cloudy`
- `read last note`
- `done`
- `flag contaminated`

Temple double-tap advances to the next step as a fallback when voice capture is unreliable.

## Export formats

After the session ends, open the companion UI in the WebView or browser and export:

- JSON: structured session record for downstream processing
- PDF: chronological audit log with timestamps, step events, and observations

## Notes

- No logic runs on the glasses themselves; state stays on the phone/server side.
- The glasses have no speaker, so all confirmations are visual.
- `public/protocol.json` ships with a generic 5-step placeholder protocol you can replace safely.
- If you test on a real phone and backend host is not `localhost`, update `VITE_API_BASE_URL` and add your local backend host to the `network` whitelist in `app.json`.
