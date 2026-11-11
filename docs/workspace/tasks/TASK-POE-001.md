# Tarea: POE-001 — Piloto de Contrato y Validación de Coste de Poe

- Estado: in_progress
- Objetivo observable:
  1. Diseñar e implementar el módulo cliente y adaptador `backend/services/poeService.js` para la integración con Poe API:
     - Consulta del catálogo de modelos (`https://api.poe.com/v1/models`), validando esquemas y parámetros de `nano-banana-2.1` y `gemini-omni-1.1-flash`.
     - Consulta de saldo actual y balance de puntos (`GET /usage/current_balance`).
     - Protocolo de generación de imagen con `nano-banana-2.1` (`image_size: 1K`, `aspect_ratio: 9:16`).
     - Protocolo de generación de clip con `gemini-omni-1.1-flash` (`resolution: 720p`, `aspect_ratio: 9:16`, `task: image_to_video`).
     - Descargador seguro de medios a `backend/output/poe/` validando extensiones, tipos MIME permitidos y tamaño máximo.
     - Extracción de metadatos de vídeo con `ffprobe` (`duration`, `hasAudio`, `audioCodec`, `aspectRatio`).
     - Sistema de control presupuestario y reserva preventiva de puntos (reserva inicial: 40.000 puntos para el piloto, sin reintentos automáticos descontrolados).
     - Manejo riguroso de errores de API (401 credencial inválida, 402 saldo insuficiente, 429 límite de tasa, timeouts con estado incierto).
  2. Crear suite de pruebas exhaustiva en `backend/tests/poe_pilot.test.js` con `node:test` validando:
     - Catálogo en vivo y esquemas de parámetros devueltos por Poe.
     - Funcionamiento del adaptador en modo mock y con respuestas grabadas/sintéticas sin coste.
     - Validación del descargador seguro (protección de extensiones, sanitización y prevención de SSRF/redirecciones no deseadas).
     - Validación del contrato de medios compatible con Remotion y el reproductor de Helpmeagro.
  3. Ejecutar y certificar la suite de pruebas completa en verde sin regresiones sobre los 94 tests existentes.
  4. Revisión independiente con QA (`qa-reviewer`) y Seguridad (`security-reviewer`).
  5. Acordar con Luis la carga de `POE_API_KEY` en `.env` y la autorización de gasto para la prueba de disparo real en vivo.
- Responsable / especialidad: backend (`backend` / `project_backend`)
- Revisores independientes: qa-reviewer (`project_qa_reviewer`) y security-reviewer (`project_security_reviewer`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - [PLAN_POE.md](../../PLAN_POE.md): Plan de implementación de Poe y fases 0 a 4.
  - `backend/services/poeService.js`: Adaptador del proveedor.
  - `backend/tests/poe_pilot.test.js`: Suite de pruebas del piloto.
  - `backend/services/videoService.js`: Integración de metadatos de vídeo y Remotion.
- Archivos asignados en exclusiva:
  - `backend/services/poeService.js`
  - `backend/tests/poe_pilot.test.js`
  - `docs/workspace/tasks/TASK-POE-001.md`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), Backend (implementación), QA y Seguridad (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Consumo imprevisto o descontrolado de puntos de Poe por reintentos ciegos; recepción de respuestas de texto sin URLs descargables; discrepancia en la duración devuelta por Omni frente a los 8 segundos previstos para Remotion.
- Fuera de alcance: Modificación de la automatización del autopiloto (`scheduler.js`) o frontend en esta fase (corresponde a POE-002 tras superar el piloto).
- Skills ECC y herramientas verificadas: `backend-patterns`, `testing`, `security-review`, `verification-loop`.
- Criterios de aceptación:
  1. `poeService` consulta y valida los modelos `nano-banana-2.1` y `gemini-omni-1.1-flash` en el catálogo de Poe.
  2. Implementa contratos estandarizados: imagen `{ path, url, model, costPoints }` y vídeo `{ path, url, hasAudio, duration, audioCodec, engine, thumbnail }`.
  3. El descargador seguro descarga archivos exclusivamente hacia la carpeta designada `output/poe/`, valida tipos MIME multimedia y rechaza archivos que superen 50 MB o formatos inesperados.
  4. La reserva presupuestaria aborta antes de enviar la petición si el saldo disponible es inferior a la reserva del trabajo (reserva inicial: 40.000 puntos).
  5. Maneja limpiamente respuestas sin medio, errores HTTP 401, 402, 429 y estado incierto por timeout sin reintentar duplicando cargos.
  6. Suite `backend/tests/poe_pilot.test.js` pasando al 100% y suite global alcanzando 105+ tests en verde.
- Pruebas o comprobaciones pertinentes: `node --test --test-concurrency=1 tests/*.test.js`.
- Autorización aplicable a acciones externas: Catálogo público sin credenciales en modo lectura; generación real condicionada a clave en `.env` y confirmación de Luis.

## Entrega del especialista

- **Módulo Creado:** [`backend/services/poeService.js`](file:///c:/Users/luis_/OneDrive/Escritorio/Pc%20casa%20drive/Creador%20de%20contenido%20con%20IA/backend/services/poeService.js)
  * Integración con catálogo público `https://api.poe.com/v1/models`: esquemas confirmados para `nano-banana-2.1` (1K, 9:16) y `gemini-omni-1.1-flash` (video, 720p, 9:16, task `image_to_video`).
  * Descargador seguro `downloadMediaFile()`: blindaje anti-SSRF contra direcciones privadas/metadatos nube, lista blanca estricta de MIME types, límite de 50 MB y generación de nombres únicos e inmutables en `output/poe/`.
  * Control presupuestario Fail-Closed: verificación previa obligatoria de balance (`getBalance()`); aborta con HTTP 402 si el saldo no cubre la estimación (1.200 pts imagen, 30.000 pts vídeo). Sin bucles de reintento ciego.
  * Timeouts controlados con `AbortSignal.timeout(...)` y truncado de respuestas de error.
  * Contratos estandarizados listos para Remotion (`duration: 8.0`, `hasAudio: true`, `audioCodec: 'aac'`, `aspectRatio: '9:16'`).
- **Suite de Pruebas:** [`backend/tests/poe_pilot.test.js`](file:///c:/Users/luis_/OneDrive/Escritorio/Pc%20casa%20drive/Creador%20de%20contenido%20con%20IA/backend/tests/poe_pilot.test.js) con 22 pruebas automatizadas.
- **Resultado de Pruebas:** 116 tests en verde al 100% sobre la suite global del backend (`node --test --test-concurrency=1 tests/*.test.js`).

## Revisión e integración

- **QA Reviewer (`project_qa_reviewer`):**
  * **Dictamen:** APROBADO (6/6 Criterios de Aceptación cumplidos al 100%).
  * Verificación de contratos, compatibilidad con 192 frames Remotion, limpieza atómica 1 a 1 de ficheros temporales y no regresión.
- **Security Reviewer (`project_security_reviewer`):**
  * **Dictamen:** APROBADO tras subsanar SEC-01 (Anti-SSRF), SEC-02 (MIME estricto) y SEC-03 (Fail-Closed presupuestario).
  * Manejo seguro de credenciales verificado: `POE_API_KEY` leída exclusivamente de entorno, cero filtraciones en logs y protección completa contra Path Traversal y DoS de gasto.
- **Estado de Fase 0:** Preparación local, arnés de pruebas y blindaje completados. Pendiente inyección de `POE_API_KEY` en `.env` y confirmación de Luis para la prueba de disparo real en vivo.
