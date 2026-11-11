# Tarea: PLAN-001 — Revisión de Presupuesto Editorial y Cupo Unificado del Calendario

- Estado: done
- Objetivo observable:
  1. Establecer un presupuesto editorial unificado y verificable en `botStateService.js` (cupo mensual/semanal de feed y límite diario de publicaciones feed).
  2. Corregir la inyección indiscriminada de noticias en `scheduler.js` para que noticias y piezas creativas compartan un cupo de feed común (ej. máximo 1 post de feed por día, donde las noticias rellenan días sin creatividad en lugar de duplicar publicaciones).
  3. Mantener las historias de precios (`price-story`) en su carril diario (lunes a sábado) sin saturar el feed principal.
  4. Crear suite de pruebas en `backend/tests/scheduler_budget.test.js` con `node:test` validando el cumplimiento estricto del cupo y reglas de distribución.
- Responsable / especialidad: backend (`project_backend`)
- Revisores independientes: estratega Instagram (`project_instagram_strategist`) y qa-reviewer (`project_qa_reviewer`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `backend/automation/scheduler.js`: método `enrichScheduleWithBudget` y refactorización de `runMonthlyPlanning`.
  - `backend/services/botStateService.js`: métodos `getEditorialBudget` y `updateEditorialBudget` con `DEFAULT_EDITORIAL_BUDGET`.
- Archivos asignados en exclusiva:
  - `backend/services/botStateService.js`
  - `backend/automation/scheduler.js`
  - `backend/tests/scheduler_budget.test.js`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), Estratega y QA (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Sobresaturación del feed (60-90 piezas/mes) por superposición no regulada de noticias sobre creatividades, diluyendo el alcance orgánico en Instagram.
- Fuera de alcance: Modificar la generación de vídeo o prompts de los agentes.
- Skills ECC y herramientas verificadas: `content-engine`, `backend-patterns`, `verification-loop`, `code-reviewer`.
- Criterios de aceptación:
  1. `botStateService` expone y persiste `getEditorialBudget()` / `updateEditorialBudget()`. [CUMPLIDO]
  2. En `scheduler.js`, las noticias (`news-post`) solo se planifican como relleno en días sin creatividad o respetando el límite configurado (`maxDailyFeedPosts: 1`). [CUMPLIDO]
  3. El total de publicaciones de feed en el mes resultante no supera el cupo establecido (`maxMonthlyFeedPosts: 24`). [CUMPLIDO]
  4. Las historias de precios (`price-story`) se preservan de lunes a sábado sin contabilizar contra el cupo de feed. [CUMPLIDO]
  5. Suite de pruebas en `backend/tests/scheduler_budget.test.js` pasando al 100% sin regresiones (17 tests, 58 globales). [CUMPLIDO]
- Pruebas o comprobaciones pertinentes: `node --test tests/scheduler_budget.test.js`.
- Autorización aplicable a acciones externas, si las hubiera: Solo lectura y pruebas en memoria sin crons activos.

## Entrega del especialista (`project_backend`)

- **Archivos modificados:**
  - `backend/services/botStateService.js`: Añadido objeto `DEFAULT_EDITORIAL_BUDGET` (`maxDailyFeedPosts: 1`, `maxMonthlyFeedPosts: 24`, `allowNewsOnCreativeDays: false`, `includePriceStoriesInFeedBudget: false`), métodos `getEditorialBudget()` y `updateEditorialBudget(budget)` con validación y persistencia atómica en `data/botState.json`.
  - `backend/automation/scheduler.js`: Extracción de `enrichScheduleWithBudget(...)`, desacoplamiento del algoritmo de calendario, filtro de feed y regulación de noticias para que actúen como relleno en días sin creatividad respetando el límite mensual de 24 piezas.
  - `backend/tests/scheduler_budget.test.js`: Suite completa de 17 tests unitarios y de integración para control diario, mensual y de Stories de precios.
- **Pruebas ejecutadas:** 17/17 tests de presupuesto editorial pasando; 58/58 tests globales en verde.

## Revisión e integración

- **Revisión Estratégica (`project_instagram_strategist`):**
  - Veredicto: **APROBADO**.
  - Confirma que el límite de 1 post diario (`maxDailyFeedPosts: 1`) evita la canibalización del alcance orgánico (que requiere de 18 a 36h para que el algoritmo explore la audiencia).
  - Valida el carril independiente de Stories de lunes a sábado a las 08:30 con descanso dominical natural.
- **Revisión de QA (`project_qa_reviewer`):**
  - Veredicto: **CONFORME / APROBADO (5/5 Criterios Cumplidos)**.
  - Confirma 0 regresiones, 100% de respeto al alcance, aislamiento con backup/restauración de `botState.json` en tests, y orden cronológico estricto.
- **Integración por el Director Técnico:**
  - Registro de decisión `D-013` en `docs/workspace/DECISIONS.md`.
  - Actualización de `docs/workspace/BACKLOG.md` pasando `PLAN-001` a estado `done`.
  - Estado final: `done`.
