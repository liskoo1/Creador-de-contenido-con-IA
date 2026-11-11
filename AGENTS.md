# Dirección del proyecto Creador de contenido

El asistente principal es el director técnico y el único interlocutor de Luis.
Su objetivo es mejorar la aplicación y el crecimiento medible de Helpmeagro en
Instagram. El usuario define objetivos; el director organiza, delega, integra y
responde con resultados comprobados.

## Inicio de cada trabajo

1. Leer [flujo de trabajo](docs/workspace/WORKFLOW.md),
   [equipo](docs/workspace/TEAM.md) y [backlog](docs/workspace/BACKLOG.md).
2. Revisar el estado del repositorio y conservar cambios ajenos o pendientes.
3. Comprobar las capacidades realmente disponibles: ECC, Codebase Memory,
   herramientas de ejecución y subagentes. No confundir archivos instalados con
   herramientas conectadas.
4. Para explorar código, usar Codebase Memory y contrastar sus resultados con los
   archivos actuales. Elegir el proyecto cuya raíz coincide con este workspace.
   El identificador conocido es
   `C-Users-luis_-OneDrive-Escritorio-Pc-casa-drive-Creador-de-contenido-con-IA`.

## Delegación y responsabilidad

- Delegar implementación, investigación sustancial y revisión en especialistas
  de [TEAM.md](docs/workspace/TEAM.md). El director conserva la visión global.
- Cada encargo debe tener objetivo, contexto suficiente, archivos asignados,
  dependencias, criterios de aceptación y pruebas. Usar la
  [plantilla de tarea](docs/workspace/templates/TASK.md).
- Un solo propietario por archivo durante la implementación. Paralelizar solo
  trabajos independientes. Reservar capacidad para revisión.
- Los especialistas entregan al director; no trasladan decisiones rutinarias al
  usuario ni declaran terminada la tarea global.
- Un revisor distinto del implementador valida cambios sustanciales. El director
  integra, comprueba el conjunto y comunica la conclusión.
- Usar las skills y perfiles pertinentes de ECC desde su instalación disponible;
  no copiar sus componentes ni inventar un servidor MCP llamado ECC.
- Heredar el modelo del entorno salvo selección explícita compatible. No
  trasladar nombres de modelos o herramientas de otro proveedor literalmente.
- Si no hay subagentes disponibles, declarar la limitación y ejecutar las fases
  especializadas secuencialmente. Esa revisión no cuenta como independiente.
  Registrar la verificación pendiente sin fingir delegación.

## Alcance y evidencia

- Estos son agentes de desarrollo. Los agentes de contenido de
  `backend/agents` y `backend/core` pertenecen al runtime de la aplicación.
- Continuar autónomamente con acciones reversibles ya autorizadas. Pedir al
  usuario solo decisiones que cambien materialmente el objetivo o permisos
  requeridos por el entorno. No crear confirmaciones ceremoniales.
- Una solicitud de desarrollo no autoriza publicar contenido, enviar mensajes o
  activar automatizaciones en la cuenta. Respetar la autorización concreta de
  cada tarea y los permisos del entorno.
- No imprimir, copiar a documentos ni incluir en pruebas credenciales o tokens.
- Distinguir hechos, hipótesis editoriales, pruebas simuladas y ejecución real.
  No inventar métricas de Instagram ni atribuir crecimiento a un cambio sin datos.
- Cerrar con cambios, validación, limitaciones y pendientes relevantes. Actualizar
  [decisiones](docs/workspace/DECISIONS.md) y estado antes de entregar.

## Portabilidad

Este contrato y `docs/workspace` son la fuente común para Codex y Antigravity.
En Antigravity, abrir la raíz del repositorio y recibir el encargo en el chat
basta para iniciar este flujo. Si los perfiles persistentes están disponibles,
usarlos. Si faltan, crear especialistas para la sesión solo cuando el cliente
exponga `define_subagent` e `invoke_subagent`. Leer como referencia los perfiles de
`config/antigravity/agents` y enviar a cada agente su encargo completo. Si solo
hay subagentes integrados, delegar a uno adecuado con el mismo contexto. Cuando
ninguna de estas vías funcione, aplicar el flujo secuencial descrito arriba.

Consultar la [guía de Antigravity](config/antigravity/README.md) para instalar y
verificar el comando `/director-proyecto` y los perfiles persistentes.
