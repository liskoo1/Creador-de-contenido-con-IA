# Auditoría de Poe y propuesta de operación autónoma de Instagram

**Proyecto:** Creador de contenido · Helpmeagro  
**Fecha:** 5 de noviembre de 2026  
**Encargo:** analizar la implementación existente y definir cómo llegar a una operación con calendario semanal, análisis, contenido y atención, con aprobación desde el correo.  
**Alcance de esta entrega:** auditoría y propuesta. No se han activado automatizaciones, publicado contenidos, enviado respuestas ni generado medios de pago.

## 1. Dictamen

La aplicación tiene una base aprovechable: generación por agentes, publicación, correo de aprobación, calendario, registro de publicaciones, consulta de algunas métricas y análisis de experimentos. **Todavía no constituye un director de Instagram que observe la cuenta, decida, ejecute y aprenda de manera autónoma.** Las piezas existen parcialmente, pero falta cerrar ese circuito.

Poe se encuentra en fase de servicio piloto. Su archivo existe y contiene llamadas de generación, pero no está conectado al recorrido habitual del generador ni del autopiloto. Además, presenta defectos que impiden dar por validada la generación real de vídeos verticales y el control del gasto.

Las 13 skills de Instagram se usan como referencias para redactar y revisar. Su integración declara expresamente que produce borradores y no dispone de Insights, navegador, publicación ni envío de mensajes. Instalar esas instrucciones no concede esas capacidades: hay que construir los conectores, trabajos programados y controles que las ejecuten.

**Recomendación:** completar un sistema operativo semanal sobre la aplicación actual, con responsabilidades separadas y datos persistentes. El generador visual es uno de sus componentes; el crecimiento dependerá también de la utilidad del contenido, la distribución, la conversación y la medición. No hay datos suficientes en esta auditoría para atribuir el estancamiento a una causa concreta o prometer resultados.

## 2. Qué hay realmente

| Capacidad | Evidencia en el código actual | Evaluación |
| --- | --- | --- |
| Generación de textos y medios | `backend/agents/Agent.js`, `backend/core/AgentOrchestrator.js` | Existe; imágenes habituales Google/OpenAI y vídeo mediante Google |
| Servicio Poe | `backend/services/poeService.js` | Piloto separado, sin integración en el flujo principal |
| Skills Instagram | `backend/services/instagramSkillsService.js`, `backend/routes/instagram.js` | Referencias y borradores; no agentes operativos con herramientas |
| Calendario | `backend/automation/scheduler.js` | Sigue siendo mensual; `runMonthlyPlanning()` y cron del día 1 |
| Noticias y precios | `scheduler.js`, `backend/services/agroDataService.js`, `agroImageService.js` | Existen recorridos específicos; hay conflictos con la exigencia de conservar ambas publicaciones diarias |
| Aprobación por correo | `backend/automation/approvalGateway.js`, `backend/server.js` | Existe para piezas generadas; el enlace de aprobación intenta publicar inmediatamente |
| Publicación y resultado por red | `backend/services/publishingService.js`, `postService.js` | Hay registro de identificadores y tratamiento de éxito parcial |
| Métricas propias | `instagramPublisher.getMediaInsights()`, endpoints de sincronización/importación | Consulta parcial bajo petición; no se acredita un ciclo periódico conectado al planificador |
| Experimentos | `backend/services/experimentService.js` | Agrega resultados e hipótesis; no decide ni modifica automáticamente el siguiente calendario |
| Competidores | No se encontró conector operativo de Business Discovery | Pendiente |
| Comentarios y mensajes | No se encontraron endpoints operativos de recepción/respuesta de Instagram | Pendiente |
| Operación continua | Cron dentro del proceso Node, archivos JSON para estado local | Requiere asegurar disponibilidad, recuperación y exclusión de trabajos duplicados |

Los agentes de desarrollo de Codex/Antigravity y los agentes de contenido de la aplicación cumplen funciones distintas. Los primeros construyen y revisan el producto; para que el segundo equipo trabaje cuando el chat está cerrado, sus tareas deben existir en el backend en ejecución.

## 3. Auditoría de Poe

### 3.1. Integración incompleta

`Agent.js`, aproximadamente líneas 105–147, sigue seleccionando OpenAI o Gemini para imágenes y Gemini para vídeo. `AgentOrchestrator.runFullWorkflow()` conserva `imageModel = 'google'`. El autopiloto llama al orquestador sin transmitir una configuración de proveedor visual específica. Además, el anclaje de personajes y los servicios agro mantienen llamadas directas a Gemini.

**Consecuencia:** tener `POE_API_KEY` y `poeService.js` no hace que la aplicación utilice automáticamente los puntos de Poe. Persistiría gasto directo en otros proveedores. Cambiar únicamente el selector de la interfaz tampoco cubriría el autopiloto ni las rutas secundarias.

Debe existir un adaptador visual común para imágenes y vídeo, con configuración persistida por trabajo. El proveedor de texto debe definirse por separado: incorporar Poe a imágenes/vídeos no elimina por sí solo las llamadas de texto, grounding o transcripción a Google/OpenAI.

### 3.2. Hallazgos que bloquean su uso desatendido

| Prioridad | Hallazgo y evidencia | Efecto | Corrección necesaria |
| --- | --- | --- | --- |
| P0 | `getBalance()` lee `data.balance` o `data.points`, pero la documentación oficial devuelve `current_point_balance` [F4] | Una cuenta con saldo válido se interpreta como saldo cero y ambas generaciones se bloquean por insuficiencia | Parsear el contrato oficial, validar el tipo y probar una respuesta realista del endpoint |
| P0 | Los payloads de `generateImage()` y `generateVideo()` —aprox. líneas 343 y 477— no envían `aspectRatio`, `imageSize`, `resolution` ni `task` | La respuesta devuelve esos valores como si fueran efectivos, aunque no se han solicitado al proveedor | Validar el transporte soportado por cada modelo y transmitir sus parámetros reales; probar 9:16 y resolución del archivo recibido |
| P0 | Sin clave, ambos generadores devuelven `success: true, mock: true` | Una integración que compruebe solo `success` podría tratar una simulación como material publicable; el vídeo simulado contiene texto, no un MP4 válido | En producción, faltar la clave debe bloquear. Simulación solo explícita y rechazada antes de aprobar/publicar |
| P0 | Vídeo real devuelve `duration: 8.0`, `hasAudio: true`, `audioCodec: 'aac'` de forma fija —aprox. líneas 531–534— | Remotion y el publicador recibirían metadatos no medidos; posibles cortes, silencios o fallos | Inspeccionar el archivo con ffprobe; validar duración, dimensiones, pistas y códecs, y normalizar si procede |
| P0 | `costPoints` siempre es 1.200 para imagen y 30.000 para vídeo; comprobar saldo no reserva puntos | No acredita el coste real ni impide que trabajos simultáneos gasten el mismo saldo disponible | Separar estimación, reserva y cargo observado; libro de consumo persistente y reconciliación de operaciones |
| P1 | `downloadMediaFile()` filtra algunos nombres/IP literales, pero `fetch()` sigue redirecciones y no valida la resolución DNS | La protección anunciada no cubre destinos privados tras DNS/redirección ni todos los rangos IPv6 | Descargas HTTPS con validación de destinos efectivos, límites durante el streaming y pruebas de evasión |
| P1 | Se usa `arrayBuffer()` completo antes de comprobar el tamaño real; escritura directa con `writeFileSync()` | El límite posterior no limita la memoria durante la descarga; la persistencia no es atómica | Cortar la transferencia al superar el límite, escribir temporalmente y renombrar al validar |
| P1 | Timeouts devuelven un fallo genérico y no dejan registro durable del estado incierto | Un reintento posterior podría pagar una segunda generación aunque la primera haya terminado | Estado `unknown`, identificador de operación y reconciliación antes de repetir |

La comprobación de saldo previa es un primer control útil, pero no equivale a un presupuesto mensual ni a una reserva concurrente. La constante de reserva del piloto tampoco prueba que se aplique a cada trabajo.

### 3.3. Qué validan las pruebas y qué no

`backend/tests/poe_pilot.test.js` combina consultas del catálogo público, descargas desde un servidor local, respuestas fabricadas y generación en modo simulado. Que un modelo figure en el catálogo no demuestra que el payload actual produzca un archivo utilizable, que respete parámetros o que su coste coincida con las constantes.

La decisión D-016 de `docs/workspace/DECISIONS.md` afirma persistencia atómica, seguridad del descargador y contrato audiovisual. Esas afirmaciones necesitan matizarse con los hallazgos anteriores. La compatibilidad real de un clip no queda probada al afirmar los valores 8 segundos y AAC en un objeto de prueba. El backlog, de hecho, mantiene POE-001 en progreso y POE-002 pendiente.

Antes de activar Poe: piloto real acotado, inspección de una imagen y un vídeo vertical, referencias de imagen verificadas, composición Remotion, descarga y coste observado. Esta auditoría no ha efectuado llamadas de generación pagada.

Poe documenta una API compatible con OpenAI que consume puntos de la suscripción y admite varias modalidades [F1]. Eso hace viable la automatización por API; no significa generación ilimitada ni valida automáticamente el transporte de cada bot.

## 4. Calendario semanal y publicaciones diarias protegidas

### 4.1. Discrepancia actual que hay que resolver

El usuario pide conservar la noticia y los precios diarios. Sin embargo, la configuración predeterminada actual limita el feed a una publicación diaria y 24 mensuales, y usa `allowNewsOnCreativeDays: false`. `enrichScheduleWithBudget()` puede omitir la noticia al coincidir con una creatividad o agotar el cupo. Los precios se programan de lunes a sábado, excluyendo domingos.

Estas son propiedades del código, no una confirmación de lo que se está publicando realmente en la cuenta. No se ha leído ni alterado la configuración privada activa.

**Regla del diseño propuesto:** las dos rutinas agro son compromisos protegidos. El calendario creativo semanal no debe cancelarlas, desplazarlas ni consumir su reserva. Los límites de frecuencia creativa y de coste se calculan después de reservarlas. Si falta una noticia válida o un precio nuevo, se registra y comunica la incidencia: no se inventan datos para aparentar cumplimiento.

La excepción de precios del domingo debe quedar identificada en la migración: conservar la pauta existente implica mantenerla; exigir literalmente siete días exige una fuente válida para ese día. No se cambia ni se interpreta silenciosamente en esta entrega.

### 4.2. Cambio de contrato necesario

Sustituir el mes y el número de día por fechas completas: `weekStart`, `scheduledAt`, `timezone`, `entryId`, `lane`, `status` y `postId`. Zona de negocio: `Europe/Madrid`; almacenamiento de instantes en UTC y visualización local.

Aunque el cron declara Madrid, `checkAndExecute()` todavía calcula día y hora con `getDate()`/`getHours()` del servidor. La selección del mes inicial usa UTC. La migración debe corregir también estas comparaciones para que mover el backend a otro alojamiento no cambie el día de ejecución.

Separar tres momentos: generar, aprobar y publicar. Hoy el scheduler comienza a generar al llegar la hora y el correo publica al abrir el enlace de aprobación; eso no permite aprobar el domingo un vídeo para el jueves conservando su hora.

Para contenido creativo: preparar con antelación, validar, enviar vista previa y dejar lo aprobado en cola hasta su fecha. Para noticias/precios: conservar su frescura y circuito diario; no generar el domingo los datos de toda la semana.

La migración debe conservar publicaciones realizadas, piezas aprobadas, identificadores y pendientes válidos. Replanificar solo huecos y propuestas no comprometidas. No sobrescribir un calendario mensual entero perdiendo trabajos en curso.

## 5. Sistema operativo propuesto

No hace falta lanzar una conversación ilimitada entre agentes. Conviene un director con trabajos concretos, herramientas permitidas y entregas persistidas:

| Responsable de la aplicación | Entradas | Entrega y capacidad real que necesita |
| --- | --- | --- |
| Director de crecimiento | Objetivo, presupuesto, métricas y estado de ejecución | Prioridades semanales, asignación, resolución de fallos y resumen por correo |
| Analista de métricas | Insights propios y registro de publicaciones | Informe por formato/tema y ventana temporal; distingue ausencia de cero y datos reales de importados |
| Analista de competencia | Lista persistida de cuentas y datos públicos permitidos | Patrones, preguntas desatendidas y oportunidades originales, con fecha y fuente |
| Estratega y planificador | Informes anteriores, conocimiento del producto y rutinas protegidas | Próximos siete días, objetivo e hipótesis por creatividad, formato y presupuesto |
| Redactor y productor | Brief aprobado y fuentes | Copy, guion, carrusel o vídeo; usa skills y adaptador visual común |
| Revisor editorial y técnico | Pieza final, fuentes y medios | Comprueba exactitud, marca, utilidad, texto visible, coherencia, audio y formato; bloquea material incompleto |
| Publicador | Aprobación de versión, fecha y destinos | Publicación idempotente, identificadores y recuperación por plataforma |
| Community Manager | Eventos entrantes y conocimiento verificado | Respuestas útiles dentro de permisos y políticas; escalado por correo de casos no resueltos |

Cada decisión debe guardar los datos utilizados, el motivo, la versión del contenido y el gasto. El resultado de una skill no debe poder saltarse el presupuesto, la aprobación o los permisos mediante texto generado.

## 6. Cadencia semanal propuesta

Horarios orientativos para diseñar la operación, no automatizaciones activadas:

1. **Durante la semana:** recoger resultados de publicaciones a las 24 h, 72 h y 7 días cuando la métrica esté disponible. Recibir comentarios/mensajes por webhook y registrar estado de respuesta. Ejecutar noticias/precios con sus horarios vigentes.
2. **Sábado:** analizar datos propios, competencia y preguntas frecuentes; detectar temas repetidos, fallos y oportunidades para la siguiente semana.
3. **Domingo:** producir y revisar el contenido creativo de lunes a domingo; enviar un correo con resumen, vistas previas y botones de aprobación por pieza o lote. El lote no incluye material sin revisar ni datos agro futuros.
4. **Tras aprobar:** mantener las piezas en cola hasta su hora. Una modificación sustancial posterior invalida la aprobación de esa versión.
5. **Al cerrar la semana:** enviar resultados, gasto, incidencias y dos o tres decisiones concretas para el siguiente ciclo. Lo no aprobado no se publica; se avisa y reprograma según una política explícita.

El sistema debe funcionar al cambiar de mes, año y horario de verano. Un reinicio no debe volver a generar, reenviar correos ni publicar lo ya completado. Los trabajos perdidos durante una caída se recuperan con una regla de vigencia: una noticia caducada no se publica tarde solo para completar la cola.

## 7. Estrategia de contenido para Helpmeagro

La mejora visual de Poe puede ayudar, pero no basta para explicar por qué un agricultor debería seguir la cuenta. Propongo evaluar estas líneas, manteniendo las dos rutinas agro:

- **Utilidad inmediata:** listas y errores frecuentes de gestión de la explotación, costes o registros, con ejemplos verificables y lenguaje del agricultor.
- **Demostración del producto:** capturas reales y recorridos breves de funciones disponibles, sin pantallas inventadas ni funcionalidades prometidas.
- **Contexto del campo:** explicar el significado de una noticia o movimiento de precios y qué conviene comprobar, separando dato y opinión.
- **Conversación:** convertir preguntas reales y anonimizadas en piezas que respondan a problemas repetidos.
- **Prueba y confianza:** casos reales solo con evidencia y autorización; evitar testimonios fabricados y vídeos genéricos sin relación con Helpmeagro.

Hipótesis inicial de frecuencia creativa: dos o tres piezas por semana, ajustadas al presupuesto y a los resultados, además de noticia/precios. No es una frecuencia demostrada como óptima. Un Reel útil puede combinar capturas, gráficos y edición; no necesita pagar generación de vídeo en todas sus escenas.

Cada creatividad necesita una hipótesis: audiencia, problema, gancho, formato, llamada a la acción y señal de éxito. Cambiar una variable principal por experimento. Con muestras pequeñas se describen indicios, no se declara causalidad ni se optimiza por el éxito aislado de una pieza.

## 8. Métricas que deben alimentar las decisiones

El código consulta actualmente `impressions`, `reach`, `saved` y `total_interactions` en una única petición. No se ha demostrado su disponibilidad para todos los formatos, modalidades de acceso y versión de Meta. El adaptador debe descubrir o validar qué métricas corresponden a cada caso y no perder todas las disponibles porque una no sea compatible.

| Pregunta | Señales propuestas | Cómo utilizarlas |
| --- | --- | --- |
| ¿Llega a personas nuevas? | Alcance y distribución entre seguidores/no seguidores cuando esté disponible | Comparar formatos y temas a la misma edad de publicación |
| ¿El contenido aporta valor? | Guardados/alcance y compartidos/alcance, con denominador válido | Repetir problemas útiles cambiando enfoque, sin copiar piezas |
| ¿El vídeo mantiene interés? | Tiempo de reproducción/retención cuando Meta lo permita | Revisar apertura, ritmo y promesa del guion |
| ¿Se convierte el interés? | Seguidores netos, visitas al perfil y acciones disponibles; enlaces con UTM y analítica propia | Separar crecimiento de cuenta de visitas o contactos atribuibles |
| ¿Se atiende a la comunidad? | Tiempo de primera respuesta, eventos pendientes y resolución | Corregir colas y mejorar el conocimiento del agente |
| ¿Es sostenible? | Gasto real, piezas aprovechables, fallos y puntualidad | Priorizar formatos que aportan resultados con el presupuesto disponible |

Guardar snapshots históricos y procedencia. No basta con sobrescribir el último valor de un post. Establecer primero una línea base de 28 días si hay datos accesibles y recoger 2–4 semanas adicionales para revisar tendencias. No hay una medición real del crecimiento incluida en este informe.

`experimentService` es una base útil para este módulo, pero necesita conectarse al scheduler y al contexto del planificador. Un endpoint que calcula ratios no equivale a un agente que aprende semanalmente.

Además, `isPostMeasured()` acepta cualquier métrica numérica, incluso solo likes: una pieza marcada como medida puede carecer de alcance y guardados para calcular SRR. Los estados de hipótesis `validated/invalidated` son editables; no representan una validación automática demostrada. El informe semanal debe mostrar cobertura por métrica y separar una observación descriptiva de una conclusión experimental.

## 9. Competencia e interacción con usuarios

### Competencia

Crear una lista inicial de cuentas profesionales de competidores directos y referentes del sector, con explicación de por qué se comparan. Descubrir candidatas desde fuentes permitidas y guardar la lista; Luis no debería reconstruirla semanalmente. Recoger publicaciones públicas, temas, formatos y reacciones visibles cuando el acceso lo permita, con fecha y procedencia.

La documentación de Meta permite ciertas consultas públicas sobre otras cuentas Business/Creator mediante Facebook Login, pero no acceso general a cuentas personales ni a Insights privados [F2]. Likes y comentarios no revelan guardados, alcance, retención o ventas del competidor. La entrega semanal debe identificar oportunidades propias, no prometer conocer sus resultados internos.

### Comentarios y mensajes

Actualmente no existe la infraestructura necesaria para una atención automática: faltan suscripción de eventos, webhook Meta con validación, cola de conversaciones, permisos y métodos de respuesta. Los webhooks de aprobación del correo no cumplen esta función.

Proponer dos niveles: respuestas sencillas desde conocimiento verificado —si Luis delega esa política al activar el módulo— y aprobación por correo para casos inciertos, reclamaciones o asuntos delicados. Si se exige aprobar todas las respuestas, funcionará así, con mayor demora. Nunca usar una respuesta agronómica dudosa para cerrar una conversación automáticamente.

La mensajería tiene restricciones de inicio de conversación y permisos; no se puede interpretar un seguimiento como autorización universal de DM. Deben comprobarse modalidad de login, revisión de aplicación, nivel de acceso y ventanas vigentes antes de enviar. Una aprobación tardía por correo no permite saltarse una ventana caducada. La verificación exacta de ventanas/cuotas quedó pendiente por límites de acceso a las páginas Developers de Meta; no se dan por aprobadas en esta auditoría.

El diseño debe incluir deduplicación de eventos, contexto mínimo por conversación, firma del webhook, registro de envíos y escalado. No se propone automatizar follow/unfollow, comentarios masivos ni mensajes en frío.

## 10. Correo, seguridad y continuidad

La experiencia objetivo de Luis puede seguir siendo el correo: aprobar piezas, consultar el resumen y resolver excepciones. Pero hay que corregir el contrato actual:

- **GET sin efectos:** abrir o previsualizar un enlace no debe publicar. Hoy `/api/webhooks/approve/:postId` publica mediante GET. El token evita accesos sin enlace, pero un escáner de seguridad del correo puede visitar el enlace válido. Usar página breve de revisión y confirmación POST con token de alcance/versión y caducidad.
- **Aprobar no es publicar ahora:** la confirmación pasa la pieza a `approved`; otro trabajo publica al llegar `scheduledAt`.
- **Correo verificable:** la pasarela puede retornar sin error cuando falta configuración SMTP. Registrar envío real, fallo y reintento limitado; no dejar un post esperando una aprobación que nunca se solicitó.
- **Recuperación de aprobaciones:** `tryClaimApprovalPublish()` guarda `publishing` sin fecha de vencimiento y retira el post de `pendingApproval`. Al fallar, `releaseApprovalPublishClaim()` devuelve la entrada del calendario a pendiente, pero no reconstruye esa lista. Una caída puede dejar un bloqueo permanente y un fallo puede desalinear bandeja y calendario. Usar un estado canónico, concesiones temporales y reconciliación con Meta antes de repetir.
- **Acceso administrativo:** antes de exponer el servicio públicamente, autenticar rutas de generación y administración. CORS abierto no es autenticación. Reservar acceso por enlace firmado a acciones de alcance limitado.
- **Disponibilidad:** desplegar un backend siempre activo, HTTPS accesible para Meta y correo, almacenamiento durable de medios y estado, supervisión y copias de seguridad. Un cron en un PC apagado no ejecuta tareas.
- **Trabajos persistentes:** adoptar una cola/tabla de trabajos con reclamación atómica, vencimiento, intentos y estado incierto. Elegir SQLite para un único nodo o una base/cola adecuada al despliegue; no es necesario añadir varios servicios antes de definir el alojamiento.

La ruta `/api/agro/auto-daily` es otro recorrido de generación diaria y debe compartir claves de deduplicación con el scheduler si se utiliza. No se ha encontrado un segundo cron independiente que permita afirmar que hoy ambos se ejecuten automáticamente.

## 11. Presupuesto: una suscripción necesita control del consumo

Usar los puntos de Poe para imágenes y vídeos es compatible con el objetivo. No puede afirmarse todavía que sustituya todo el gasto de unos 47 €/mes: faltan cargos reales del flujo completo, consumo de texto y disponibilidad efectiva de modelos.

El director debe reservar primero el coste de noticias/precios, después las creatividades y finalmente un margen de incidencias. Las rutinas fijas no deben cancelarse por un vídeo creativo caro. Reducir coste en ellas mediante plantillas deterministas para datos y diseño de marca cuando resulte adecuado; esto no debe cambiar su frecuencia ni inventar contenido.

Establecer techo mensual de puntos, asignación semanal, reserva por pieza y margen de reintentos. No convertir constantes de 1.200/30.000 puntos en facturas. Si una operación agota el presupuesto o queda incierta, detener esa generación y comunicarlo por correo. Nunca cambiar silenciosamente a una API directa de pago ni comprar más puntos.

## 12. Plan de implementación y aceptación

Cada unidad requiere encargo con propietario, archivos asignados, dependencia y revisión por otra persona/agente. Los siguientes nombres son responsabilidades propuestas del equipo, no agentes runtime ya implementados.

| Orden / ID | Responsable y alcance principal | Dependencia | Criterio de cierre |
| --- | --- | --- | --- |
| 1 · AUTO-001 | Arquitectura + QA: inventario de rutinas, estados y configuración; revisar discrepancias documentales | Ninguna | Casos actuales de noticia/precio identificados y protegidos; mapa de recorridos y contrato de trabajos aprobado |
| 2 · POE-001R | Integraciones + seguridad: `poeService`, pruebas y piloto acotado | AUTO-001 para presupuestos | Parámetros efectivos, medios inspeccionados, referencias válidas, coste observado, fallo sin clave y recuperación incierta |
| 3 · AUTO-002 | Backend + seguridad: persistencia, cola, acceso, correo y publicación diferida | AUTO-001 | Reinicios y doble clic sin duplicados; abrir enlace no publica; errores SMTP visibles; aprobación conserva versión y fecha |
| 4 · POE-002 | Integraciones: adaptador común en Agent, orquestador y rutas agro; configuración manual/autopiloto | POE-001R y contrato AUTO-002 | Todas las llamadas visuales usan proveedor explícito; sin consumo directo oculto; composición completa válida |
| 5 · MET-002 | Backend + analista: snapshots propios, sincronización y señales de cuenta | AUTO-002 | Consultas programadas, métricas compatibles por formato, fallos recuperables y comparación a igual edad; sin mocks en informes reales |
| 6 · COMP-001 | Integraciones + estrategia: fuentes y lista de competencia | Acceso Meta/fuentes validado | Informe con fuentes públicas y fechas; datos privados ausentes identificados; oportunidades originales |
| 7 · PLAN-002 | Estrategia + backend: calendario semanal y contexto del planificador | MET-002, COMP-001 y AUTO-002 | Siete fechas completas; reserva de noticia/precio; no sobrescribe aprobados; incluye hipótesis y presupuesto |
| 8 · COMMUNITY-001 | Integraciones + seguridad: webhook, conversaciones y respuestas | AUTO-002 y permisos Meta | Evento repetido no duplica respuesta; política y ventana verificadas; casos inciertos al correo; aprobación caducada no envía |
| 9 · OPS-002 | Operaciones + QA independiente: despliegue y ensayo integral | Etapas anteriores | Recuperación de caída, cambio de mes y horario, fallos de proveedor/Meta/SMTP y límites de gasto comprobados |

La arquitectura y el contrato se cierran antes de repartir implementaciones que editen los mismos archivos. Métricas y competencia pueden avanzar en paralelo tras acordar sus interfaces. La atención a usuarios puede desplegarse después del calendario sin bloquear la producción editorial.

### Pruebas de aceptación del objetivo de Luis

1. Una semana se prepara con datos de cuenta y competencia disponibles; se identifica cualquier carencia. No requiere introducir un briefing manual para cada pieza.
2. El plan creativo no elimina noticia ni precios, y respeta la excepción dominical vigente hasta resolver explícitamente su fuente y pauta.
3. Se recibe el correo con piezas reales y revisadas. Aprobar una para el jueves no la publica el domingo. El silencio no equivale a aprobación.
4. Un correo previsualizado, doble clic o reinicio no causa publicaciones repetidas; las plataformas fallidas se recuperan por separado.
5. Poe entrega medios válidos y registra gasto real; falta de clave, saldo o archivo válido bloquea la pieza.
6. El siguiente plan cita qué resultados y preguntas motivaron sus cambios. No inventa métricas ni declara éxito sin datos.
7. El Community Manager responde solo con autorización y capacidad API verificadas. Lo incierto llega al correo con propuesta y contexto.
8. La cuenta sigue operando con el PC de Luis apagado; los fallos relevantes producen alertas accionables.

## 13. Evidencia, límites y fuentes

Se revisaron archivos actuales y cambios locales, contrastando Codebase Memory con el disco. La búsqueda del índice por `poeService` no devolvió coincidencias aunque el servicio existe en disco: el índice no se tomó como prueba de ausencia. No se alteraron cambios previos del repositorio.

Se delegó la auditoría en especialistas de Poe/runtime, automatización/correo, estrategia/métricas e interacciones Meta. La exploración especializada de Poe quedó incompleta por bloqueo de Codebase Memory; el director revisó directamente el servicio en disco y no se atribuyen pruebas a ese especialista. Un revisor independiente contrastó el informe con el código y dio conformidad, incluido el defecto del contrato de saldo. Se comprobó además la sintaxis de `poeService.js`, `scheduler.js` e `instagramSkillsService.js` con `node --check`, sin errores. La revisión de código no acredita que las credenciales, permisos, SMTP o publicaciones reales funcionen hoy. No se inspeccionaron secretos ni el estado privado de la cuenta. Las cifras históricas de tests en documentación son resultados declarados de trabajos anteriores, no verificaciones reproducidas en esta entrega.

Fuentes externas primarias consultadas el 5/11/2026:

- **[F1]** [Poe · OpenAI Compatible API](https://creator.poe.com/docs/external-applications/openai-compatible-api): uso de puntos de suscripción, endpoint y modalidades. Requiere validar el contrato concreto de cada modelo.
- **[F2]** [Meta · colección oficial Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7): cuentas profesionales, publicación, comentarios y consultas sobre otras cuentas profesionales. La modalidad de login y permisos condicionan la implementación.
- **[F3]** [Meta · plataforma de mensajería](https://www.postman.com/meta/messenger-platform-api/overview): referencia para la fase de integración. Parte de la documentación de detalle y las páginas Developers no fue recuperable íntegramente; permisos, revisión, ventanas y cuotas deben verificarse antes de activar atención real.
- **[F4]** [Poe · Get current point balance](https://creator.poe.com/api-reference/getCurrentBalance): el campo de respuesta documentado es `current_point_balance`, no `balance` ni `points`.

**Estado final del diagnóstico:** la autonomía solicitada es viable como evolución del proyecto, pero sigue pendiente de implementación y validación integral. La siguiente entrega de desarrollo debería comenzar por proteger las rutinas agro, corregir el contrato de Poe y separar generación, aprobación y publicación programada.
