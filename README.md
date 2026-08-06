# ANATOLIA-Q

**Quantum-Based National Decision Support System**
Bold Military Technology and Defense Industry Inc.

---

## Features

- **Two-Stage Login** — user code + password, followed by approval via the central mailbox (`info@boldkimya.com.tr`); admin accounts skip mail approval and get a JWT immediately (see Security Notes)
- **10 Analysis Categories** — Defense, Energy, Offensive, Economy, Social, Consultation, Health, Multi-Domain Synthesis, BDDK, BTK
- **Triple AI Assurance** — Claude (Anthropic) → Gemini → GPT-4o automatic fallback, for both the one-shot report generator and the streaming consultation chat
- **Fixed-Format Report** — auto-generated document number, Times New Roman 11pt, cover page + header/footer, produced as both DOCX and PDF, saved to history, and automatically emailed to the central mailbox as .docx
- **Emergency Center** — center notification, user notification, end-to-end encrypted chat, and video call panels
- **3D Rotating Globe & Turkey Map** — real-texture Earth map with city pins and radar sweep, plus a dedicated Turkey-focused personnel radar view
- **Quantum Computing** (Qiskit, `server/quantum/`) — scenario probability engine, QAOA portfolio optimization, and a quantum-kernel fraud/AML anomaly detector for BDDK/BTK. Every module always runs on a local, deterministic simulator first; when `IBM_QUANTUM_TOKEN`/`IBM_QUANTUM_INSTANCE` are configured, the scenario and fraud modules *additionally* verify one result on real IBM Quantum hardware (a repeat circuit run for scenarios, a swap-test fidelity check for fraud) as a separate, clearly-labeled data point — hardware noise never feeds back into the reported numbers or the fraud flagged/riskScore decision, which must stay reproducible
- **Voice Assistant** — Whisper transcription, TTS playback, and a natural-language voice command intent parser (OpenAI-backed)
- **Conversation Memory** — danışma (consultation) chats can be saved, AI-summarized, archived, and revisited later per user
- **Morning Brief** — a daily auto-generated intelligence digest aggregated from Turkish government/news RSS and HTML sources
- **Admin Panel** — user management (create/update/block/delete), an audit log of admin actions, and a public `/api/analysis/quantum-status` health check that reports whether the Qiskit worker and IBM hardware link are actually working
- **History Archive** — all reports can be viewed, downloaded (DOCX/PDF), and appear in a live activity feed

---

## Architecture

```
anatolia-q/
├── server/                       # Node.js + Express backend (ESM, run via tsx)
│   ├── src/
│   │   ├── index.js              # Main server
│   │   ├── routes/                # API routes (auth, analysis, emergency, history, voice, memory, files, weather)
│   │   ├── services/              # AI (ai.ts), DB, mail, socket, DOCX/PDF, quantum (quantum.js, fraudDetection.js, portfolioOptimizer.js), morningBrief
│   │   ├── lib/                    # Redis/S3 fallbacks, JWT secret, quantum subprocess timeout budgeting, logger
│   │   └── middleware/            # JWT authentication, rate limiting
│   └── quantum/                   # Python/Qiskit scripts (scenario_quantum.py, portfolio_optimizer.py, fraud_detection.py, _ibm_backend.py)
├── client/                        # React + Vite + Tailwind frontend
│   └── src/
│       ├── pages/                 # LoginPage, DashboardPage
│       ├── components/            # Sidebar, 3D globe/Turkey map, analysis, history, memory panel, admin user management, emergency, voice assistant
│       └── services/               # API and socket clients, i18n (Turkish UI strings)
├── render.yaml                    # Render deploy configuration (web service + Postgres)
└── package.json                   # Root scripts
```

---

## Local Development

```bash
# Install dependencies
npm install --prefix server
npm install --prefix client

# Create and fill in server/.env (see Environment Variables)

# Two separate terminals:
npm run dev:server   # backend — http://localhost:10000
npm run dev:client   # frontend — http://localhost:5173
```

Tests: `npm test --prefix server` and `npm test --prefix client`

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | AI provider keys for the analysis engine (sequential fallback). `OPENAI_API_KEY` is also required for voice transcription (Whisper) and TTS |
| `RESEND_API_KEY` | For approval and report emails |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `SHARED_PASSWORD` | One-time seed password for the original hardcoded user list, used only to populate `auth_users` on first boot if the table is empty — not read again afterward |
| `APP_URL` | The app's live URL (for CORS and approval links) |
| `CENTER_EMAIL` | Address that reports and approval emails are sent to |
| `LOG_LEVEL` | pino log level (`debug`/`info`/`warn`/`error`) |

**Optional** (if unset, the app keeps working on memory/local-disk fallbacks):

| Variable | What it does |
|---|---|
| `REDIS_URL` | Active user/location state is kept in Redis |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION` | File uploads are stored persistently in S3/Cloudflare R2 |
| `SENTRY_DSN` | Server errors are reported to Sentry |
| `VITE_ICE_SERVERS` | TURN server for the emergency video call feature |
| `IBM_QUANTUM_TOKEN`, `IBM_QUANTUM_INSTANCE`, `IBM_QUANTUM_WAIT_SECONDS` | Run the scenario and fraud-detection quantum modules' verification lane on real IBM Quantum hardware (falls back to simulator-only otherwise); wait defaults to 60s |
| `NEWS_RSS_SOURCES` | Overrides the default RSS/HTML source list the morning brief aggregates from |
| `PYTHON_BIN` | Overrides the `python3` binary used to spawn the Qiskit subprocesses (for local dev setups with a non-default interpreter) |

---

## How It Works

**Login flow:** user code + password are validated against `auth_users` (bcrypt-hashed) → **admin accounts** get a JWT immediately, no approval step. **Non-admin accounts** go through mail approval: a 10-minute approval token is generated → an approve/reject email goes to the central mailbox → the client polls status every 2.5 seconds → once approved, a JWT is issued and login completes.

**Analysis generation:** the user picks a category and writes a brief → system/user prompts are prepared → sent to Claude (falls back to Gemini, then GPT-4o, on quota/error — the same fallback chain also covers the streaming consultation chat) → a markdown report comes back → if quantum mode is on, the report's scenario/transaction/optimization tables are parsed out and recomputed on a real Qiskit circuit (see Features) → converted into the fixed DOCX/PDF templates → saved to the database → automatically emailed to the central mailbox as a .docx attachment.

---

## Deployment

The app is deployed on Render via the `render.yaml` blueprint in this repo. `.github/workflows/deploy.yml` triggers only after the `CI` workflow finishes successfully on `main` (it's a `workflow_run` gate, not a direct `push` trigger) — a push that fails lint/tests never reaches Render. Deploy typically lands a few minutes after the push; check both workflow runs on GitHub Actions before assuming a push is live, since a low `/api/health` uptime alone isn't proof (a free-tier restart can happen for unrelated reasons). The free-tier instance also spins down after ~15 minutes idle; `server/src/services/selfPing.js` and `.github/workflows/keep-alive.yml` both ping `/api/health` periodically to keep it warm.

---

## Security Notes

- Passwords are bcrypt-hashed in the `auth_users` table, not stored in plain text. `SHARED_PASSWORD` is only used once, to seed the original hardcoded user list into the database on first boot (if `auth_users` is empty) — it is never read again afterward
- JWTs are short-lived: 4 hours for admin logins, 2 hours for mail-approved user logins
- **Admin logins bypass mail approval entirely** — a correct user code + password for an admin account returns a JWT directly, with no human-in-the-loop step. Treat admin credentials accordingly
- The approval token (non-admin login) is valid for 10 minutes and becomes invalid once used
- Blocking a user (`/api/auth/admin/users/:userCode` with `blocked: true`) force-disconnects their active socket session immediately, rather than waiting for their JWT to expire
- All notifications go to the `CENTER_EMAIL` address

---

**© Bold Military Technology and Defense Industry Inc.** · All Rights Reserved
