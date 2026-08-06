# API Reference

Base URL: `https://anatolia-q.onrender.com/api` (or `http://localhost:10000/api` locally).

All endpoints marked **auth** require `Authorization: Bearer <jwt>`. Admin-only endpoints additionally require the JWT's `isAdmin` claim.

---

## Auth (`/api/auth`)

| Method & Path | Auth | Description |
|---|---|---|
| `POST /login-request` | — | User code + password. Admin accounts get a JWT immediately; others trigger a mail-approval flow |
| `GET /approve/:token` | — | Renders a confirmation page for the mail approval link (does not approve by itself — see Security Notes in README) |
| `POST /approve/:token` | — | Approves a pending login |
| `GET /reject/:token` | — | Renders a confirmation page for the reject link |
| `POST /reject/:token` | — | Rejects a pending login |
| `GET /check/:token` | — | Polled by the client to check approval status; returns a JWT once approved |
| `GET /admin/users` | auth, admin | List all users |
| `POST /admin/users` | auth, admin | Create a user |
| `PATCH /admin/users/:userCode` | auth, admin | Update password/nickname/email/isAdmin/blocked |
| `DELETE /admin/users/:userCode` | auth, admin | Delete a user (cannot delete self or the last admin) |
| `GET /admin/audit-log` | auth, admin | Last 200 admin actions |

## Analysis (`/api/analysis`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /status` | — | Whether each AI provider key is configured |
| `GET /quantum-status` | — | Spawns the Qiskit worker with a trivial payload; reports simulator + IBM hardware health |
| `POST /upload` | auth | Extracts text from an uploaded document, or returns an image as base64 for vision analysis |
| `POST /generate` | auth | Main report generator — category + prompt in, DOCX/PDF report out. `quantumMode: true` additionally recomputes scenario/transaction/optimization tables on Qiskit (see README's Quantum Computing feature) |
| `POST /scenario-deep-dive` | auth | Expands a single scenario from a prior report into a focused sub-analysis |
| `POST /chat` | auth | Streaming danışma (consultation) chat, same triple-AI fallback as `/generate` |

## History (`/api/history`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /morning-brief/today` | auth | Today's auto-generated intelligence digest |
| `GET /morning-brief/list` | auth | Last 30 days of digest dates |
| `GET /morning-brief/date/:date` | auth | A specific day's digest (`YYYY-MM-DD`) |
| `POST /morning-brief/refresh` | auth, admin | Force-regenerate today's digest |
| `GET /list` | auth | Last 100 saved reports (own reports, or all reports for admins) |
| `GET /feed` | auth | Combined recent activity feed (reports + emergency logs) |
| `GET /:id` | auth | A single report |
| `GET /:id/download` | auth | Report as `.docx` |
| `GET /:id/download-pdf` | auth | Report as `.pdf` |

## Emergency (`/api/emergency`)

| Method & Path | Auth | Description |
|---|---|---|
| `POST /center` | — | Notify the central mailbox of an emergency |
| `POST /users` | auth | Broadcast an emergency notification to other users |
| `POST /region` | — | Report a regional emergency |

## Voice (`/api/voice`)

| Method & Path | Auth | Description |
|---|---|---|
| `POST /transcribe` | auth | Audio → text via OpenAI Whisper |
| `POST /speak` | auth | Text → MP3 via OpenAI TTS |
| `POST /intent` | auth | Parses a natural-language voice command into `{actions, speak}` |

## Memory (`/api/memory`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /profile` | auth | The user's display profile (name, rank, unit, persona, language) |
| `PUT /profile` | auth | Update the profile |
| `POST /save-conversation` | auth | Save + AI-summarize a danışma chat transcript |
| `GET /conversations` | auth | List saved conversations |
| `GET /conversations/:id` | auth | A single saved conversation with full history |
| `PATCH /conversations/:id/archive` | auth | Archive/unarchive a conversation |
| `DELETE /conversations/:id` | auth | Delete a conversation |
| `GET /context` | auth | Aggregated memory context fed into the consultation system prompt |

## Files (`/api/files`)

| Method & Path | Auth | Description |
|---|---|---|
| `POST /upload` | auth | Upload a file (disk or S3/R2 depending on config) |
| `GET /:filename` | — | Download/serve a previously uploaded file |

## Weather (`/api/weather`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /current?lat=&lng=` | auth | Current temperature for a coordinate (proxies Open-Meteo) |

---

For request/response shapes and quantum-mode field details (`quantum`, `fraud`, `optimizer` objects), see the route source directly in `server/src/routes/` — this file tracks endpoints and purpose, not full schemas.
