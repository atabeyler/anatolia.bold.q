# BCI UI — M15 Standalone Frontend

A minimal but real, working React frontend for the BCI API — not a mockup.
Every page is wired to a live endpoint and every button does what it says
(create an asset, start a scan, generate a report, run an engine health
check). This is a working core, not the full 17-area surface described in
the long-term spec (Security Graph visualization, Vulnerabilities/SBOM,
Policies, Rule management, full Administration are not built yet) — it
proves the pattern end to end so those areas can be added the same way.

## Pages

- **Login** — org slug + email + password against `POST /auth/login`
- **Dashboard** — BCI Security Score + Coverage Score + open finding count
- **Assets** — list + create (asset:create-gated)
- **Scans** — list scan jobs + start a new scan (scan:create-gated); a scan
  that isn't covered by an approved authorized scope reports the policy
  engine's denial reason back to the user rather than pretending it started
- **Findings** — list + detail drawer with Explain (AI or deterministic
  fallback), Verify fix (targeted re-check), Confirm/False-positive
  (finding:verify-gated)
- **Reports** — generate any of the four report types (report:export-gated)
  and view one, including its integrity status (`integrityValid`)
- **Engines** — health table + a manual health-check trigger (system:manage-gated)

RBAC is enforced server-side as always (M2) — the UI only hides actions a
user's token doesn't carry the permission for; every button still goes
through the real permission check on the API.

## Development

```bash
npm install --prefix bci/ui
cp bci/ui/.env.example bci/ui/.env   # point VITE_BCI_API_URL at your BCI API
npm run dev --prefix bci/ui          # http://localhost:5173
npm test --prefix bci/ui
```

Verified end-to-end during development with a real BCI API + a headless
browser: login, dashboard scores loading from real data, creating an asset
through the UI and seeing it land in the database, and logout all worked
against the actual running stack, not mocks.
