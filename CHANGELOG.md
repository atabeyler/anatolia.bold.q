# Changelog

All notable changes to ANATOLIA-Q are documented in this file, grouped by date. Format loosely follows [Keep a Changelog](https://keepachangelog.com/). The current release version is tracked in `package.json` / `server/package.json` / `client/package.json` and bumped automatically on every commit (`scripts/bump-version.js`, run via a pre-commit hook) — this file groups the *meaningful* changes behind those version bumps, not every patch increment.

## 2026-08-06

### Added
- Real IBM Quantum hardware verification for the BDDK/BTK fraud-detection module — a swap-test circuit checks the exact statevector kernel's fidelity value for the highest-risk vs. most-typical transaction pair on real hardware, as a separate, clearly-labeled data point that never affects the deterministic `riskScore`/`flagged` decision
- `API.md` — full endpoint reference across all 8 route groups

### Fixed
- The `/generate` response's `quantum` and `fraud` fields were missing `hardwareVerification`/`ibmDiagnostic` even when a real IBM hardware run succeeded — an explicit field whitelist in the route handler hadn't been updated to include them
- The "all AI providers failed" error was shown to users verbatim in Turkish regardless of their selected UI language, since it's a server-side error message that was never routed through the client's i18n system. The error now carries a machine-readable `code` (`ALL_AI_PROVIDERS_FAILED`) end-to-end so `AnalysisView.jsx`/`ConsultChat.jsx` can substitute a properly localized message in all 5 supported languages instead

## 2026-08-04

### Fixed
- `parseOptimizationProblem` never matched the AI's actual Turkish output because it searched for ASCII `I` instead of the Turkish dotted `İ` (U+0130), which isn't case-fold-equivalent — quantum portfolio optimization was silently disabled in every report
- `/api/analysis/chat` (danışma consultation) could return an empty `200` response with no body: a streaming AI provider failure (e.g. a billing/credit issue) that completes with zero chunks instead of throwing wasn't detected, so the code never fell back to the next provider
- IBM hardware transpilation failing with `Invalid plugin name ibm_dynamic_circuits for stage translation` (a known qiskit/qiskit-ibm-runtime plugin-resolution bug) — fixed via an explicit `translation_method="translator"`
- `/api/analysis/quantum-status` always reported the local-simulator backend name regardless of whether a real IBM hardware run succeeded or failed, making it impossible to diagnose IBM configuration issues from the health check alone
- Quantum scenario probability matrices were silently dropped (disabling quantum computation for the whole report) when the AI wrapped a scenario's title cell in markdown bold

## 2026-08-03

### Added
- Real-data integration path: uploaded CSV/XLSX transaction, scenario, and optimization tables are used directly instead of AI-synthesized sample data
- PDF download and native share buttons alongside the existing DOCX download
- Email notifications for emergency broadcasts, direct messages, and video meeting starts
- Test coverage for auth, emergency, file upload, and all remaining client components

### Fixed
- Markdown (`**bold**`, `<br>`, stray asterisks) leaking into generated DOCX/PDF reports instead of being rendered
- Turkish characters rendering as garbled text in generated PDFs
- DOCX table columns rendering one character per line
- PDF content getting squeezed into a sliver after a table
- Quantum computation failures previously failed silently — now surfaced as a `quantumWarning` in both the API response and the report body
- Various security review findings across auth, emergency, and upload flows

### Changed
- Shortened JWT session lifetime to 4h (admin) / 2h (mail-approved login), down from a longer-lived token
- `getCurrentUser` now rejects an expired JWT instead of trusting a stale local token
- Sidebar starts collapsed by default on mobile/small screens
- Updated the Gemini model used by the AI fallback chain

---

Earlier history (initial project setup through the first working version) predates this file and is available via `git log`.
