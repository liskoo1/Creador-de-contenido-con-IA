# Plan: contexto del negocio desde su web y vista previa de activos

Fecha: 7 de noviembre de 2026. Estado: propuesta de implementación, sin código funcional modificado.
Encargo: [PLAN-BIZ-001](tasks/TASK-PLAN-BIZ-001.md).

## Resultado para el usuario

1. Introduce la web en el campo existente y pulsa **Analizar mi negocio**.
2. Ve avance: leyendo web, preparando contexto y capturando escritorio/móvil.
3. Recibe una propuesta editable con descripción, datos del negocio, fuentes y dos capturas reales.
4. Puede corregirla, elegir qué incorporar y pulsar **Guardar contexto y capturas**.
5. Puede seguir escribiendo y guardando manualmente, sin introducir una URL ni usar IA.
6. Un clic en una imagen de la lista lateral abre su vista previa directamente.
   La biblioteca actual de todos los archivos conserva su funcionamiento.

Supuestos de diseño recomendados: negocio único del contexto actual, web pública,
sin login, sin actualización automática y sin reemplazo silencioso de datos manuales.
El análisis rellena un borrador, no inicia generación ni publicación de contenido.

## Base real y alternativas

- `server.js:166-176`: añadir URL solo guarda un enlace con resumen fijo.
- `productContextService.js:135`: `saveAll` reemplaza contexto y metadatos; no debe recibir directamente una respuesta de IA.
- `frontend/js/app.js:627-646`: la lista lateral genera texto y botón borrar, sin acción de abrir.
- `app.js:693,890`: el popup actual muestra una cuadrícula de imágenes. No existe un visor individual que se pueda reutilizar sin añadir lógica.
- `knowledgeService.getImageAssets` y `AgentOrchestrator.js:295,758` incorporan imágenes de marca; guardar capturas sin clasificación puede convertirlas en referencias indiscriminadas.
- No hay dependencia directa Playwright/Puppeteer declarada ni servicio actual de captura.

| Alternativa | Ventaja | Coste o limitación |
| --- | --- | --- |
| **Navegador controlado en backend + agente extractor (recomendada)** | Texto y capturas del contenido realmente visitado; admite webs con JavaScript | Instalar navegador y controlar recursos/red |
| Lectura HTML + servicio externo de capturas | Menor carga local | Otro proveedor, coste y transferencia de datos; dos resultados que coordinar |
| Solo agente con búsqueda/grounding | Aprovecha integración actual | No garantiza lectura completa ni produce las dos capturas; insuficiente por sí solo |

Se propone Playwright Library + Chromium como herramienta del agente de negocio.
La librería soporta capturas y emulación de dispositivos; esto no está instalado ni
validado todavía en el runtime de la app. Los MCP del chat sirven para desarrollo,
no se convierten automáticamente en herramientas del backend.

## Contratos y arquitectura propuesta

Separar navegación, extracción y aplicación, bajo un agente coordinador:

- `businessContextAgent`: coordina un flujo acotado; no ejecuta instrucciones recibidas de la web.
- `websiteCaptureService`: navegación real, texto visible/metadatos/enlaces y capturas; sin decisiones editoriales.
- `businessContextService`: valida JSON del modelo, forma borrador con evidencia y controla estados/aplicación.
- `productContextService`: conserva su contrato actual de contexto + metadata para los consumidores.
- `knowledgeService`: registra únicamente los activos aceptados y su procedencia.

Rutas nuevas, agrupadas en `backend/routes/businessContext.js` y montadas desde server:

| Operación propuesta | Resultado |
| --- | --- |
| `POST /api/product-context/analyze` con URL y clave de petición | `202`, jobId; doble clic con misma clave recupera el trabajo |
| `GET /api/product-context/analysis/:jobId` | Estado, progreso, borrador validado, fuentes, capturas y errores por etapa |
| `POST /api/product-context/analysis/:jobId/apply` | Guarda selección explícita con baseRevision; respuesta con contexto y assetIds |
| `DELETE /api/product-context/analysis/:jobId` | Cancela/descarta borrador y temporales, sin borrar activos ya aceptados |

Estados: `queued → reading → extracting → capturing → ready | partial | failed`,
seguidos de `applied`, `cancelled` o `expired`. Los fallos de una captura no borran
el texto obtenido. Un bloqueo total deja intacto el contexto manual y ofrece reintento.
El trabajo tiene plazo total y cancelación real del navegador, no solo un mensaje de timeout.
Persistir manifiestos sin HTML bruto en `backend/data/business-context-jobs/`; al
reiniciar, los trabajos interrumpidos se marcan fallidos y se permite reintento explícito.

### Extracción y capturas

- Leer la URL indicada y hasta cuatro enlaces relevantes del mismo origen: servicios/productos,
  sobre nosotros y contacto. Excluir login, checkout, descargas y navegación ilimitada.
  Un cambio de dominio requiere confirmar el destino en la UI antes de continuar.
- Extraer texto visible, título, descripción y datos estructurados útiles. El agente devuelve
  nombre, sector, oferta, audiencia, beneficios, localización y tono cuando haya evidencia.
  Cada afirmación relevante lleva URL fuente y fragmento de respaldo; lo ausente queda sin completar.
  Hashtags y tono sugerido se etiquetan como propuestas, no como hechos extraídos.
- No usar Google Search por defecto ni el fallback sin grounding como prueba de lectura.
  Si la web no se puede leer, informar del bloqueo y conservar la vía manual.
- Capturar la página de entrada resuelta en dos contextos independientes: escritorio
  de 1440×900 y perfil móvil con viewport 390×844, DPR 1. Móvil significa emulación
  responsive, sin prometer un dispositivo físico. Confirmar con fixtures el perfil real usado.
- Dos PNG de viewport por análisis como base; miniaturas y dimensiones verificadas.
  Así se obtienen referencias legibles para generación. Página completa o secciones
  específicas quedan como ampliación, con límite de altura/píxeles.
- Esperar contenido principal, fuentes y carga de imágenes con plazo limitado; no esperar
  indefinidamente a que termine toda la actividad de red. Detectar errores, CAPTCHA y overlays.
  Ante consentimiento, preferir rechazo de cookies opcionales si es identificable; si no,
  advertir que la captura contiene el aviso. No simular una captura limpia inexistente.

Límites iniciales propuestos: cinco páginas, profundidad uno, cinco saltos de redirección
por navegación, puertos 80/443, dos capturas, un análisis activo por contexto,
120 segundos totales, 20 segundos por navegación, 2 MiB de texto por página,
50 MiB de transferencia total, 200 solicitudes y 5 MiB por PNG. Superar límites produce
resultado parcial/fallido tipificado y cierra recursos. Máximo 30.000 caracteres de evidencia
para una llamada de extracción, con salida máxima de 4.000 tokens. El adaptador de
generación debe admitir ese límite explícito (el servicio actual no lo propaga).
Un reintento manual de validación se trata como nueva
operación con consumo indicado, no bucle de llamadas. Reintento de captura fallida reutiliza
el texto obtenido. Los límites son propuesta de partida y se comprobarán con fixtures.
Temporales descartados, vencidos o interrumpidos: limpieza a las 24 horas y al arrancar.

### Edición manual, persistencia y aplicación

- Capturar una revisión del contexto al iniciar; usar versión/fingerprint de todo el documento,
  no solo fecha. Las rutas manuales y la aplicación usan el mismo servicio de escritura.
- Los campos ya completados se conservan por defecto. Mostrar propuestas alternativas;
  rellenar vacíos o incorporar secciones nuevas sin sustituir texto manual automáticamente.
  La versión final de texto es editable; sustituir un campo ocupado requiere selección explícita.
- Mantener dos snapshots en frontend: documento guardado y edición local. Si el usuario
  escribe durante el análisis, no reponer una respuesta antigua en sus campos; mostrar comparación.
- Al aplicar, revisar baseRevision bajo el mismo bloqueo de escritura. Conflicto: `409`,
  nada aplicado y comparación con la versión actual. Cancelar no modifica datos guardados.
- Preparar capturas en almacenamiento temporal privado al job; generar nombres UUID y PNG
  validados. Servir previews por ruta controlada, no exponiendo rutas físicas ni HTML remoto.
- Aplicar contexto y activos como operación idempotente con registro de aplicación y
  recuperación/rollback ante fallos de ambos JSON. No basta con dos writeFile consecutivos.
  Los activos incompletos no entran en la lista ni son consumidos por los agentes.
- Mantener copia anterior para restauración y conservar metadata adicional existente
  (incluido presenterProfile), `webImport` y extensiones al guardar manualmente con `saveAll`.
  Activos antiguos sin metadata siguen funcionando.

Cada captura aceptada tendrá `type: image`, `mimetype: image/png`, `assetRole: website-screenshot`,
`viewport`, `width`, `height`, `sourceUrl`, `finalUrl`, `capturedAt`, `analysisId`, hash y descripción.
Guardar campos nuevos de importación en un bloque `webImport`, sin cambiar el texto que
los agentes esperan de `getAsPromptSection`. Los datos de procedencia no son hechos comerciales adicionales.

## Vista previa y uso real de las capturas

- Añadir helper `openAssetPreview(assetId)` y un visor individual ligero: imagen grande,
  descripción, origen, fecha y dispositivo si existen. Resolver archivo desde el registro;
  no aceptar rutas arbitrarias del DOM ni interpolar contenido externo con `innerHTML`.
- La lista lateral usa un botón accesible para abrir; Enter/Espacio equivalen al clic.
  Escape cierra y devuelve foco al origen. Borrar sigue siendo acción separada, sin abrir preview.
- Mantener `openMediaLibrary` y su cuadrícula; puede llamar al mismo visor al pulsar una tarjeta,
  volviendo a la biblioteca al cerrar. Manejar imágenes eliminadas, 404 y tipos sin vista previa.
- Introducir selección de referencias por rol/uso, respetando comportamiento de activos antiguos.
  Capturas web sirven para contenido sobre el negocio o su web; no son logos ni demuestran
  una interfaz privada de la app. No enviar todas las capturas a todas las generaciones.
- Ajustar tanto workflow normal como audio reel; probar que un logo previo sigue seleccionado
  y que las capturas aceptadas sí llegan a un consumidor cuando corresponden. Guardarlas en disco
  no constituye por sí solo integración con el contexto visual.
- Describir cada captura con página, dispositivo y funciones realmente observadas en su DOM,
  de modo que también aporte contexto textual. No inferir funciones privadas desde su apariencia.

## Fases, responsables y aceptación

| Fase | Propietario y archivos | Dependencias | Cierre verificable |
| --- | --- | --- | --- |
| 0. Contratos y fixtures | Arquitectura; contratos, muestras y tareas | Ninguna | Esquema de draft/job/asset, política merge, acceso y límites fijados |
| 1. Preview lateral | Frontend: `frontend/js/app.js`, `frontend/index.html`, CSS | Independiente de extracción | Un clic/teclado abre imagen; biblioteca y borrado conservados |
| 2. Navegación y captura | Backend: nuevo `websiteCaptureService.js`, `publicWebPolicy.js`, `backend/package.json` y lockfile | Fase 0 | Texto real y dos PNG verificables; aislamiento/red y cierres probados |
| 3. Agente y borradores | Backend: nuevos `businessContextAgent.js`, `businessContextService.js`, ruta, skill runtime dedicada y límite de salida en adaptador Gemini | Contratos 0, servicio 2 | Datos con fuentes y estados parciales; sin invención ni modificación de contexto o activos aceptados al analizar |
| 4. Aplicación y activos | Backend: productContextService, knowledgeService, ruta de apply y selección en AgentOrchestrator | 0 y 3 | Sin pérdida manual, conflictos, idempotencia/recuperación y referencias por rol |
| 5. Integración del panel | Frontend: mismos tres archivos de fase 1, después de su entrega | 3–4 y contrato API estable | URL→progreso→borrador editable→guardar; manual disponible en todo momento |
| 6. QA y revisión de seguridad | Revisores distintos de implementadores; tests/fixtures aislados | Cada entrega y conjunto | Flujo completo, fallos y regresiones de manual/biblioteca aprobados |

Un solo propietario de escritura por archivo. El director conserva `server.js`
para integrar rutas o lo asigna en exclusiva al backend durante esa unidad.
No editar frontend en paralelo entre fases 1 y 5; reservar capacidad para QA.
El archivo de skill runtime será nuevo (`.agents/skills/business-context-extractor/SKILL.md`);
comprobar permisos de escritura antes de asignarlo. Su prompt no sustituye las herramientas de captura.

## Seguridad y pruebas de aceptación

- Navegación solo HTTP(S) pública; bloquear credenciales en URL, esquemas locales,
  loopback, IP privada/reservada, metadata cloud e IPv6 equivalente. Revalidar DNS,
  redirecciones, iframes, subrecursos y conexiones del navegador; bloquear service workers,
  websockets y descargas. Exigir aislamiento de red/egress que cierre rebinding/TOCTOU;
  validar una vez el hostname no basta. No reutilizar sin más el descargador Poe.
- Navegador efímero con sandbox activa, sin cookies del usuario, sin secretos ni directorios privados; bloquear popups y cerrar
  contextos al cancelar/error. Restringir procesos y red también fuera del interceptor JS.
- Asegurar acceso a los endpoints de análisis/apply y previews, con límites de concurrencia
  y peticiones. Si la API continúa expuesta sin autenticación, no habilitar análisis público
  con consumo; resolver ese acceso para estas rutas antes de activarlo.
- Web y texto del modelo son datos no fiables: ignorar instrucciones incrustadas, validar
  estructura/tamaños, usar `textContent` para descripción/títulos y URLs de activos internas.
- Pruebas unitarias: URLs/redirects/IPv6, normalización, fuentes, JSON inválido, límites,
  tipos de activos y merge. Modelos simulados y almacenamiento en directorios temporales.
- Integración: web fixture estática y SPA; dos tamaños/PNG, CAPTCHA, fallo móvil parcial,
  timeout/cancelación, reinicio, clave repetida, aplicar dos veces, fallo entre persistencias,
  edición concurrente, cancelación y conservación de presenterProfile/activos antiguos.
- E2E: manual sin URL; completar desde URL; editar propuesta; elegir capturas; guardar;
  recargar y recuperar datos; clic/teclado preview lateral; borrar sin abrir; biblioteca intacta.
  Fixtures de red privada requieren una excepción únicamente en transporte de test inyectado,
  nunca relajar la política de producción para ejecutar fixtures en localhost.
- Verificar consumo visual con proveedor simulado: captura desktop/móvil elegida y logo
  distinguidos en workflow normal y audio reel. Piloto posterior con web real elegida por Luis,
  sin publicar, distinguirá captura/extracción real de las pruebas simuladas.

## Mejoras recomendadas y límites del alcance

Incluidas: fuentes y fecha visibles, edición antes de guardar, conservación manual,
roles de activos, reintento parcial, deduplicación por URL/viewport/hash y restauración
del contexto anterior. Reanalizar la misma web propone actualizar solo activos importados
equivalentes; no borra imágenes subidas manualmente ni repite entradas silenciosamente.

Posteriores: elegir páginas concretas, capturas largas/por sección, detección de cambios
y extracción de logo/colores con confirmación. Sin crawling de todo el sitio, acceso a
zonas privadas, búsquedas de competidores, soporte multinegocio o automatizaciones nuevas.
Los defectos de calendario/publicación detectados en onboarding no bloquean este plan
y no se mezclan con esta implementación.

## Evidencia y fuentes

Exploración con MCP Codebase Memory de raíz exacta y contraste en disco; especialistas
de arquitectura, frontend y QA/seguridad. No se instalaron dependencias, no se visitó una
web de negocio, no se hicieron capturas ni se ejecutaron pruebas de la función inexistente.
La revisión del plan es documental, no validación del runtime.

- [Playwright Library](https://playwright.dev/docs/library): API de navegador utilizable desde backend.
- [Capturas](https://playwright.dev/docs/screenshots) y [emulación](https://playwright.dev/docs/emulation): capacidad técnica verificada en documentación oficial; integración pendiente.
- [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): defensas de aplicación y red que fundamentan el aislamiento propuesto.
