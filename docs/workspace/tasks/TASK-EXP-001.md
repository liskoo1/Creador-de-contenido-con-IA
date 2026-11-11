# Tarea: EXP-001 — Experimentos y Revisión Basada en Evidencia para Helpmeagro

- Estado: done
- Objetivo observable:
  1. Diseñar e implementar el módulo de experimentos editoriales y evaluación de rendimiento empírico en `backend/server.js` y `backend/services/experimentService.js` (o enrutamiento modular).
  2. Implementar endpoint `GET /api/experiments`:
     - Agrupa publicaciones por formato (`carousel`, `reel`, `single`/`image`, `news-post`, `price-story`).
     - Calcula métricas agregadas y comparativas (media de alcance, media de guardados, media de SRR = `saved / reach * 100`).
     - Respeta de forma estricta la distinción entre ausencia de métricas (`null`), cero real (`0`) y valores reportados.
     - Identifica la pieza ganadora (*top performer*) por SRR en cada categoría con evidencia real.
  3. Implementar endpoint `POST /api/posts/:id/hypothesis` para registrar o actualizar hipótesis editoriales sobre un post (`angle`, `expectedOutcome`, `status`).
  4. Crear suite de pruebas exhaustiva en `backend/tests/experiments.test.js` con `node:test`.
  5. Asegurar que la suite completa del backend se mantiene en 100% verde sin regresiones.
- Responsable / especialidad: backend (`project_backend`)
- Revisores independientes: estratega Instagram (`project_instagram_strategist`) y qa-reviewer (`project_qa_reviewer`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `backend/services/postService.js`: acceso a posts y persistencia de hipótesis.
  - `backend/server.js`: rutas `/api/experiments` y `/api/posts/:id/hypothesis`.
  - `docs/workspace/DECISIONS.md`: decisión `D-012` sobre el Índice de Relevancia Técnica (SRR).
- Archivos asignados en exclusiva:
  - `backend/services/experimentService.js`
  - `backend/routes/experiments.js` (o integración en `backend/server.js`)
  - `backend/tests/experiments.test.js`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), Estrategia y QA (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Confundir falta de datos con bajo rendimiento o calcular tasas con división por cero si reach es 0 o null.
- Fuera de alcance: Automatización de compra de anuncios o publicaciones sin autorización de Luis.
- Skills ECC y herramientas verificadas: `backend-patterns`, `testing`, `verification-loop`.
- Criterios de aceptación:
  1. `GET /api/experiments` devuelve resumen global y desglose por formato con totales, promedios y lista de piezas evaluadas.
  2. El cálculo de SRR (`(saved / reach) * 100`) maneja con seguridad casos donde `reach` es 0, `null` o no reportado, devolviendo `null` y nunca `NaN` ni `Infinity`.
  3. Posts sin métricas registradas (`post.metrics === null`) se contabilizan como `pending_metrics` y no alteran los promedios de piezas medidas.
  4. `POST /api/posts/:id/hypothesis` valida los campos y persiste `angle`, `expectedOutcome` y `notes` en el post.
  5. Suite de pruebas en `backend/tests/experiments.test.js` pasa al 100% y la suite global supera los 80 tests en verde.
- Pruebas o comprobaciones pertinentes: `node --test --test-concurrency=1 tests/*.test.js`.
- Autorización aplicable a acciones externas, si las hubiera: Solo memoria y persistencia local en disco.

## Entrega del especialista

- **Estado:** Implementado y listo para revisión.
- **Archivos creados o modificados:**
  - [`backend/services/experimentService.js`](file:///c:/Users/luis_/OneDrive/Escritorio/Pc%20casa%20drive/Creador%20de%20contenido%20con%20IA/backend/services/experimentService.js): Servicio con `calculateSRR(saved, reach)`, `resolvePostFormat(post)`, `isPostMeasured(post)`, `analyzeExperiments(posts)` y `setPostHypothesis(postId, hypothesisData)`.
  - [`backend/server.js`](file:///c:/Users/luis_/OneDrive/Escritorio/Pc%20casa%20drive/Creador%20de%20contenido%20con%20IA/backend/server.js): Montaje de endpoints REST `GET /api/experiments` y `POST /api/posts/:id/hypothesis`, exportación de `experimentService`.
  - [`backend/tests/experiments.test.js`](file:///c:/Users/luis_/OneDrive/Escritorio/Pc%20casa%20drive/Creador%20de%20contenido%20con%20IA/backend/tests/experiments.test.js): Suite exhaustiva con 22 pruebas automatizadas en `node:test`.
- **Comportamiento observable:**
  - Cálculo blindado de Save-to-Reach Ratio: `(saved / reach) * 100` con redondeo a 2 decimales; devuelve `null` ante reach <= 0, no reportado, `NaN` o valores no finitos, impidiendo divisiones por cero.
  - Distinción de posts con métricas cuantitativas (`measured`) vs posts sin métricas o pendientes (`pending_metrics`).
  - Agregación por formato (`carousel`, `reel`, `single`, `news-post`, `price-story`) y resumen global: totales, posts medidos, posts pendientes, `averageReach` (redondeado a 1 decimal), `averageSaved`, `averageSRR` y selección de `topPerformer`. Exclusión rigurosa de posts sin métricas en los promedios.
  - Registro de hipótesis editorial (`angle`, `expectedOutcome`, `notes`, `status` activo/validado/invalidado) con marcas temporales `createdAt` y `updatedAt`.
- **Resultados de verificación:**
  - `node --test --test-concurrency=1 backend/tests/*.test.js` ejecutado con éxito:
    - 94 tests totales en verde (72 preexistentes + 22 nuevos).
    - 0 fallos, 0 cancelados, 0 omitidos.
- **Acciones simuladas vs reales:**
  - Pruebas HTTP ejecutadas contra instancia efímera de Express con mocks en memoria para postService sin mutaciones residuales en base de datos.
  - Pruebas unitarias ejecutadas directamente con persistencia temporal aislada mediante backups en disco.
- **Límites y pendientes:**
  - Pendiente revisión independiente de Estrategia Instagram y QA.


## Revisión e integración

- **Estratega de Instagram (`project_instagram_strategist`):**
  - **Dictamen:** APROBADO.
  - **Evidencia:** Alineación impecable con el público profesional agropecuario de Helpmeagro (productores y técnicos de invernadero en Almería). Validación de la métrica Save-to-Reach Ratio (SRR) como indicador fidedigno de relevancia técnica frente a métricas superficiales de vanidad. Aprobada la normalización en los 5 formatos acordados (`carousel`, `reel`, `single`, `news-post`, `price-story`) y el ciclo de vida de hipótesis (`active`, `validated`, `invalidated`).
- **QA Reviewer Independiente (`project_qa_reviewer`):**
  - **Dictamen:** APROBADO (5/5 Criterios de Aceptación cumplidos al 100%).
  - **Evidencia:**
    * CA 1: `GET /api/experiments` devuelve resumen global y desglose por formato con totales, promedios y lista detallada.
    * CA 2: `calculateSRR` blindado contra `reach <= 0`, valores no finitos, nulos y tipos no numéricos; devuelve legítimamente 0 numérico para `saved = 0` con `reach > 0`.
    * CA 3: Posts no medidos se marcan como `pending_metrics` y quedan estrictamente excluidos de los divisores de promedio.
    * CA 4: `POST /api/posts/:id/hypothesis` valida exhaustivamente parámetros obligatorios (angle) y de estado (active, validated, invalidated) persistiendo atómicamente.
    * CA 5: Suite global de pruebas pasando al 100% (94 de 94 tests en verde, 0 fallos).
    * Auditoría de seguridad: cero comandos de borrado recursivo.
- **Integración Técnica:**
  - Integrado y aprobado por el Director Técnico el 4 de noviembre de 2026. Decisión arquitectónica registrada en `D-015`. Se cierra `EXP-001` a estado `done`.
