# Bitácora histórica (append-only)

> Cada vez que se cierra una sesión, su resumen se añade aquí.
> No edites entradas anteriores. Solo añade al final.

---

## 2025-05-08 — Inicialización del proyecto WACore

- **Agente:** opencode
- **Cambios:** Creación de estructura base del proyecto: .opencode/agents/, progress/, src/
- **Resultado:** Proyecto inicializado con bun, baileys y dependencias base instaladas

---

## 2025-05-08 — Core backend completo (RF-01 + RF-02 + RF-03 + INFRA-01)

- **Agentes:** @software-architect → @developer → @qa-tester
- **Diseño:** 10 componentes, event-driven, pub/sub interno, 8 backoff strategies, file-store con backups
- **Implementación:** 19 archivos fuente (1,578 líneas), 9 fix commits
- **Tests:** 85/85 pass (167 assertions, 13 archivos, 68% cobertura)
- **TypeScript:** 0 errores (strict mode)
- **Infraestructura:** Docker multi-stage, docker-compose (wacore + redis + webhook-sink)
- **QA:** CHANGES_REQUESTED → APPROVED (9 issues: 1C, 4M, 4m — todos resueltos)
- **Resultado:** Backend WACore funcional, listo para integrar con servicios IA

---

## 2025-05-08 — RedisStore implementado

- **Agente:** @developer
- **Implementación:** RedisStore real con ioredis 5.10.1 (reemplaza stub existente)
- **Almacenamiento:** 2 claves Redis por instancia (`wacore:session:{instance}:creds` + `wacore:session:{instance}:keys`)
- **Backup:** BGSAVE manual + persistencia RDB/AOF de Redis
- **Tests:** 13 tests nuevos (98 total, 183 assertions, 14 archivos, 70% cobertura)
- **TypeScript:** 0 errores
- **Resultado:** RedisStore funcional y testeado con mock de ioredis
