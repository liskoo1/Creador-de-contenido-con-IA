# Tarea: ONBOARD-001 — Conocer el proyecto antes de una implementación

- Estado: done
- Objetivo observable: mapa del producto, arquitectura, flujos y límites contrastado con código actual.
- Responsable / especialidad: director (integración e interfaz); subagente `arquitectura` (generación/multimedia); subagente `automatizacion` (calendario/publicación/datos).
- Revisor independiente: subagente `revision`, especialidad QA.
- Contexto y evidencia: petición de Luis del 7 de noviembre de 2026; AGENTS.md, WORKFLOW.md, TEAM.md, BACKLOG.md; MCP y archivos actuales.
- Archivos asignados en exclusiva: solo director escribe `docs/workspace/PROJECT_MAP.md`, esta tarea, BACKLOG.md y DECISIONS.md. Especialistas en lectura, con ámbitos distintos; QA puede leer todos los ámbitos.
- Dependencias: QA contrasta resultados de exploración y revisa el informe integrado.
- Riesgo dominante: tomar documentación histórica o índice parcial como descripción operativa actual.
- Fuera de alcance: implementación funcional, corrección de defectos, acceso a cuentas o secretos, publicación y consumo de generación.
- Skills y herramientas: director-proyecto; ECC onboarding, agentic-engineering, backend y revisión; MCP Codebase Memory; colaboración nativa y ejecución local.
- Criterios de aceptación: tres capas identificadas; flujos y persistencia localizados; discrepancias sustentadas; revisión independiente y verificaciones seguras; límites explícitos.
- Pruebas pertinentes: lectura comparada, sintaxis de entradas y suite editorial aislada.
- Acciones externas: ninguna solicitada ni ejecutada.

## Entrega del especialista

- Código funcional sin cambios. Informe integrado: [PROJECT_MAP.md](../PROJECT_MAP.md).
- Director: siete pruebas editoriales aprobadas con proveedores simulados.
- QA: sintaxis de frontend y servidor válida; contratos rotos de UI y publicación diferida confirmados estáticamente.
- Arquitectura y automatización: MCP contrastado con disco; puntos de entrada y dependencias identificados.
- Suite completa y operación real no ejecutadas; datos, proveedores y navegador no validados.
- No se estimó consumo de agentes ni duración como si fueran mediciones disponibles.

## Revisión e integración

- Revisión independiente del informe: QA `revision` dio conformidad a PROJECT_MAP.md y esta tarea, sin correcciones obligatorias. Confirmó arquitectura, discrepancias, separación entre pruebas simuladas y operación real y límites del alcance.
- Decisión de alcance: documentar antes de diseñar la siguiente implementación, sin corregir hallazgos automáticamente.
- Comprobaciones del director: MCP de raíz correcta, contraste con archivos actuales, siete pruebas editoriales aprobadas y lectura del informe guardado; historial de cambios funcionales conservado.
- Estado final: done para exploración documental; defectos funcionales y validación operativa permanecen pendientes en BACKLOG.md.
