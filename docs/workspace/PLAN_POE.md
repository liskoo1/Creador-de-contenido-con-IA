# Plan de implementación de Poe

4 de noviembre de 2026 · Propuesto · POE-001

## Resultado esperado

Generar imágenes con Nano Banana 2.1 y clips con Gemini Omni 1.1 Flash desde
Helpmeagro, descontando ambos del saldo de Poe. La app descarga los archivos,
los monta con Remotion cuando corresponda y los entrega al flujo de revisión
existente. La activación automática queda condicionada a validar formato,
consumo, control de acceso y recuperación de trabajos.

## Estado del proyecto

Se revisó el árbol de trabajo con base en `1f2e715`, incluidos los cambios
locales posteriores al último commit. Codebase Memory sirvió para localizar
los componentes. Las rutas se contrastaron en disco porque el índice puede
ir por detrás de los cambios locales.

| Punto actual | Encaje de Poe |
| --- | --- |
| `backend/server.js`, `POST /api/create` y `/api/status/:id` | El servidor devuelve un `projectId` y continúa en segundo plano. Conservar el estado y SSE, y añadir progreso de generación, descarga y montaje. |
| `backend/agents/Agent.js` | Imagen elige Google/OpenAI. Vídeo llama a Gemini. Concentrar la elección del proveedor visual en un punto compartido por las rutas directas y las que usan prompts de skills. |
| `backend/core/AgentOrchestrator.js` | Reels directos, escenas y montaje usan el mismo contrato de archivos. El bloqueo de personaje aún llama directamente a Gemini. Resolver su proveedor junto al de imagen para contabilizarlo. |
| `/api/create-audio-reel` | Mantener la transcripción Gemini. La elección de proveedor visual se aplica a las imágenes de las escenas. |
| `backend/services/agroImageService.js` | Noticias y precios tienen llamadas propias a Gemini. Migrarlas de forma explícita después del piloto creativo si interesa incluirlas en el mismo saldo. |
| `backend/automation/scheduler.js` | El calendario ya aplica cupo editorial. El cupo de publicaciones y el presupuesto de puntos son controles distintos. El generador automático necesita política propia de proveedor y reintento. |
| `frontend/index.html` y `frontend/js/app.js` | Conservar el campo `imageModel` y añadir Poe como opción válida. Añadir `videoProvider` por separado. `engineMode` sigue eligiendo directo o Remotion. |
| `backend/services/videoService.js` | Consume archivos locales y crea miniaturas. El adaptador debe entregar medios con el mismo contrato para reutilizarlo. |
| Publicación, métricas y experimentos | Los cambios locales ya incluyen IDs por red, aprobación con token, Insights/importación y experimentos. La procedencia de un medio se guarda aparte de `publishedPlatformIds` y del rendimiento editorial. |

La línea base se ejecutó sobre una copia temporal del código sin configuración
real. Pasaron las siete pruebas de integración editorial con dobles de prueba.
La suite completa quedó sin validar porque las pruebas HTTP recibieron
`EACCES` en conexiones a `127.0.0.1`. Antes de integrar el proveedor, se
necesita una línea base completa en un entorno que permita el servidor local.

## Contrato de Poe que debe validar el piloto

- El [catálogo público](https://api.poe.com/v1/models) contiene
  `gemini-omni-1.1-flash` y `nano-banana-2.1`. Ambos exponen
  `supported_endpoints: []` en la consulta realizada. La
  [ficha de Omni](https://poe.com/gemini-omni-1.1-flash/api) anuncia acceso API,
  pero el catálogo deja pendiente el contrato de transporte.
- La vía nativa está documentada en la
  [guía de aplicaciones externas](https://creator.poe.com/docs/external-applications/external-application-guide)
  con `ProtocolMessage.parameters`, adjuntos y `fastapi-poe`. Probarla
  primero en un piloto aislado. Probar el endpoint
  [compatible con OpenAI](https://creator.poe.com/docs/external-applications/openai-compatible-api)
  con `stream:false` solo como alternativa controlada. Elegir el transporte
  según la respuesta observada, incluida la entrega de archivos.
- Para imagen, solicitar `image_size: 1K` y `aspect_ratio: 9:16` con una
  referencia de marca. Para vídeo, solicitar `aspect_ratio: 9:16`,
  `resolution: 720p` y `task: image_to_video` para animar una imagen.
  Usar `reference_to_video` cuando el archivo actúe como referencia de
  identidad, según el contrato comprobado. Para texto solo, usar `auto` u
  omitir `task`. El valor `text_to_video` del flujo actual no figura entre
  las opciones de Poe. Validar texto a vídeo antes de habilitar ese modo.
  La duración no figura como
  parámetro de Omni en el catálogo. Pedir ocho segundos en el prompt y medir
  la duración devuelta. El endpoint `/v1/videos` queda fuera hasta que
  [su referencia](https://creator.poe.com/api-reference/createVideo) enumere Omni.
- Guardar el resultado en disco mediante el adaptador. El contrato de imagen
  conserva `{ path, url }`. El de vídeo conserva `{ path, url, hasAudio,
  duration, audioCodec, engine, thumbnail }`. Confirmar el mecanismo de
  entrega de Poe con la respuesta real. Una respuesta de texto sin medio
  descargable se considera error. `ffprobe` determina proporción, duración y
  audio del archivo. Entregar al montaje la duración medida y la presencia de
  una pista real, incluso cuando el guion lleve diálogo. Tras validar las URLs
  locales, el montaje debe seguir contando con todas las escenas requeridas.

## Fases y criterios de salida

| Fase | Responsable | Trabajo y evidencia de salida |
| --- | --- | --- |
| **0. Piloto de contrato** | Backend + QA | Crear una prueba aislada con clave en el entorno del servidor. Consultar catálogo y saldo. Generar una imagen y un clip con referencia y validar archivos locales, 9:16, duración, audio, cargo real y montaje de prueba. Registrar el contrato observado. Si la duración exacta no es reproducible, acordar el margen aceptable antes de activar un flujo que exige ocho segundos. |
| **1. Adaptador y coste** | Backend | Añadir `backend/services/poeService.js` y el enrutamiento visual. Usar la vía que superó el piloto. Implementar descarga segura, estado de generación y reserva de puntos. Pruebas con respuestas grabadas y saneadas o dobles, sin gasto real. |
| **2. Creación manual** | Frontend + backend + QA | Añadir selectores y validación en servidor. Validar imagen individual, carrusel, Reel directo, Reel montado y Audio Reel con los proveedores pertinentes. Exponer saldo o fallo de generación sin revelar datos de la cuenta. Conservar las opciones Google/OpenAI y el archivo existente. |
| **3. Autopiloto** | Backend + seguridad + QA | Activar Poe por configuración explícita para un flujo creativo. Identificar cada entrada y escena de forma persistente. Probar dos ciclos del planificador, saldo insuficiente y reinicio sin duplicar trabajos. Incorporar personaje, noticias y precios según el consumo medido. Conservar el cupo editorial y la aprobación existente. |
| **4. Paso a producción** | Director + QA | Comparar una muestra de escenas y piezas de marca, consumo real y reintentos. Verificar que el ritmo mensual previsto cabe en la cuota. Activar por etapas y comprobar desactivación sin alterar los trabajos anteriores. |

Fase 0 requiere una cuenta habilitada, una clave cargada en el entorno y
autorización para gastar los puntos de la prueba. La preparación local y
los dobles de prueba se pueden desarrollar antes de ese gasto. La salida de
cada fase se revisa con un especialista distinto del implementador.

El piloto propone una imagen y un intento de clip, con reserva interna inicial
de 40.000 puntos y sin reintentos de generación. La reserva es un margen de
planificación. El proveedor determina el cargo efectivo, que se comprueba con
el historial antes de continuar con más pruebas.

## Presupuesto y protección de la automatización

- Saldo observado: 660.000 puntos por 22,99 €/mes en el
  [selector mensual de Poe](https://poe.com/subscription_plans).
  La estimación previa de 1.120 puntos por imagen 1K y 27.060 por clip de
  ocho segundos a 720p corresponde a salida. Una imagen de referencia,
  texto, audio, variaciones y reintentos afectan al total. Medir con
  `GET /usage/current_balance` y `GET /usage/points_history`. Correlacionar
  `query_id` y `cost_points` solo cuando los datos del piloto lo permitan.
- Definir techo configurable por trabajo y por ciclo de cuota. Reservar
  puntos antes de enviar escenas en paralelo y conciliar con los cargos.
  Empezar con una generación a la vez. Un saldo compartido puede cambiar
  fuera de la app. Si el saldo o el resultado son inciertos, pausar nuevas
  generaciones hasta aclararlos.
- Diferenciar falta de saldo, límite de frecuencia y estado incierto tras
  timeout. Respetar `Retry-After` cuando corresponda. Eliminar reintentos
  automáticos de una generación cuyo envío pudo ser aceptado. La política
  aplica al SDK, al revisor del agente y al planificador. En particular, el
  planificador hoy puede devolver una entrada fallida a `planned`.
- Persistir la relación entre entrada o proyecto, escena, intento y cargo
  antes de habilitar el autopiloto. El estado actual de creación manual vive
  en memoria. Evitar que un resultado tardío cree un post después de declarar
  el trabajo fallido y evitar repetir un POST al reiniciar.
- En el flujo actual pueden omitirse escenas fallidas y resolverse el
  orquestador con medios incompletos. Propagar los fallos de saldo y estado
  incierto hasta el servidor y el planificador. Detener los nuevos envíos del
  mismo trabajo y exigir los medios requeridos antes de guardar un borrador,
  marcarlo como completo o solicitar aprobación. Cualquier alternativa de
  montaje debe quedar definida y habilitada de forma explícita.
- Las rutas de creación están en el mismo Express que sirve los medios
  públicos. Proteger las operaciones que puedan gastar Poe con autenticación
  del panel o aislamiento de red antes de exponerlas. Guardar `POE_API_KEY`
  en el entorno del servidor. Validar las rutas de los adjuntos y los dominios
  de descarga observados, incluidos redireccionamientos, tamaño y tipo de
  archivo. Registrar estado, puntos y correlación sin claves, URLs firmadas
  ni datos de referencia sensibles.

## Aceptación del piloto y reversión

El piloto se aprueba cuando una imagen y un clip con referencias se pueden
crear y descargar desde el backend, se mide el coste de ambos y el clip se
monta en Remotion con el encuadre y audio esperados. La revisión cubre errores
402/429, timeout con estado incierto, respuestas sin medio, descarga inválida
y regresión de los flujos actuales. La automatización requiere además una
prueba de reinicio y un presupuesto suficiente para el volumen real.

Poe entra desactivado por defecto. La reversión consiste en desactivar Poe
para trabajos nuevos y volver a seleccionar Google/OpenAI. Los trabajos ya
enviados se concilian por separado para conservar su cargo y resultado.
