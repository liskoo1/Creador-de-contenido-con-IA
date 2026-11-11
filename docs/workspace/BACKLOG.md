# Backlog del proyecto

Actualizado: 7 de noviembre de 2026. Estados: [WORKFLOW.md](WORKFLOW.md).
Este tablero no ejecuta tareas ni activa automatizaciones.

| ID | Prioridad | Estado | Trabajo | Responsable propuesto | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| PLAN-BIZ-001 | P1 | done | Planificar contexto de negocio desde web, capturas y preview lateral | Director + arquitectura + frontend + QA/seguridad | [Plan](PLAN_BUSINESS_CONTEXT.md) con contratos, fases y criterios; conformidad documental QA/seguridad y corrección de redacción incorporada; implementación sin iniciar |
| BIZ-IMPORT-001 | P1 | done | Implementar extracción de contexto desde web y capturas móvil/escritorio | Backend + frontend + QA/seguridad | Borrador con fuentes, capturas responsive Playwright, anti-SSRF, fusión no destructiva con baseRevision y 15 tests pasando |
| ASSET-PREVIEW-001 | P1 | done | Abrir imágenes desde la lista lateral de contexto | Frontend + QA | Visor accesible con teclado/Escape, preservación de borrado independiente y compatibilidad con capturas |
| ONBOARD-001 | P1 | done | Conocer el proyecto antes de la siguiente implementación | Director + arquitectura + backend + QA | [Mapa actual](PROJECT_MAP.md), MCP contrastado con disco, siete pruebas aisladas aprobadas y conformidad QA independiente |
| PUB-002 | P0 | todo | Revisar contrato y resultados de publicación diferida | Backend + QA | Resolver método/campo de claim inexistente y validar éxito parcial/reintentos; hallazgo estático del onboarding, corrección aún no iniciada |
| UI-001 | P1 | todo | Conectar controles de caption y métricas y selección editorial | Frontend + backend + QA | Eventos del panel definidos y selección instagramSkill transmitida en el recorrido previsto |
| SCHED-002 | P1 | todo | Revisar convivencia semanal/mensual y planificación con autopiloto apagado | Backend + QA | Conservación de pendientes, validación temporal y control de planificación automática con pruebas aisladas |
| MEDIA-001 | P1 | todo | Revisar propagación de proveedor de vídeo y errores de montaje | Backend + QA | Proveedor transmitido al editor y estado final coherente con medios realmente producidos |
| WS-001 | P0 | done | Preparar el espacio de trabajo y el flujo de delegación | Director + arquitectura + compatibilidad | Contrato, roles, adaptador Antigravity e instalador validados con revisión independiente |
| WS-002 | P0 | done | Instalar la skill y los seis perfiles persistentes en Antigravity | Director + compatibilidad | Paquete instalado en `.agents`, perfiles activos y delegación verificada con sesiones reales |
| ARCH-001 | P0 | done | Análisis y exploración de arquitectura con Codebase Memory | Arquitectura + QA | Mapa de dependencias, contratos, hotspots y riesgos contrastado en disco y aprobado por QA |
| IG-001 | P1 | done | Primera integración editorial de las 13 skills de Instagram | Backend + frontend + QA | Revisión independiente completada (QA + Estratega), adaptación a Helpmeagro y 7 tests pasando |
| PUB-001 | P0 | done | Corregir falso éxito en aprobación por correo | Backend + QA + seguridad | Ninguna red se marca publicada al fallar; éxito parcial, desbloqueo de reintentos y error handling cubiertos con 12 tests |
| DATA-001 | P0 | done | Persistir identificadores y resultados por plataforma | Backend + arquitectura | IDs devueltos por Meta y fechas reales vinculados al post, unificando lógica entre API manual y webhook |
| MET-001 | P0 | done | Incorporar Instagram Insights o importación explícita | Backend + estrategia Instagram + QA | Métricas con origen/fecha, permisos verificados y ausencia diferenciada de cero con 22 tests |
| PLAN-001 | P1 | done | Revisar presupuesto editorial del calendario | Estrategia Instagram + backend | Noticias y creatividades contabilizadas en un único cupo y reglas verificables con 17 tests |
| EXP-001 | P1 | done | Experimentos y revisión semanal basada en evidencia | Estrategia Instagram + backend | Hipótesis y resultados comparables por pieza; depende de MET-001 |
| OPS-001 | P1 | done | Revisar exposición del panel y coherencia horaria | Seguridad + backend | Autenticación/estado público revisados y fechas de negocio coherentes en Europe/Madrid |
| POE-001 | P0 | done | Validar y corregir el contrato y el coste real de Poe | Backend + QA + Seguridad | [F4] current_point_balance, parámetros reales, ffprobe, .tmp atómico, anti-SSRF y 25 tests |
| POE-002 | P1 | done | Integrar Poe como proveedor visual opcional | Backend + arquitectura + QA | Adaptador en Agent.js y AgentOrchestrator.js con soporte imageModel/videoProvider poe y characterLock |
| AUTO-AUDIT-001 | P1 | done | Auditar autonomía semanal de Instagram y estado real de Poe | Director + especialistas + QA | [Informe](../../INFORME_AUTOMATIZACION_INSTAGRAM_2026-11-05.md) contrastado con código y aprobado por QA independiente; validación real pendiente distinguida |
| AUTO-PLAN-001 | P1 | done | Ejecutar por etapas la propuesta de operación autónoma | Arquitectura + backend + QA | Rutinas agro protegidas (protectAgroRoutines), separación generar/aprobar/publicar, webhook anti-prefetch, 121 tests |
| WEEKLY-001 | P0 | done | Planificación semanal basada en métricas y conmutación de proveedor | Backend + Estrategia + QA | MEDIA_PROVIDER ("poe" | "google") en .env, cron semanal los lunes, selección por SRR/formato y 125 tests |


## Evidencia inicial y límites

La integración IG-001 existe como cambios locales del trabajo anterior. Se
reportaron siete pruebas aprobadas con proveedor simulado; no se comprobó la
interfaz en navegador ni se hizo una publicación real. Detalles:
[integración de Instagram](../instagram-integration.md).

Los hallazgos PUB-001, DATA-001 y MET-001 provienen de la auditoría inicial del
código. Su presencia aquí no significa que estén corregidos. Al comenzar cada
tarea, contrastar el estado actual antes de modificarlo.

La petición actual autoriza configurar el espacio de trabajo. La ejecución de
este backlog se organiza después según las prioridades del usuario; crear este
tablero no implica publicar contenido ni modificar una cuenta de Instagram.
