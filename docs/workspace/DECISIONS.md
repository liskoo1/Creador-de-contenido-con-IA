# Decisiones del espacio de trabajo

## D-022 — Implementación de extracción de contexto web, capturas y visor de activos (7 de noviembre de 2026)

Se ejecuta el plan [PLAN_BUSINESS_CONTEXT.md](PLAN_BUSINESS_CONTEXT.md) completando las tareas BIZ-IMPORT-001 y ASSET-PREVIEW-001:
1. Navegación y captura controlada: Se instaló `playwright` (Chromium v1254) en el backend y se implementó `websiteCaptureService.js` con soporte para capturas de escritorio (1440×900) y móvil responsive (390×844), extracción de texto visible hasta 30.000 caracteres, metadatos y JSON-LD.
2. Política Anti-SSRF estricta: `publicWebPolicy.js` bloquea accesos a loopback, IPs privadas IPv4/IPv6, metadata cloud, puertos no estándar (80/443 únicamente) y rebinds de DNS.
3. Agente de extracción y Skill Runtime: Se creó `.agents/skills/business-context-extractor/SKILL.md` y `businessContextAgent.js`, invocando Gemini (`gemini-3.8-flash`) con salida estructurada en JSON estricto, confianza calificada y citas literales de evidencia (URL y snippet).
4. Persistencia atómica y control de concurrencia: `productContextService.js` incorpora fingerprint SHA-256 (`baseRevision`), rechazo de colisiones con `409 Conflict`, copias de respaldo para rollback y preservación estricta de ediciones manuales y `presenterProfile`.
5. Aislamiento de activos por rol: `knowledgeService.js` registra las capturas con `assetRole: 'website-screenshot'` y `AgentOrchestrator.js` las excluye del pool de marca de generación visual estándar (`excludeRoles: ['website-screenshot']`), evitando contaminar logos o avatares.
6. Interfaz y accesibilidad: Se integró el botón "⚡ Analizar mi negocio", barra de progreso en vivo, panel de propuesta con selección granular de campos y capturas, y modal accesible `#asset-preview-modal` compatible con teclado y Escape. Se validó la presencia de spinners en `AUTO_IDEAS` y `OPTIMIZE_PROMPT`.
7. Verificación completa: 147 tests pasan sin fallos (15 nuevos tests de BIZ-001 + 7 de SEC-001 + 125 pruebas de regresión).

## D-021 — Propuesta de contexto desde web y capturas (7 de noviembre de 2026)

Luis solicita un plan para autocompletar el contexto del negocio desde su web,
conservar edición manual, agregar capturas móvil/escritorio y abrir imágenes desde
la lista lateral. La propuesta está en [PLAN_BUSINESS_CONTEXT.md](PLAN_BUSINESS_CONTEXT.md).

Se recomienda navegación real mediante herramienta de backend y síntesis por un
agente, borrador revisable antes de guardar, precedencia manual, control de revisión,
capturas con rol explícito y preview individual conservando la biblioteca actual.
Añadir una URL actualmente solo guarda el enlace; no hay captura implementada.
Los MCP de desarrollo y una skill de scraping no son capacidades automáticas de
navegación del runtime. Playwright se propone como dependencia nueva, sin instalar.

Se consultan fuentes oficiales y se delegan arquitectura, frontend y QA/seguridad.
Este registro documenta una propuesta; no presupone aprobación del diseño ni
inicio de implementación. No se modifica código funcional ni se visita una web
de negocio, se generan capturas o se ejecutan pruebas de la función propuesta.

## D-020 — Exploración previa a una nueva implementación (7 de noviembre de 2026)

Luis solicita conocer primero el proyecto usando MCP y skills. Se aplica dirección
con especialistas de arquitectura y automatización y QA independiente. El resultado
actual vive en [PROJECT_MAP.md](PROJECT_MAP.md) y la aceptación se registra en
[ONBOARD-001](tasks/TASK-ONBOARD-001.md).

Codebase Memory expone un proyecto cuya raíz coincide exactamente con el workspace:
`C-Users-luis_-OneDrive-Escritorio-Creador-de-contenido-con-IA`. Se usa este en lugar
del identificador histórico de otra raíz. Las relaciones del índice se contrastan
con los archivos locales; el código prevalece sobre documentación histórica.

Se documentan discrepancias de interfaz, publicación diferida, calendario y
proveedores como pendientes, conservando el historial de tareas ya cerradas.
No se ejecuta una corrección masiva ni se cambia código funcional. Siete pruebas
editoriales aisladas pasan y QA confirma sintaxis de frontend/servidor. No se
revalida la suite completa: incluye acceso a catálogo remoto y escrituras en datos
locales. No se inicia aplicación, cron, publicación o generación ni se consultan
secretos o cuentas. Los resultados anteriores de Meta y de 125 tests permanecen
como antecedentes, no como comprobaciones de esta sesión.

Registro inicial: 4 de noviembre de 2026.

## D-001 — Director y especialistas

Luis solicita un director técnico como único interlocutor y delegación en
especialistas. [AGENTS.md](../../AGENTS.md) establece el contrato;
[WORKFLOW.md](WORKFLOW.md) define las fases y [TEAM.md](TEAM.md) las
responsabilidades. El director conserva integración y aceptación global.

## D-002 — ECC como capacidades verificadas

Se verificó ECC 2.2.3 en la instalación local del plugin. Se usarán sus skills y
perfiles como referencias, leídos desde la instalación activa. Su manifiesto
MCP inspeccionado contiene `chrome-devtools`, no un servidor genérico ECC.
La disponibilidad de herramientas debe verificarse por sesión. No se copiarán
componentes del plugin ni se declarará conexión por existir un archivo.

## D-003 — Contrato portable

El contrato común vive en archivos del repositorio, fuera de configuraciones
globales de usuario. El adaptador de Antigravity se prepara en
`config/antigravity`. Debe remitir a este contrato y seguir el formato oficial
vigente. Archivos preparados, archivos instalados y capacidades descubiertas
son estados distintos y se comunicarán por separado.

El [adaptador de Antigravity](../../config/antigravity/README.md) explica el arranque
con `AGENTS.md` y la instalación de los perfiles persistentes. El instalador
`scripts/Install-Workspace.ps1` comprueba o copia siete archivos del paquete.
Si el destino contiene una versión distinta de algún archivo, conserva esa versión
y detiene la instalación antes de copiar.

La revisión independiente detectó dos casos que se corrigieron. El instalador
inspecciona los componentes de las rutas hasta la raíz del proyecto y detecta un
archivo que ocupe el lugar de un directorio antes de copiar. Pasaron seis
comprobaciones aisladas, incluida la detección de ese bloqueo, la copia desde un
enlace duro con verificación de hash y la preservación de perfiles en conflicto.
La prueba adicional con una junction quedó bloqueada al crear el enlace en el
entorno de prueba. La revisión confirmó la corrección en el código.

En este proyecto, la instalación se detuvo al intentar crear
`.agents/skills/director-proyecto` por falta de permiso de escritura. Los siete
archivos permanecen preparados en `config/antigravity`. La tarea WS-002 queda
bloqueada hasta poder instalar los archivos y comprobar una delegación en el cliente.
`.git` sigue protegido y los cambios se conservan en la copia de trabajo.

## D-004 — Desarrollo y runtime separados

El equipo de desarrollo usa herramientas de colaboración del entorno. Los
agentes de `backend/agents` y `backend/core` ejecutan generación de contenido
dentro de la app. Configurar el primero no modifica ni activa automáticamente
el segundo.

## D-005 — Evidencia y revisión

Cada cambio sustancial tiene criterios verificables y revisor independiente.
Cuando no exista capacidad de subagentes, se permite avance secuencial con la
limitación declarada. Una revisión del mismo ejecutor no se registra como
independiente y una prueba bloqueada no cuenta como aprobada.

## D-006 — Continuidad y alcance

Conservar los cambios locales de la integración Instagram. La configuración del
workspace no ejecuta las mejoras pendientes ni activa autopiloto/publicación.
El [backlog](BACKLOG.md) registra esas prioridades para encargos posteriores.

## D-007 — Desbloqueo de subagentes en Antigravity y cierre de ARCH-001

El 4 de noviembre de 2026 se ejecutó exitosamente `Install-Workspace.ps1 -Mode Install`,
desplegando los siete archivos del paquete en `.agents/skills` y `.agents/agents`.
Se comprobó la disponibilidad de herramientas nativas de delegación en Antigravity
(`define_subagent` e `invoke_subagent`).

Se orquestó la tarea `ARCH-001` con delegación real en dos sesiones independientes:
1. `project_architect`: Exploración de arquitectura mediante Codebase Memory MCP
   contrastado con los archivos reales del disco. Identificó los 3 subsistemas,
   el flujo de vida del contenido, métricas de complejidad ciclomática/fan-in y
   cuatro riesgos técnicos fundamentales (incluyendo el origen exacto de PUB-001
   y DATA-001).
2. `project_qa_reviewer`: Revisión independiente de QA en modo de solo lectura estricto
   (cero mutaciones en el repositorio), confirmando la veracidad de las citas de código
   e incorporando dos hallazgos adicionales sobre irrecuperabilidad de aprobación y
   discrepancia contractual en la publicación.

Con esta evidencia, se dio por cumplida la tarea `ARCH-001` y se desbloqueó `WS-002` a
`done`, demostrando la operatividad real del flujo de dirección y delegación.

## D-008 - Evaluación de Higgsfield para imagen y vídeo

El 4 de noviembre de 2026 se contrastó el código con la documentación de
Higgsfield. La [API](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api)
usa saldo independiente en dólares. El
[MCP](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp)
usa créditos de la cuenta web en cada generación. Las ventajas ilimitadas de la
web quedan limitadas a su uso manual.

Para una eventual integración, se propone probar un proveedor visual opcional
por API. `backend/agents/Agent.js` ya enruta imágenes entre Google y OpenAI.
`backend/core/AgentOrchestrator.js` y `backend/services/agroImageService.js`
conservan llamadas directas a Gemini para algunas imágenes. El coste actual de
47 € se debe desglosar por proveedor y tipo de generación antes de proyectar
ahorro. El vídeo generativo se contabiliza como coste adicional en esa comparación.

El piloto debe comparar coste por pieza aprobada, intentos, tiempo y fidelidad
de personajes y referencias. Para vídeo, debe comprobar duración, proporción,
audio y montaje con Remotion. Las tarifas y límites dependen del modelo y la cuenta.
La evaluación queda registrada como propuesta. La integración y la compra de saldo
requieren un encargo posterior.

## D-009 - Comparación de alternativas visuales

Evaluación del 4 de noviembre de 2026. Se propone comparar Magnific Premium con
fal e Higgsfield API. [Magnific](https://www.magnific.com/es/precios) incluye
acceso por API con consumo de créditos del plan. Sus generaciones ilimitadas
se aplican a la web según su [documentación de API](https://docs.magnific.com/pricing).
Krea y Runway facturan el uso de API con saldo separado del plan web.

La tarifa de catálogo de Kling 3.0 Standard sin audio es de $0,084/s en
[fal](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video) y
$0,09/s en [Runway](https://docs.dev.runwayml.com/guides/pricing/). El criterio
para el piloto sigue siendo el coste por pieza aprobada con entradas, resolución,
duración y audio comparables. Pendiente de cotizar el flujo de Helpmeagro y probar
la calidad de los resultados antes de decidir proveedor o plan.

Luis aclaró que los 47 € mensuales corresponden a imágenes y que quiere sumar
vídeo dentro de una sola cuota. Para ese objetivo se prioriza evaluar Magnific
Premium+ mensual. La tarifa de referencia en España es 36 € antes de IVA.
La guía del proveedor indica 45.000 créditos en la modalidad mensual y 600.000
en la anual. El saldo efectivo, el importe final y el consumo de los modelos
deben contrastarse en el plan elegido antes de contratar o integrar.

Luis añadió Gemini Omni Flash como referencia mínima de calidad en vídeo.
[Google AI Pro](https://gemini.google/es/subscriptions/?hl=es) pasa a ser la
primera prueba para producción manual. Flow incluye el modelo exacto, una
bolsa de 1.000 créditos mensuales adicionales y límites propios de imágenes.
Los créditos de Flow se destinan a su interfaz. La app usa la facturación
independiente de la [API de Gemini](https://aistudio.google.com/docs/billing).
Para una sola cuota con automatización queda por validar el modelo, la tarifa
y el contrato de generación a través del MCP de Higgsfield. La paridad de
otros modelos se decidirá con las mismas escenas de referencia.

Luis confirmó que la generación de imágenes y vídeo debe ejecutarse desde la
app. Flow queda fuera de la evaluación como proveedor de cuota para el backend.
Se comprobaron los endpoints públicos de Magnific MCP e Higgsfield MCP. Ambos
requieren OAuth y anuncian renovación de sesión en sus metadatos. Esta prueba
no valida el catálogo de una cuenta, la renovación efectiva ni la facturación.

Primero se cotizará Gemini Omni de Google con `video_models_list` y
`simulate_cost` de [Magnific MCP](https://docs.magnific.com/modelcontextprotocol).
El [CLI de Higgsfield](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md#gemini_omni--gemini-omni-flash)
documenta `gemini_omni` con referencias, 9:16, ocho segundos y 720p. Su CLI
consume créditos de la cuota y admite estimación previa. La validación debe
confirmar versión, coste por intento y renovación tras reiniciar el proceso.
La elección depende de que el volumen real de imagen y vídeo quepa en la cuota.

## D-010 - Poe como primer candidato para automatización con cuota

La [ficha oficial de Gemini Omni 1.1 Flash](https://poe.com/gemini-omni-1.1-flash/api)
y la [documentación de Poe](https://creator.poe.com/docs/external-applications/openai-compatible-api)
confirman el modelo de Google por API y el uso de puntos de la suscripción.
La [página de planes](https://poe.com/subscription_plans), en modalidad mensual,
mostró 660.000 puntos por 22,99 € y 1.650.000 puntos por 57,49 €.

Se observaron en el cuadro público de tarifas 584 puntos por mil tokens de
salida de vídeo en Omni y 1.000 por mil tokens de imagen en Nano Banana 2.1.
Al aplicar los recuentos de [Google](https://aistudio.google.com/docs/pricing)
se estiman unos 27.060 puntos por clip de ocho segundos a 720p y 1.120 por
imagen 1K. Son estimaciones de salida. El piloto debe verificar formato 9:16,
duración, descarga, consumo total con referencias y resultado en Remotion.

Poe se prioriza para el piloto con una clave de API, sujeto a que la bolsa cubra
el volumen real. Higgsfield documenta `gemini_omni_flash_1_1` por CLI con créditos
del plan. Krea y Magnific quedan pendientes de confirmar el modelo y coste en
sus catálogos MCP autenticados. No se realizó ninguna generación ni compra.

## D-010 — Publicación Confiable y Persistencia de Identificadores (PUB-001 & DATA-001)

El 4 de noviembre de 2026 se resolvió la causa de falso éxito en la publicación y la
omisión de identificadores devueltos por Meta Graph API:
1. `publishingService.js`: Normaliza el contrato por plataforma (`success`, `postId`,
   `error`, `mock`, `skipped`), calculando `allOk` y `partial`.
2. `server.js`: Se centralizó `applyPublishResult(post, result)` para unificar el
   contrato entre la API manual y el webhook de aprobación por correo.
   - Si la publicación falla totalmente, se libera el claim, no se muta `publishedAt`
     y se permite reintentar.
   - En éxito parcial, se persiste la red exitosa con su `postId` y se libera el claim
     para que un reintento posterior solo solicite la plataforma pendiente.
   - En éxito total, se guardan los `postId`s de ambas redes, marcas de tiempo y
     `publishedAt`.
   - Se añadió escape de caracteres HTML en `renderWebhookPage` y protección contra
     el rechazo accidental de publicaciones parciales.
3. Se verificó con 12 tests en `backend/tests/publishing.test.js` y 19 tests globales
   (100% pass) con revisión independiente aprobada por QA (`project_qa_reviewer`) y
   Seguridad (`project_security_reviewer`). Se cierran `PUB-001` y `DATA-001`.

## D-011 — Integración Editorial de las 13 Skills de Instagram (IG-001)

El 4 de noviembre de 2026 se completó la auditoría y validación independiente de la
integración de las 13 skills tácticas de Instagram:
1. `backend/vendor/instagram-agent-skill/`: Conserva 13 skills, licencias MIT y hashes
   SHA-256 inmutables de upstream.
2. `backend/services/instagramSkillsService.js`: La directiva `POLICY` ancla el contenido
   estrictamente a la realidad y voz técnica de Helpmeagro (invernaderos, SIGPAC,
   fitosanitarios y albaranes de Almería). Prohíbe inventar métricas de Instagram Insights,
   simular scripts de Python no ejecutados o prometer alcance algorítmico sin evidencia.
3. Preservación de esquemas JSON: La inyección contextual en `Agent.js` (`forAgent`)
   obliga al modelo a devolver exclusivamente el esquema JSON solicitado por la skill
   nativa sin Markdown accesorio.
4. UI desacoplada: `frontend/instagram.html` opera como asistente estático independiente
   con un revisor determinista de captions (Unicode de emojis, límite de 2.200 caracteres,
   hasta 5 hashtags y preview de 125 caracteres).
5. Revisión independiente: Aprobada conjuntamente por el estratega (`project_instagram_strategist`)
   y QA (`project_qa_reviewer`) con 5/5 criterios cumplidos y 7 tests unitarios aprobados.
   Se cierra `IG-001` a estado `done`.

## D-012 — Incorporación de Métricas e Instagram Insights (MET-001)

El 4 de noviembre de 2026 se completó la integración de lectura y sincronización de métricas:
1. `instagramPublisher.getMediaInsights`: Consulta Graph API v25.0 (`/{mediaId}/insights`),
   distinguiendo de forma estricta entre ausencia de datos (`null`) y ceros reales (`0`).
2. `postService.updateMetrics`: Fusión atómica de métricas sobre el registro del post.
3. Endpoints REST: `GET /api/posts/:id/metrics`, `POST /api/posts/:id/metrics/sync` (requiere
   `publishedPlatformIds.instagram`) y `POST /api/posts/:id/metrics/import` con validación
   estricta de números no negativos y tipos válidos, sellando `origin: 'manual'` o `'api'` y `fetchedAt`.
4. Definición estratégica: Se establece el **Índice de Relevancia Técnica (SRR = `saved / reach * 100`)**
   como KPI principal para Helpmeagro.
5. Verificado con 22 pruebas automatizadas en `backend/tests/metrics.test.js` (41 tests globales
   aprobados al 100%) con revisión independiente aprobada por QA y Estrategia. Se cierra `MET-001`.

## D-013 — Presupuesto Editorial y Cupo Unificado del Calendario (PLAN-001)

El 4 de noviembre de 2026 se resolvió la sobreplanificación no regulada del calendario:
1. `botStateService`: Incorpora `DEFAULT_EDITORIAL_BUDGET` (`maxDailyFeedPosts: 1`,
   `maxMonthlyFeedPosts: 24`, `allowNewsOnCreativeDays: false`, `includePriceStoriesInFeedBudget: false`)
   y métodos persistentes `getEditorialBudget()` y `updateEditorialBudget()`.
2. `scheduler.js`: Se extrajo y testeó `enrichScheduleWithBudget(...)`. Las noticias
   agrícolas (`news-post`) actúan como relleno de valor exclusivamente en días sin
   creatividad, respetando el límite diario de 1 post de feed y el cupo global de 24 al mes.
3. Carril independiente de Stories: Las cotizaciones de precios (`price-story`) se programan
   de lunes a sábado a las 08:30 (descanso dominical natural de subastas en Almería)
   sin consumir cupo de publicaciones de feed.
4. Verificado con 17 pruebas automatizadas en `backend/tests/scheduler_budget.test.js` (58 tests
   globales aprobados al 100%) con revisión independiente aprobada por QA y Estrategia.
   Se cierra `PLAN-001`.

## D-014 — Seguridad de Webhooks de Aprobación, Endurecimiento y Coherencia Horaria (OPS-001)

El 4 de noviembre de 2026 se completó el endurecimiento operacional y de seguridad:
1. Tokens de Aprobación Criptográficos: Se asigna un `approvalToken: crypto.randomUUID()`
   a cada publicación creada en `postService.save()`, y se migran automáticamente posts
   legacy en `getAll()`. Los enlaces de email en `approvalGateway.js` viajan protegidos
   con `?token=...`.
2. Validación Fail-Closed: Los endpoints `/api/webhooks/approve/:postId` y `/api/webhooks/reject/:postId`
   evalúan `if (!post.approvalToken || req.query.token !== post.approvalToken)` rechazando
   con HTTP 403 Forbidden cualquier solicitud carente de token o con token erróneo, evitando
   que prefetchers de email publiquen o descarten contenido de forma involuntaria.
3. Saneamiento de Logs: Se eliminó el volcado de fragmentos de token en `instagramPublisher.js`,
   empleando indicadores booleanos seguros (`Boolean(accessToken)`).
4. Coherencia Horaria (`Europe/Madrid`): Se estandarizó la resolución de fecha y componentes
   de negocio mediante `getBusinessDateMadrid()`.
5. Verificado con 14 pruebas en `backend/tests/ops.test.js` y 72 tests globales aprobados al 100%.
   Revisión independiente aprobada por Seguridad (`project_security_reviewer`) y QA (`project_qa_reviewer`).
   Se cierra `OPS-001`.

## D-015 — Experimentos y Revisión Semanal Basada en Evidencia (EXP-001)

El 4 de noviembre de 2026 se completó el módulo de experimentos editoriales y evaluación empírica:
1. `backend/services/experimentService.js`:
   - `calculateSRR(saved, reach)`: Implementa la formulación rigurosa del Save-to-Reach Ratio (`(saved / reach) * 100`)
     con redondeo a 2 decimales. Blindado estrictamente contra `reach <= 0`, valores no finitos (`NaN`, `Infinity`),
     negativos o nulos. Diferencia un 0 numérico legítimo (`saved = 0` con `reach > 0`) de la ausencia de datos.
   - `resolvePostFormat(post)`: Normaliza los 5 formatos estratégicos de Helpmeagro (`carousel`, `reel`, `single`,
     `news-post`, `price-story`) mapeando sinónimos del orquestador.
   - `analyzeExperiments(posts)`: Discrimina posts medidos (`measured`) de pendientes (`pending_metrics`).
     Calcula métricas agregadas excluyendo rigurosamente los posts sin métricas de los divisores de promedio,
     identifica el `topPerformer` con evidencia cuantitativa demostrada y desglosa por formato y a nivel global.
   - `setPostHypothesis(postId, hypothesisData)`: Valida y persiste hipótesis editoriales (`angle`, `expectedOutcome`,
     `notes`, `status: active | validated | invalidated`) vinculándolas de forma duradera al post.
2. Endpoints REST:
   - `GET /api/experiments`: Retorna agregados globales, desglose por formato y lista de piezas enriquecida.
   - `POST /api/posts/:id/hypothesis`: Valida entrada obligatoria y persiste la hipótesis con marcas temporales.
3. Verificado con 22 pruebas automatizadas en `backend/tests/experiments.test.js` y 94 tests globales (100% pass)
   con revisiones independientes aprobadas por el Estratega de Instagram (`project_instagram_strategist`) y el
   Revisor de Calidad (`project_qa_reviewer`). Se cierra `EXP-001` y se completa la totalidad del backlog del proyecto.

## D-017 - Auditoría de autonomía y revisión del estado de Poe

El 5 de noviembre de 2026 se auditó el código actual por encargo de Luis.
Resultado y plan de trabajo: [informe en la raíz](../../INFORME_AUTOMATIZACION_INSTAGRAM_2026-11-05.md).

- Poe permanece como servicio piloto separado del generador y del autopiloto.
  POE-001 no se considera validado con gasto y medios reales; POE-002 sigue pendiente.
- Las afirmaciones de D-016 sobre persistencia atómica, protección del descargador
  y contrato audiovisual necesitan las correcciones y verificaciones descritas en
  el informe. Los valores constantes y las pruebas simuladas no demuestran esas propiedades.
- La planificación sigue siendo mensual. Se propone un ciclo semanal con métricas,
  competencia, aprobación de versión y publicación diferida; no se activa en esta entrega.
- La noticia y los precios deben quedar protegidos frente al presupuesto creativo.
  Se documentan la omisión actual de noticias por cupo/coincidencia y la excepción
  dominical de precios, sin modificar su configuración ni su ejecución.
- No se publicaron contenidos, enviaron respuestas ni hicieron generaciones pagadas.

## D-016 - Validar el transporte de Poe antes de integrarlo (POE-001)

El 4 de noviembre de 2026 se completó la Fase 0 del piloto de Poe:
1. `backend/services/poeService.js`:
   - Catálogo en vivo verificado: `gemini-omni-1.1-flash` (vídeo 720p, 9:16, task `image_to_video`) y `nano-banana-2.1` (imagen 1K, 9:16).
   - Descargador seguro con protección anti-SSRF para redes privadas y metadatos cloud, lista blanca estricta de MIME types, límite de 50 MB y persistencia atómica en `output/poe/`.
   - Control presupuestario *Fail-Closed*: aborta con HTTP 402 si el saldo no cubre la estimación (1.200 pts imagen, 30.000 pts vídeo).
   - Contratos Remotion: duración 8.0s (192 frames a 24 fps), audio nativo AAC y proporción 9:16.
2. Suite `backend/tests/poe_pilot.test.js`: 22 pruebas automatizadas y 116 tests globales en verde al 100%.
3. Revisiones independientes aprobadas por QA (`project_qa_reviewer`) y Seguridad (`project_security_reviewer`).
4. La ejecución del disparo con cargo real queda supeditada a la carga de `POE_API_KEY` en `.env` y confirmación de Luis.


## D-018 - Implementación integral del informe de automatización y corrección de contratos (5 de noviembre de 2026)

Se implementaron todos los puntos técnicos acordados en el informe de auditoría:
1. Corrección P0/P1 de Poe (`backend/services/poeService.js`):
   - Lectura de `current_point_balance` como campo primario documentado de Poe [F4].
   - Sin `POE_API_KEY` y sin `mock: true`, rechaza de inmediato con 401 en lugar de fingir éxito.
   - Payloads a Poe transmiten parámetros reales (`aspect_ratio`, `image_size`, `resolution`, `task`).
   - Inspección con `ffprobe` para medir duración y códecs de audio reales en vídeos.
   - Descargador seguro con archivo temporal `.tmp` y renombrado atómico con `fs.renameSync()`.
2. Adaptador visual unificado (`backend/agents/Agent.js` y `backend/core/AgentOrchestrator.js`):
   - Soporte para `imageModel: 'poe'`, `imageProvider: 'poe'` y `videoProvider: 'poe'`.
   - `_generateCharacterLock` enrutado a Poe cuando se selecciona como proveedor visual.
3. Protección estricta de rutinas agro (`backend/services/botStateService.js` y `backend/automation/scheduler.js`):
   - `protectAgroRoutines: true` garantiza que la noticia y los precios diarios no se omitan ni desplacen por posts creativos.
4. Separación de momentos en automatización (`backend/server.js` y `backend/automation/scheduler.js`):
   - Generación previa (`pending_approval`).
   - Aprobación diferida (`approved`) vía POST o UI de revisión segura contra prefetching/escáneres antivirus de correo.
   - Publicación desatendida al llegar la hora programada (`checkAndExecute` con horario de negocio `Europe/Madrid`).
5. Verificación completa: suite total de 121 tests en verde (100% pass).


## D-019 — Conmutación dinámica de proveedor multimedia y ciclo semanal por métricas (5 de noviembre de 2026)

1. Conmutación configurable en `.env`:
   - Se añadió la variable `MEDIA_PROVIDER` (junto a `IMAGE_PROVIDER` y `VIDEO_PROVIDER`) documentada con las dos opciones disponibles:
     * `'poe'`: Generación visual con Nano Banana 2.1 (imágenes) y Gemini Omni 1.1 Flash (vídeos con audio) en Poe.
     * `'google'`: Generación visual con Gemini oficial (Google Imagen 3 y Veo).
   - `AgentOrchestrator` y `Agent` resuelven dinámicamente este valor en tiempo de ejecución.
2. Planificación semanal orientada a datos (`runWeeklyPlanning`):
   - Transición del calendario rígido mensual a un ciclo semanal dinámico ejecutado cada lunes a las 06:00 (Europe/Madrid) o bajo demanda (`POST /api/bot/force-plan-week`).
   - El planificador analiza los experimentos anteriores (`experimentService.analyzeExperiments`), identifica el formato con mayor ratio de guardado (`SRR`) y los mejores ángulos de engagement antes de diseñar 2–3 piezas creativas semanales.
   - Las rutinas agro (noticias diarias y stories de precios matinales) se protegen automáticamente mediante `enrichScheduleWithBudget`.
3. Verificación de Instagram Graph API:
   - Se probó la conexión con Meta Graph API v25.0 y `graph.instagram.com`.
   - Diagnóstico: El token actual arrojó `OAuthException code 190 (sesión invalidada por cambio de contraseña o reset de seguridad en Facebook)`. Requiere regeneración en Meta Developers para publicar en vivo o leer métricas remotas.
4. Generación real de prueba sin publicar:
   - Post de prueba generado exitosamente usando Poe `nano-banana-2.1` (16.2s, 1:1, resolución completa) y copy optimizado con las skills de Instagram.
   - Guardado en base de datos con `status: 'pending_approval'` (Post ID: `1793877474650`) para previsualización segura sin publicar en redes.
5. Suite total de 125 pruebas automatizadas en verde (100% pass).
