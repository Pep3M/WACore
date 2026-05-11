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

Este endpoint **no requiere autenticación**. Está diseñado para orquestadores (Kubernetes, Docker Swarm, etc.). Corre en el puerto `HEALTH_PORT` (default `9877`), separado de la API REST.
