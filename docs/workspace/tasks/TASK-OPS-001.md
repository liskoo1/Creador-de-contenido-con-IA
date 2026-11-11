# Tarea: OPS-001 — Seguridad de Webhooks de Aprobación, Endurecimiento y Coherencia Horaria

- Estado: done
- Objetivo observable:
  1. Proteger los webhooks de aprobación (`/api/webhooks/approve/:postId`) y rechazo (`/api/webhooks/reject/:postId`) contra prefetching de email y accesos no autorizados mediante tokens criptográficos no predecibles (`approvalToken: crypto.randomUUID()`).
  2. Eliminar la impresión de fragmentos de token en logs de `instagramPublisher.js` (reemplazar `accessToken.substring(0, 10)` por indicador booleano seguro).
  3. Asegurar coherencia horaria estricta en zona horaria de negocio `"Europe/Madrid"` para cálculos de fecha y día actual.
  4. Crear suite de pruebas en `backend/tests/ops.test.js` con `node:test` validando la protección por token, rechazo 403 ante token ausente/inválido y coherencia horaria.
- Responsable / especialidad: backend (`project_backend`)
- Revisores independientes: security-reviewer (`project_security_reviewer`) y qa-reviewer (`project_qa_reviewer`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `backend/server.js`: rutas `/api/webhooks/approve/:postId` y `/api/webhooks/reject/:postId`.
  - `backend/automation/approvalGateway.js`: generación de enlaces con token.
  - `backend/services/postService.js`: asignación de `approvalToken` al crear el post y retrocompatibilidad con UUID en `getAll()`.
  - `backend/automation/instagramPublisher.js`: saneamiento de logs.
  - Hallazgos de seguridad previos (Seguridad H-1 y H-3).
- Archivos asignados en exclusiva:
  - `backend/services/postService.js`
  - `backend/automation/approvalGateway.js`
  - `backend/automation/instagramPublisher.js`
  - `backend/server.js`
  - `backend/tests/ops.test.js`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), Seguridad y QA (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Escáneres automáticos de correo (Safe Links / filtros anti-spam) previsualizan el enlace GET y ejecutan publicaciones no deseadas sin confirmación del usuario.
- Fuera de alcance: Modificar la generación de vídeo o prompts de IA.
- Skills ECC y herramientas verificadas: `security-review`, `backend-patterns`, `verification-loop`.
- Criterios de aceptación:
  1. Al generar un post o enviar correo de aprobación, se asigna `approvalToken` no predecible (`crypto.randomUUID()`).
  2. Los enlaces de aprobación y rechazo incluyen `?token=...`.
  3. Los webhooks exigen el token y rechazan con HTTP 403 cualquier petición con token ausente o erróneo (fail-closed estricto).
  4. `instagramPublisher.js` no imprime ningún prefijo ni fragmento de `accessToken` en consola.
  5. Suite de pruebas en `backend/tests/ops.test.js` pasando al 100% sin regresiones sobre los tests existentes.
- Pruebas o comprobaciones pertinentes: `node --test --test-concurrency=1 tests/*.test.js` (72 tests pasando).
- Autorización aplicable a acciones externas, si las hubiera: Solo lectura y pruebas en memoria local.

## Entrega del especialista
- `backend/services/postService.js`: `save()` genera `approvalToken: crypto.randomUUID()`; `getAll()` migra automáticamente posts legacy asignando UUID persistido.
- `backend/automation/approvalGateway.js`: `sendApprovalEmail()` incorpora `?token=${encodeURIComponent(token)}` tanto para approve como para reject.
- `backend/server.js`: validación fail-closed estricta `if (!post.approvalToken || req.query.token !== post.approvalToken) return res.status(403)...` y función exportada `getBusinessDateMadrid()`.
- `backend/automation/instagramPublisher.js`: reemplazado fragmento de token por `Boolean(accessToken)`.
- `backend/tests/ops.test.js`: 14 tests creados y en verde.

## Revisión e integración
- `project_security_reviewer`: APROBADO tras subsanar H-1/SEC-02 (fail-closed estricto y retrocompatibilidad de tokens en posts legacy).
- `project_qa_reviewer`: APROBADO (14/14 tests de OPS y 72/72 tests globales en verde sin regresiones).
- Integración firmada por el Director Técnico. Decisión registrada en `D-014`.
