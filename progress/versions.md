# Version Registry

> Registro interno de versiones publicadas (tags Docker).
> Formato: SemVer estricto (`v<major>.<minor>.<patch>`).

| Versión | Fecha | Tipo | Features incluidas |
|---------|-------|------|--------------------|
| v0.1.0 | — | initial | RF-01 Conexión WhatsApp, RF-02 Mensajería, RF-03 Integración externa, INFRA-01 Docker |

## Próxima versión

- **Actual:** v0.1.0
- **Siguiente:** v0.1.1 (patch por defecto)
- **Features pendientes de empaquetar:** RF-04 Entrega mensajes entrantes, RF-05 PostgreSQL Session Store, RF-01.11 RedisStore

---

## Política de versionado

| Tipo | Cuándo | Comando |
|------|--------|---------|
| **patch** | Bugs, refactors, cambios menores (default) | `v0.1.0` → `v0.1.1` |
| **minor** | Nuevas features, cambios no rompientes | `v0.1.0` → `v0.2.0` |
| **major** | Breaking changes, rewrites | `v0.1.0` → `v1.0.0` |
