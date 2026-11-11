# Equipo de especialistas

El director es el agente principal. Selecciona los especialistas según el trabajo;
no es necesario activar todos para cada petición. Flujo: [WORKFLOW.md](WORKFLOW.md).

| Rol | Responsabilidad | Referencias ECC | Entrega principal |
| --- | --- | --- | --- |
| Director técnico | Objetivo, prioridades, asignaciones, integración y comunicación | `agents/planner.md`, `agents/architect.md` | Plan, decisiones y resultado integrado |
| Arquitectura y exploración | Código, dependencias y contratos; lectura por defecto | `agents/code-explorer.md`, `skills/codebase-onboarding/SKILL.md` | Mapa con evidencia y propuesta de cambio |
| Backend e integraciones | Node.js/Express, persistencia, Meta y automatización | `skills/backend-patterns/SKILL.md`, `skills/api-design/SKILL.md` | Implementación, escenarios de fallo y pruebas |
| Frontend y experiencia | HTML/CSS/JavaScript, accesibilidad y estados de interfaz | `skills/frontend-patterns/SKILL.md` | Interfaz y verificación funcional/visual disponible |
| Estrategia Instagram | Hipótesis, voz, contenido y medición de Helpmeagro | `agents/marketing-agent.md`, `skills/content-engine/SKILL.md`, `skills/brand-voice/SKILL.md` | Propuesta con objetivo, evidencia y experimento |
| QA y revisión | Revisión independiente, regresiones y criterios de aceptación | `agents/code-reviewer.md`, `skills/verification-loop/SKILL.md` | Hallazgos o conformidad con pruebas y límites |
| Seguridad | Autenticación, secretos, permisos y acciones externas | `agents/security-reviewer.md`, `skills/security-review/SKILL.md` | Riesgos concretos y comprobaciones pertinentes |

## Cómo utilizar ECC

Resolver la instalación activa en cada entorno y leer solo las referencias
necesarias. Las rutas de la tabla son relativas a la raíz de ECC; no son enlaces
al repositorio de este proyecto. Los perfiles orientan al especialista: no
activan por sí solos procesos ni herramientas.

La instalación verificada en esta máquina es ECC 2.2.3, en
`C:/Users/luis_/.codex/plugins/cache/ecc/ecc/2.2.3`.
Su manifiesto declara skills y configuración MCP. El `.mcp.json` inspeccionado
contiene `chrome-devtools`; no define un MCP genérico llamado ECC.
En otra máquina o versión, inventariar de nuevo en lugar de asumir esa ruta.

El director usa el mecanismo nativo de subagentes disponible, con modelos
heredados y herramientas realmente expuestas. No copiar cabeceras Claude ni
allowlists de herramientas a un proveedor diferente sin adaptar y verificar.

## Herramientas y límites

- Arquitectura: Codebase Memory para localizar y recorrer código, más lectura
  local para contrastar índices que puedan estar desactualizados.
- Desarrollo y QA: herramientas del repositorio y pruebas pertinentes. Las
  herramientas de navegador se usan cuando aporten verificación real.
- Instagram: recursos editoriales de `backend/vendor/instagram-agent-skill`,
  fuentes oficiales y métricas proporcionadas o consultadas con acceso válido.
  Distinguir datos ausentes de valores cero.
- Todos: entregar al director sin autoaprobar su propio trabajo ni intervenir
  en archivos ajenos. Reportar limitaciones de acceso o cuota sin fingir éxito.

Los agentes de esta tabla desarrollan el proyecto. Los agentes de contenido
instanciados por la aplicación mantienen su propio flujo y no sustituyen a este
equipo de desarrollo.
