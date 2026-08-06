# Contributing to ANATOLIA-Q

This is a proprietary, closed-source project (see [README.md](./README.md)'s License section) — this guide is for internal team members and authorized collaborators with repository access, not a public open-source contribution workflow. This project spans a Node.js/Express backend, a React frontend, and a set of Python/Qiskit quantum computing modules — see [README.md](./README.md) for the architecture overview and [API.md](./API.md) for the endpoint reference before diving in.

## Getting set up

Follow the **Local Development** section of the README. Both `npm test --prefix server` and `npm test --prefix client` should pass before you open a pull request; for Python changes under `server/quantum/`, also run `python3 -m py_compile <file>.py` and, where practical, a local sanity check against `AerSimulator` (see the existing scripts for the pattern).

## Making a change

1. Create a branch off `main` in this repo (no forking — access is by invitation).
2. Keep changes focused — a bug fix shouldn't bundle in unrelated refactors.
3. Add or update tests alongside any behavior change. This codebase treats a fix without a regression test as incomplete, not merely nice-to-have — several real production bugs here were caused by test fixtures that didn't match real-world input (see `CHANGELOG.md`'s 2026-08-04 entries for examples).
4. Run the full test suite, `tsc --noEmit`, and `eslint .` in `server/` before opening a PR.
5. Write commit messages that explain *why*, not just *what*.

## Reporting issues

Open a GitHub issue (repository access required) with: what you expected, what actually happened, and (if applicable) the exact request/response that reproduces it. For anything touching authentication, the emergency system, or fraud detection, please flag it as security-sensitive in the issue title.

## Code style

- Backend: ESM, TypeScript where the file already uses it (`.ts`), plain JS elsewhere — don't convert `.js` files to `.ts` as part of an unrelated change.
- No unused abstractions — this project prefers duplicated logic over a premature shared helper (see the root `CLAUDE.md` working rules if you're using an AI coding assistant against this repo).
- Match the existing comment style: comments explain *why* (a non-obvious constraint, a workaround for a specific bug), not *what* the code does.

## Security

Do not open a public issue for a suspected security vulnerability. See [SECURITY.md](./SECURITY.md) for how to report one privately.
