# Tarea: IG-001 — Primera integración editorial de las 13 skills de Instagram

- Estado: done
- Objetivo observable: Auditar y validar de forma independiente la integración de las 13 skills editoriales de Instagram (`backend/vendor/instagram-agent-skill`), el adaptador `backend/services/instagramSkillsService.js`, el enrutador `backend/routes/instagram.js` y el panel de asistente editorial `frontend/instagram.html`.
- Responsable / especialidad: backend + frontend + estrategia Instagram
- Revisores independientes: qa-reviewer (`project_qa_reviewer`) y estratega Instagram (`project_instagram_strategist`)
- Contexto y evidencia (rutas, símbolos, resultados):
  - `docs/instagram-integration.md`
  - `backend/vendor/instagram-agent-skill/` (13 skills y referencias con licencia MIT y hashes en `source.json`)
  - `backend/services/instagramSkillsService.js` (política `POLICY` anti-alucinaciones, selector de contexto por rol y revisor determinista de captions)
  - `backend/routes/instagram.js` (endpoints `/skills`, `/review-caption`, `/draft` con control de concurrencia y límites)
  - `frontend/instagram.html`, `frontend/js/instagram.js`, `frontend/css/instagram.css` (asistente estático desacoplado)
  - `backend/tests/instagram.test.js` (7 pruebas unitarias deterministas)
- Archivos asignados en exclusiva: Ninguno (fase de auditoría y validación).
- Dependencias y responsables relacionados: Director técnico (orquestación e integración).
- Riesgo dominante y comportamiento inicial observado: Alucinación de métricas de Instagram Insights, generalizaciones no aplicables a Helpmeagro, ruptura de contratos JSON en agentes existentes o ejecución encubierta de scripts externos.
- Fuera de alcance: Publicación real en cuentas de Instagram, compra de saldo o consumo de tokens externos en producción.
- Skills ECC y herramientas verificadas: `content-engine`, `brand-voice`, `verification-loop`, `code-reviewer`.
- Criterios de aceptación:
  1. Integridad de los archivos vendor: los 13 módulos de skills y sus referencias se conservan limpios con licencia MIT y hashes SHA-256. [CUMPLIDO]
  2. Adaptación estricta a Helpmeagro: el adaptador neutraliza afirmaciones falsas sobre el algoritmo, prohíbe inventar métricas y preserva la voz técnica agro. [CUMPLIDO]
  3. Preservación de contratos JSON: los agentes de runtime (`Agent.js`) siguen retornando JSON parseable sin romperse al inyectar las directivas de Instagram. [CUMPLIDO]
  4. Interfaz desacoplada: el asistente editorial en `frontend/instagram.html` opera sin colisionar con el panel principal y sin requerir bundlers. [CUMPLIDO]
  5. Suite de pruebas pasando al 100%: los 7 tests de `instagram.test.js` verifican rutas, límites, concurrencia y contratos. [CUMPLIDO]
- Pruebas o comprobaciones pertinentes: `node --test tests/instagram.test.js tests/publishing.test.js` (19 tests aprobados).
- Autorización aplicable a acciones externas, si las hubiera: Solo lectura y pruebas simuladas locales.

## Entrega y Auditoría

- **Revisión Estratégica y Voz de Marca (`project_instagram_strategist`):**
  - Veredicto: **CONFORME / APROBADO CON OBSERVACIONES ESTRATÉGICAS**.
  - Evidencia: La directiva `POLICY` neutraliza el tono de marketing genérico anglosajón y ancla la generación estrictamente a la realidad de Helpmeagro (cuadernos de campo, parcelas SIGPAC, fitosanitarios, pizarra de precios diarios y cooperativas de Almería).
  - Valida el revisor determinista de captions (conteo Unicode de emojis, límite duro de 2.200 caracteres, regla de máximo 5 hashtags y alerta de enlaces no clicables).
- **Revisión Técnica y de Regresiones (`project_qa_reviewer`):**
  - Veredicto: **CONFORME / APROBADO (5/5 Criterios Cumplidos)**.
  - Evidencia: Inyección segura en `Agent.js` que no degrada los contratos JSON principales (`_safeParseJSON`), cerrojo en memoria `let drafting = false;` con código 409, validación de entrada de hasta 20.000 caracteres, código 502 que enmascara errores internos del LLM, y desacoplamiento limpio del frontend estático.
  - 7/7 tests de Instagram pasando sin efectos colaterales.

## Integración y Cierre

- Tarea verificada por el Director Técnico con suite global de 19 tests en verde.
- Se registra la decisión `D-011` en `docs/workspace/DECISIONS.md`.
- Se actualiza el estado de `IG-001` a `done` en `docs/workspace/BACKLOG.md`.
- Estado final: `done`.
