# Health check

```
GET /health
```

```json
{
  "status": "healthy",
  "connection": "connected",
  "phoneNumber": "5215512345678",
  "uptimeSeconds": 84321,
  "reconnections": 2
}
```

Posibles valores de `status`: `healthy` (conectado), `degraded` (conectando o esperando QR) y
`unhealthy` (resto de estados).

La respuesta incluye además un bloque `transport` con los contadores de PostgreSQL:

```json
"transport": {
  "postgres": {
    "conexionesCorrompidas": 0,
    "vigilante": { "terminados": 0, "ultimaRevision": "2025-05-08T12:00:00.000Z", "error": null }
  }
}
```

- `conexionesCorrompidas`: conexiones del pool descartadas por quedar en un estado inservible.
- `vigilante`: estadísticas del vigilante del pool (transacciones colgadas terminadas, última
  revisión y último error). Solo aparece con `SESSION_STORE=postgres`.

Este endpoint **no requiere autenticación**. Está diseñado para orquestadores (Kubernetes, Docker Swarm, etc.). Corre en el puerto `HEALTH_PORT` (default `9877`), separado de la API REST.
