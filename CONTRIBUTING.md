# Contributing to WACore

Thanks for taking the time to help. Issues and pull requests are welcome in **English or Spanish**.

## Before you start

- **Bugs:** open an issue with the [bug template](https://github.com/Pep3M/WACore/issues/new?template=bug_report.yml). Include your WACore version, how you run it (Docker or source) and the relevant logs, **with phone numbers and keys removed**.
- **Features:** open an issue first so we can agree on the shape of the API before you write code. WACore keeps its HTTP contract stable, so new routes and payload fields need a short discussion.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Local setup

You need [Bun](https://bun.sh) ≥ 1.4.2.

```bash
git clone https://github.com/Pep3M/WACore.git && cd WACore
bun install          # also patches baileys (scripts/patch-baileys.cjs)
cp .env.example .env # set API_KEY, and SESSION_STORE=file for the quickest start
bun run dev          # watch mode
```

For the full stack (PostgreSQL, Redis and the React dev panel in `front/`):

```bash
docker compose -f docker-compose.dev.yml up
```

## Pull requests

1. Branch from `master`.
2. Keep the change focused: one fix or one feature per PR.
3. Add or update tests (`bun:test`, in `src/__tests__/`) and make sure `bun test` passes.
4. If you touch routes, payloads or env vars, update `docs/` and `.env.example` too.
5. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

### Code conventions

- Strict TypeScript, with no `any`.
- kebab-case file names.
- Follow the style of the code around your change. Comments explain *why*, not *what*.
- **Don't break the public contract.** The tests in `src/__tests__/contract/` pin routes, auth and response shapes. If one fails, the change is breaking and must be discussed first.

## Releases

Maintainers cut releases following [SemVer](https://semver.org/): `CHANGELOG.md` and `package.json` are bumped, then a `vX.Y.Z` tag is pushed. The tag builds the Docker image on GHCR and creates the GitHub release, with its notes taken from the changelog.
