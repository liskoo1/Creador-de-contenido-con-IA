# Tarea: PUB-001 & DATA-001 — Corrección de falso éxito y persistencia de identificadores de publicación

- Estado: done
- Objetivo observable:
  1. Corregir el falso éxito en el webhook `/api/webhooks/approve/:postId` cuando Meta Graph API rechaza la publicación o falla la red, garantizando que el claim se libere y el post no quede marcado falsamente como publicado.
  2. Gestionar correctamente el éxito parcial (ej. Instagram OK, Facebook KO): registrar en el post la red completada y permitir reintento de la red pendiente.
  3. Persistir en el post los IDs devueltos por Meta (`postId`) junto con marcas temporales reales en una estructura unificada (`publishedPlatformIds` / `publishedTo`).
  4. Unificar el contrato y la lógica de actualización entre la API manual (`/api/publish/:id`) y el webhook de aprobación.
  5. Añadir suite de pruebas con `node:test` en `backend/tests/publishing.test.js` cubriendo fallo total, éxito parcial, éxito total y reintento.
- Responsable / especialidad: backend (`project_backend`)
- Revisores independientes: qa-reviewer (`project_qa_reviewer`) y security-reviewer (`project_security_reviewer`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `backend/server.js` líneas 466-604 y 926-1065.
  - `backend/services/publishingService.js` líneas 75-250 (`publishViaBridge`).
  - `backend/services/postService.js` y `backend/services/botStateService.js`.
  - Hallazgos previos del arquitecto y QA (ARCH-001 / QA-1 y QA-2): falso éxito por captura silenciosa de excepciones, pérdida de `postId`, e irrecuperabilidad del post por retención indebida del claim.
- Archivos asignados en exclusiva:
  - `backend/server.js`
  - `backend/services/publishingService.js`
  - `backend/tests/publishing.test.js`
- Dependencias y responsables relacionados: Director técnico (encargo e integración), QA y Seguridad (revisión independiente).
- Riesgo dominante y comportamiento inicial observado: Falsa confirmación de publicación en el correo, posts marcados como publicados sin haber salido a Meta, imposibilidad de reintentar por locks bloqueados, y pérdida de IDs para seguimiento y métricas.
- Fuera de alcance: Modificar la lógica de generación de contenido con IA, alterar credenciales de producción o publicar en redes reales.
- Skills ECC y herramientas verificadas: `backend-patterns`, `api-design`, `verification-loop`, `security-review`.
- Criterios de aceptación:
  1. Si todas las redes fallan, `publishedAt` no se asigna, el claim se libera y el usuario recibe aviso de error con posibilidad de reintentar. [CUMPLIDO]
  2. Si una red tiene éxito y otra falla (éxito parcial), se registra el `timestamp` y el `postId` de la red exitosa, la fallida queda pendiente, y el post/claim permite reintentar solo la pendiente. [CUMPLIDO]
  3. Si ambas redes tienen éxito, el post queda completamente marcado con sus respectivos `postId`s de Meta y fechas. [CUMPLIDO]
  4. La API manual y el webhook de aprobación comparten una lógica coherente y estructurada de registro de publicación. [CUMPLIDO]
  5. Pruebas de regresión automatizadas pasan al 100% con `node --test tests/publishing.test.js` usando stubs/mocks sin efectos externos. [CUMPLIDO]
- Pruebas o comprobaciones pertinentes: Suite de pruebas con `node:test` cubriendo los 4 escenarios de publicación (12 tests específicos, 19 tests globales).
- Autorización aplicable a acciones externas, si las hubiera: Ninguna publicación real. Pruebas aisladas con dobles de prueba / mocks locales.

## Entrega del especialista (`project_backend`)

- **Archivos modificados:**
  - `backend/services/publishingService.js`: Constructor con inyección de dependencias para testeo; normalización unificada `_normalizePlatformResult` (`success`, `postId`, `error`, `mock`, `skipped`); cálculo de `allOk`, `partial`, `success` y consolidación de errores.
  - `backend/server.js`: Función centralizada `applyPublishResult(post, result)`; flujo corregido en `/api/webhooks/approve/:postId` con liberación de claim ante error o parcial; reintento selectivo de plataformas faltantes; integración del contrato unificado en `/api/publish/:id`.
  - `backend/tests/publishing.test.js`: Suite con 12 tests en 4 suites con dobles de prueba y servidor efímero en puerto dinámico (`app.listen(0)`).
- **Pruebas ejecutadas:**
  - 12 tests de publicación pasando al 100%.
  - 19 tests globales (7 de Instagram + 12 de publicación) pasando en verde.
- **Simulaciones:** Mocks de respuestas de Meta Graph API sin llamadas de red salientes reales.

## Revisión e integración (QA, Seguridad y Director)

- **Revisión de QA (`project_qa_reviewer`):**
  - Veredicto: **CONFORME / APROBADO (5/5 Criterios Cumplidos)**.
  - Verificado en disco: contratos respetados, 0 regresiones, 100% aislamiento en tests.
  - Hallazgos atendidos: prevención de rechazo accidental en posts parcialmente publicados y recomendación de escape HTML.
- **Revisión de Seguridad (`project_security_reviewer`):**
  - Veredicto: **APROBADO CON CONDICIONES**.
  - Secretos y tokens: 0 fugas en respuestas HTTP, archivos persistidos o logs de servidor.
  - Idempotencia: Candado síncrono `activePublishLocks` + persistido `botStateService` previene dobles ejecuciones.
  - Hallazgos atendidos: Saneamiento de caracteres HTML en `renderWebhookPage` aplicado para mitigar inyección XSS reflejada.
- **Acciones de integración del Director:**
  - Aplicado escape HTML en `renderWebhookPage` y guarda de seguridad en `/api/webhooks/reject/:postId` para proteger posts con publicación parcial.
  - Verificación conjunta ejecutada: 19/19 tests en verde.
  - Decisiones actualizadas (D-008 en `docs/workspace/DECISIONS.md`).
  - Backlog actualizado (`PUB-001` y `DATA-001` a estado `done`).
- **Estado final:** `done`.
