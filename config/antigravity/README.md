# Adaptador de Antigravity

El contrato del director está disponible desde `AGENTS.md`. La instalación y el
descubrimiento de `/director-proyecto` y sus seis perfiles persistentes siguen
pendientes en Antigravity.

El contrato compartido vive en `AGENTS.md` y `docs/workspace/WORKFLOW.md`, tomando
siempre las rutas desde la raíz del repositorio. `AGENTS.md` raíz es descubierto
por Antigravity como instrucciones del workspace.

## Empezar desde el chat

Abre la raíz del repositorio en Antigravity y escribe un encargo como este:

> Usa el flujo de dirección de AGENTS.md para esta tarea: [objetivo]. Delega en
> los especialistas disponibles, valida el resultado y actualiza el backlog.

La App y la CLI documentan subagentes. Si el cliente expone `invoke_subagent`,
el director puede asignar tareas a los perfiles descubiertos o a un subagente
integrado adecuado. Cuando también esté disponible `define_subagent`, puede
definir perfiles transitorios a partir de `config/antigravity/agents` y luego
invocarlos. Cada encargo debe incluir el contexto necesario porque el subagente
puede empezar sin el historial del director. Si falta la capacidad de delegar,
se ejecutan las fases en secuencia y se registra la revisión independiente
pendiente.

## Instalación del proyecto

Desde la raíz, usa PowerShell 7 para comprobar el paquete y, cuando el entorno
permita escribir en `.agents`, instalarlo:

```powershell
.\scripts\Install-Workspace.ps1 -Mode Check
.\scripts\Install-Workspace.ps1 -Mode Install
```

`Check` valida el paquete y muestra qué archivos están pendientes o en conflicto.
`Install` copia los siete archivos indicados a continuación. Si hay un destino
con contenido distinto, el instalador detiene la copia antes de escribir.

| Origen desde la raíz | Destino desde la raíz |
| --- | --- |
| `config/antigravity/skills/director-proyecto/SKILL.md` | `.agents/skills/director-proyecto/SKILL.md` |
| `config/antigravity/agents/*.md` | `.agents/agents/` conservando sus nombres |

Recarga el workspace y comprueba el descubrimiento antes de declarar la activación:

1. En `/agents`, verifica los seis perfiles especializados.
2. Comprueba que la skill `director-proyecto` se descubre y que puede invocarse con
   `/director-proyecto` en la superficie compatible.
3. Inspecciona las conexiones MCP del cliente y verifica una llamada de lectura a
   Codebase Memory si está configurado. No copies tokens ni configuraciones privadas.
4. Ejecuta una tarea de lectura breve: director, arquitecto y revisión independiente.
   Confirma que las entregas son de sesiones reales de especialistas.

En la sesión de preparación, el intento de instalación se detuvo porque `.agents`
está protegido. La activación persistente requiere ejecutar `Install` en un entorno
con acceso de escritura al proyecto y comprobar el descubrimiento en el cliente.
Registra el resultado real en `docs/workspace/DECISIONS.md`.

## ECC y capacidades

Los perfiles son instrucciones propias y referencian componentes ECC por nombre.
Resuelve la instalación disponible en cada equipo mediante el mecanismo nativo del
cliente. No se incluyen copias de agentes, skills ni hooks de ECC.

ECC 2.2.3 se verificó como plugin en el entorno de preparación. Su configuración MCP
incluye `chrome-devtools`; no define un servidor genérico llamado ECC. No añadas un
endpoint ficticio para cumplir ese nombre. Las conexiones MCP deben usar ejecutables
o endpoints reales y comprobarse con las herramientas expuestas por el cliente.

Los perfiles heredan el modelo. Las restricciones de lectura de los revisores son
instrucciones; no se presenta una allowlist de herramientas como control técnico
sin verificar sus nombres y disponibilidad en el cliente.

## Compatibilidad comprobada el 4 de noviembre de 2026

- Antigravity documenta `AGENTS.md` en la raíz y reglas modulares en `.agents/rules`.
- Los perfiles personalizados de subagentes están documentados para **App y CLI**.
  No se asume la misma capacidad en un IDE antiguo.
- Los workflows legacy dejaron de ser la vía recomendada tras el cambio anunciado
  para el 19 de octubre de 2026. El flujo se distribuye como una skill.
- Si no hay subagentes nativos disponibles, el director declara la limitación y
  sigue el procedimiento secuencialmente, sin afirmar revisión independiente real.

Fuentes oficiales:

- https://antigravity.google/docs/rules
- https://antigravity.google/docs/subagents
- https://antigravity.google/docs/migration/workflows-to-skills
- https://antigravity.google/docs/customization-discovery
- https://antigravity.google/docs/mcp
