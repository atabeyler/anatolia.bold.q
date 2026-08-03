# ANATOLIA-Q

**Quantum-Based National Decision Support System**
Bold Military Technology and Defense Industry Inc.

---

## Features

- **Two-Stage Login** — user code + password, followed by approval via the central mailbox (`info@boldkimya.com.tr`)
- **10 Analysis Categories** — Defense, Energy, Offensive, Economy, Social, Consultation, Health, Multi-Domain Synthesis, BDDK, BTK
- **Triple AI Assurance** — Claude (Anthropic) → Gemini → GPT-4o automatic fallback
- **Fixed-Format Report** — auto-generated document number, Times New Roman 11pt, cover page + header/footer, automatically emailed to the central mailbox as .docx
- **Emergency Center** — center notification, user notification, end-to-end encrypted chat, and video call panels
- **3D Rotating Globe** — real-texture Earth map with city pins and radar sweep
- **Quantum Computing** — scenario probability engine, portfolio optimization, and fraud detection via Qiskit (local simulator or real IBM Quantum hardware)
- **History Archive** — all reports can be viewed and downloaded

---

## Architecture

```
anatolia-q/
├── server/                       # Node.js + Express backend
│   ├── src/
│   │   ├── index.js              # Main server
│   │   ├── routes/                # API routes (auth, analysis, emergency, history, voice, memory, files, weather)
│   │   ├── services/              # AI, DB, mail, socket, DOCX, quantum services
│   │   └── middleware/            # JWT authentication
│   └── quantum/                   # Python/Qiskit scripts (scenario, portfolio, fraud detection)
├── client/                        # React + Vite + Tailwind frontend
│   └── src/
│       ├── pages/                 # Login, Dashboard
│       ├── components/            # Sidebar, map, analysis, history, emergency, voice assistant
│       └── services/               # API and socket clients
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
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | AI provider keys for the analysis engine (sequential fallback) |
| `RESEND_API_KEY` | For approval and report emails |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `SESSION_SECRET` | Session signing secrets |
| `SHARED_PASSWORD` | Login password (used together with the user codes in `server/src/routes/auth.js`) |
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
| `IBM_QUANTUM_TOKEN`, `IBM_QUANTUM_INSTANCE`, `IBM_QUANTUM_WAIT_SECONDS` | Run quantum computations on real IBM hardware (falls back to the local simulator otherwise) |

---

## How It Works

**Login flow:** user code + password are validated → a 10-minute approval token is generated → an approve/reject email goes to the central mailbox → the client polls status every 2.5 seconds → once approved, a JWT is issued and login completes.

**Analysis generation:** the user picks a category and writes a brief → system/user prompts are prepared → sent to Claude (falls back to Gemini, then GPT-4o, on quota/error) → a markdown report comes back → converted into the fixed DOCX template → saved to the database → automatically emailed to the central mailbox as a .docx attachment.

---

## Deployment

The app is deployed on Render via the `render.yaml` blueprint in this repo. Every push to `main` triggers an automatic redeploy (Render's GitHub integration and/or `.github/workflows/deploy.yml`). The free-tier instance spins down after ~15 minutes idle; `server/src/services/selfPing.js` and `.github/workflows/keep-alive.yml` both ping `/api/health` periodically to keep it warm.

---

## Security Notes

- JWT is valid for 8 hours, renewed on every request
- The approval token is valid for 10 minutes and becomes invalid once used
- The password is kept as plain text in an environment variable — hashing with bcrypt is recommended for enterprise use
- All notifications go to the `CENTER_EMAIL` address

---

**© Bold Military Technology and Defense Industry Inc.** · All Rights Reserved
