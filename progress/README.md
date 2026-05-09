# Progress System

Sistema de trazabilidad para seguir el progreso de features desde requisitos hasta QA.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `requirements.md` | Documento formal de requisitos (RFs + RNFs) |
| `tasks.md` | Tracker de features con estado, responsables, y fase |
| `current.md` | Bitácora en tiempo real de la sesión actual |
| `history.md` | Historial de sesiones cerradas (append-only) |
| `versions.md` | Registro de versiones publicadas (tags Docker) |
| `design-{feature}.md` | Documento de diseño de arquitectura |
| `impl-{feature}.md` | Reporte de implementación |
| `review-{feature}.md` | Resultado de revisión de QA |

## Flujo de trabajo

```
backlog → designing → planned → implementing → testing → done
                           ↑                     │
                           └─────────────────────┘ (QA requests changes)
```

## Estados de un feature

| Estado | Descripción |
|--------|-------------|
| `backlog` | Definida pero no planificada |
| `designing` | Arquitecto diseñando la solución |
| `planned` | Diseño completado, lista para implementar |
| `implementing` | Developer trabajando en la implementación |
| `testing` | QA verificando la implementación |
| `done` | Feature completada y verificada |

## Uso en sesión

1. **Al inicio de cada sesión**, actualizar `current.md` con:
   - Feature en curso
   - Fase actual
   - Plan de la sesión

2. **Durante la sesión**, mantener `current.md` actualizado en tiempo real.

3. **Al cerrar la sesión**, mover el contenido relevante de `current.md`
   a `history.md` (al final, sin editar entradas anteriores).
