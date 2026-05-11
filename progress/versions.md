# Version Registry

> Registro interno de versiones publicadas (tags Docker).
> Formato: SemVer estricto (`v<major>.<minor>.<patch>`).

| Versión | Fecha | Tipo | Features incluidas |
|---------|-------|------|--------------------|
| v0.3.0 | 2026-05-10 | minor | RF-06 Presence & Typing Indicator |
| v0.2.0 | 2026-05-10 | minor | Migración Bun→Node.js, fixes LID/PN, pre-keys, PreKeyError, SSE, QR polling, frontend dev |
| v0.1.1 | 2026-05-08 | patch | Fix DELETE /api/session idempotencia, cleanup sesión en loggedOut |
| v0.1.0 | 2026-05-08 | initial | RF-01 Conexión WhatsApp, RF-02 Mensajería, RF-03 Integración externa, INFRA-01 Docker |

## Próxima versión

- **Actual:** v0.3.0
- **Siguiente:** v0.3.1 (patch por defecto)
- **Features pendientes de empaquetar:** RF-07 Media Download, RF-08 Read Receipts, RF-09 Reactions, RF-10 Quoted, RF-11 Group Mgmt, RF-12 Stickers/PTV, RF-13 Location/Contact, RF-14 Polls, RF-15 Chat Mgmt, RF-16 Commands Avanzados, RF-17 Newsletter, RF-18 Business Profile

---

## Política de versionado

| Tipo | Cuándo | Comando |
|------|--------|---------|
| **patch** | Bugs, refactors, cambios menores (default) | `v0.1.0` → `v0.1.1` |
| **minor** | Nuevas features, cambios no rompientes | `v0.1.0` → `v0.2.0` |
| **major** | Breaking changes, rewrites | `v0.1.0` → `v1.0.0` |
