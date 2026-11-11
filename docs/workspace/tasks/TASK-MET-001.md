# Tarea: MET-001 — Incorporación de Instagram Insights y Métricas por Publicación

- Estado: done
- Objetivo observable:
  1. Integrar lectura de métricas de Instagram Graph API (`getMediaInsights`) para publicaciones con identificador Meta (`publishedPlatformIds.instagram`).
  2. Implementar endpoints en backend para consulta (`GET /api/posts/:id/metrics`), sincronización remota (`POST /api/posts/:id/metrics/sync`) e importación explícita manual (`POST /api/posts/:id/metrics/import`).
  3. Diferenciar estrictamente la ausencia de métricas (`null`) de valores legítimos en cero (`0`).
  4. Registrar metadatos de métricas: origen (`api` o `manual`), fecha de consulta (`fetchedAt`) y permisos validados.
  5. Suite de pruebas automatizadas con `node:test` en `backend/tests/metrics.test.js`.
- Responsable / especialidad: backend (`project_backend`)
- Revisores independientes: qa-reviewer (`project_qa_reviewer`) y estratega Instagram (`project_instagram_strategist`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `backend/services/postService.js`: estructura del post con `metrics` y método `updateMetrics`.
  - `backend/automation/instagramPublisher.js`: método `getMediaInsights(mediaId)`.
  - `backend/server.js`: rutas REST `/api/posts/:id/metrics`, `/sync` e `/import`.
  - Dependencia de `DATA-001`: consume `post.publishedPlatformIds.instagram`.
- Archivos asignados en exclusiva:
  - `backend/automation/instagramPublisher.js`
  - `backend/services/postService.js`
  - `backend/server.js`
  - `backend/tests/metrics.test.js`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), QA y Estratega (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Confundir datos no consultados (`null`) con cero alcance (`0`), o romper ante tokens de Meta con permisos limitados (`instagram_manage_insights`).
- Fuera de alcance: Modificar la generación de vídeo o crons de scheduler.
- Skills ECC y herramientas verificadas: `backend-patterns`, `api-design`, `verification-loop`.
- Criterios de aceptación:
  1. `getMediaInsights(mediaId)` consulta Graph API v25.0 (`/{mediaId}/insights?metric=impressions,reach,saved,total_interactions`) o maneja error/mock sin excepciones no capturadas. [CUMPLIDO]
  2. Los valores no disponibles se representan como `null` y nunca como `0`. Los ceros reales se preservan numéricamente. [CUMPLIDO]
  3. `GET /api/posts/:id/metrics` devuelve las métricas con su timestamp y origen. [CUMPLIDO]
  4. `POST /api/posts/:id/metrics/import` valida campos numéricos no negativos y registra `origin: 'manual'`. [CUMPLIDO]
  5. Suite de pruebas pasando al 100% en `backend/tests/metrics.test.js` (22 tests, 41/41 globales). [CUMPLIDO]
- Pruebas o comprobaciones pertinentes: `node --test tests/*.test.js`.
- Autorización aplicable a acciones externas, si las hubiera: Solo lectura y pruebas simuladas locales sin llamadas reales a Meta.

## Entrega del especialista (`project_backend`)

- **Archivos modificados:**
  - `backend/automation/instagramPublisher.js`: Método `getMediaInsights(mediaId)` con llamada a Meta Graph API v25.0, captura resiliente de errores y mapeo riguroso de métricas (`impressions`, `reach`, `saved`, `total_interactions`).
  - `backend/services/postService.js`: Método `updateMetrics(id, metricsData)` con fusión atómica y persistencia.
  - `backend/server.js`: Endpoints `GET /api/posts/:id/metrics`, `POST /api/posts/:id/metrics/sync` (con validación de `publishedPlatformIds.instagram`), y `POST /api/posts/:id/metrics/import` con validación estricta de tipos numéricos no negativos.
  - `backend/tests/metrics.test.js`: Suite con 22 pruebas automatizadas unitarias y de integración HTTP con puerto efímero.
- **Pruebas ejecutadas:** 22/22 tests de métricas pasando; 41/41 tests globales en verde.

## Revisión e integración

- **Revisión Estratégica (`project_instagram_strategist`):**
  - Veredicto: **APROBADO**.
  - Valida la selección de métricas para Helpmeagro y define el **Índice de Relevancia Técnica (SRR = `saved / reach * 100`)** como KPI clave del sector hortofrutícola.
  - Confirma que la distinción estricta de `null` vs `0` previene diagnósticos erróneos sobre piezas recién publicadas o con métricas diferidas.
- **Revisión de QA (`project_qa_reviewer`):**
  - Veredicto: **CONFORME / APROBADO (5/5 Criterios Cumplidos)**.
  - Verifica aislamiento total en tests, 0 mutaciones en archivos de datos reales, tamper-protection en `origin` y `fetchedAt`, y validación exhaustiva de tipos.
- **Integración por el Director Técnico:**
  - Registro de decisión `D-012` en `docs/workspace/DECISIONS.md`.
  - Actualización de `docs/workspace/BACKLOG.md` pasando `MET-001` a estado `done`.
  - Estado final: `done`.
