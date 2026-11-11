# Integración de Instagram — 3 de noviembre de 2026

## Decisión previa a la implementación

Se conserva el flujo de publicación y aprobación existente. Las skills externas
son referencias editoriales, no ejecutores de herramientas ni permiso para publicar.
Se incorporan como dependencia versionada en `backend/vendor/instagram-agent-skill`
con licencia MIT, commit y hashes. No se sobrescriben las skills locales existentes.

Un adaptador carga las referencias adecuadas para el escritor (caption, human y
formato), revisor (caption y human) y planificador (plan). Conserva los contratos
JSON originales. El contexto de producto existente proporciona marca, audiencia y
voz; faltan muestras de voz real. La planificación mensual continúa siendo mensual.

Un asistente independiente ofrece las 13 tareas editoriales como borradores en
español. Usa el mismo proveedor de texto configurado en la app. No consulta Instagram,
no publica, no envía mensajes y no ejecuta los scripts Python incluidos. No debe afirmar
que ha ejecutado puntuaciones, leído URLs o comprobado métricas. Los scripts originales
se conservan para futura evaluación y adaptación lingüística.

Se elimina la búsqueda automática de hashtags supuestamente virales en cada workflow.
Se recomienda editorialmente un máximo de cinco etiquetas específicas, sin presentar
esa regla como garantía de alcance. Los datos de Google Search no son Instagram Insights.

## Límites deliberados

- Las guías externas contienen generalizaciones y ejemplos en inglés. El adaptador
  prioriza datos aportados, español natural, hechos comprobables y capacidades reales.
- El conteo de caracteres y etiquetas es una revisión determinista; no detecta IA,
  no predice viralidad y no comprueba la veracidad de las afirmaciones.
- No se alteran calendarios guardados, publicaciones ni credenciales.
- No hay sincronización de Insights todavía. El histórico local no representa toda
  la actividad actual de la cuenta.
- Antes de exponer el servidor fuera de un entorno de confianza, hay que añadir
  autenticación y límites de uso a toda la API existente, incluidas las nuevas rutas.

## Validación

Pruebas sin llamadas pagadas ni publicaciones: selección de referencias, conservación
de contratos, licencia e integridad de los archivos originales, validación de entrada,
conteo de caracteres Unicode y etiquetas, rutas HTTP con proveedor simulado.
La calidad creativa y el impacto sobre seguidores requieren evaluación con contenido
real y métricas comparables; no se deducen de estas pruebas técnicas.
