# Tarea: PLAN-BIZ-001 — Plan de contexto web y preview de activos

- Estado: done
- Objetivo observable: plan implementable para autocompletar contexto y capturas desde URL, preservando manual y biblioteca.
- Responsable / especialidad: director integra; arquitectura diseña extracción/capturas; especialista frontend explora lista/biblioteca.
- Revisor independiente: QA/seguridad `revision`.
- Contexto: petición de Luis del 7 de noviembre de 2026; [plan](../PLAN_BUSINESS_CONTEXT.md), código real y PROJECT_MAP.
- Archivos asignados: especialistas solo lectura; director escribe plan, esta tarea, BACKLOG y DECISIONS. No código funcional.
- Dependencias: contratos antes de implementación; revisión documental antes de cierre de esta tarea de planificación.
- Riesgo dominante: prometer extracción/capturas por un prompt o sobrescribir contexto manual.
- Fuera de alcance: implementación, instalaciones, capturas reales, publicaciones y nuevas automatizaciones.
- Skills/herramientas: brainstorming, director-proyecto, ECC planner y seguridad/revisión; MCP Codebase Memory, lectura local y documentación oficial.
- Criterios: flujo UX, alternativas, componentes/rutas, fases/propietarios, límites, seguridad, pruebas y conservación de datos explícitos.
- Pruebas: contraste documental/código y revisión independiente; no ejecución de función aún inexistente.
- Acciones externas: consulta de documentación pública; sin acceso a negocio/cuentas/secretos.

## Entrega del especialista

- Arquitectura: la ruta URL actual no extrae; grounding no garantiza evidencia; capturas requieren herramienta en backend.
- Frontend: lista lateral sin handler; biblioteca actual muestra imágenes pero no tiene visor individual reutilizable.
- QA/seguridad: fuentes no confiables, SSRF de navegador, preservación manual, aplicación coherente y roles de activos incorporados al plan.
- Cambios: documentación; ninguna modificación funcional ni prueba real de captura/extracción.

## Revisión e integración

- Revisión independiente: QA/seguridad dio conformidad documental de arquitectura, alcance, conservación manual y seguridad. Solicitó precisar que analizar sí guarda temporales/manifiestos, pero no modifica contexto ni activos aceptados; se corrigió la fase 3.
- Integración: límites iniciales de puertos, redirects, bytes, solicitudes y tokens explicitados como propuesta, sin presentarlos como validación real.
- Estado final: done para planificación revisada; diseño pendiente de aceptación del usuario e implementación sin iniciar.
