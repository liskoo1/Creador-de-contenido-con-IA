# Flujo de dirección y ejecución

Contrato común: [AGENTS.md](../../AGENTS.md). Roles: [TEAM.md](TEAM.md).

## 1. Encuadrar

El director convierte la petición en un resultado observable y criterios de
aceptación. Revisa [BACKLOG.md](BACKLOG.md), cambios locales y capacidades del
entorno. Aclara solo lo que afecte al alcance; avanza con lo ya autorizado.

## 2. Explorar y planificar

El especialista de arquitectura consulta Codebase Memory y archivos actuales.
Devuelve puntos de entrada, dependencias, riesgos y evidencia. El director divide
la tarea en unidades verificables y registra un encargo por unidad con la
[plantilla](templates/TASK.md).

Cada unidad tiene un responsable y archivos asignados. No lanzar en paralelo
un productor y un consumidor de un contrato aún no definido. Preferir hasta tres
implementadores simultáneos, dentro de la capacidad real del entorno, y reservar
un agente para revisar. Las decisiones compartidas las resuelve el director.

Aplicar los criterios de ECC `agentic-engineering`: unidades pequeñas con un
riesgo dominante, criterio de cierre propio y comparación con el comportamiento
inicial. Registrar duración, reintentos y consumo solo cuando el entorno aporte
esas medidas; no estimarlos como si fueran observaciones.

## 3. Implementar por especialidad

Cada especialista lee la skill ECC pertinente, verifica sus herramientas y actúa
solo en su alcance. Antes de editar archivos de otro responsable, comunica la
dependencia al director. Las modificaciones ajenas se conservan.

Para defectos de comportamiento, comprobar el escenario de fallo y añadir una
prueba de regresión cuando sea útil. Para documentación o cambios triviales,
validar referencias y contenido sin crear pruebas que repitan la implementación.
No usar pruebas reales que publiquen o envíen mensajes sin autorización aplicable.

## 4. Entregar y revisar

El especialista devuelve archivos cambiados, comportamiento resultante, pruebas
con su resultado y bloqueos. Un revisor distinto inspecciona el diff y los casos
de aceptación. Seguridad y fallos de publicación requieren el especialista
correspondiente. Un hallazgo debe incluir escenario, evidencia y consecuencia;
no se exige inventar observaciones para justificar la revisión.

El implementador corrige los hallazgos y el revisor comprueba las correcciones.
Si varias rondas no resuelven el problema, el director replantea el enfoque;
solo escala al usuario si falta una decisión, dato o autorización indispensable.

## 5. Integrar y cerrar

El director integra cambios y ejecuta las comprobaciones relevantes del conjunto.
No repetir pruebas ya suficientes sin cambios o dudas nuevas. Antes de cerrar:

- Criterios de aceptación comprobados y revisión independiente resuelta.
- Resultados reales separados de simulaciones, supuestos y pruebas bloqueadas.
- Documentación, decisiones y estado actualizados.
- Ninguna acción externa presentada como realizada sin confirmación de su resultado.

Un trabajo con verificaciones obligatorias bloqueadas conserva estado `blocked`
o `review`; no se convierte en `done` por tener archivos escritos.

## Estados y continuidad

`todo` → `ready` → `in_progress` → `review` → `done`.
`blocked` puede interrumpir cualquier fase e incluye causa y condición de salida.

Al retomar: leer la tarea, evidencias, decisiones y cambios locales. Continuar
desde el último resultado confirmado. Ante un timeout de una operación externa,
consultar su estado antes de repetirla para evitar duplicados.

## Entornos sin subagentes

Si la herramienta de delegación falta o devuelve un bloqueo, dejar constancia.
El director puede ejecutar las fases secuencialmente para avanzar, identificando
qué revisión no fue independiente. No generar nombres de agentes o resultados
ficticios. Si la falta de independencia impide cumplir un criterio de cierre,
mantener esa verificación pendiente.
