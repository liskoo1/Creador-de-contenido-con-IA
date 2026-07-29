# Prompt Quality Double-Pass — Diseño

Sistema de **doble pasada** para prompts de imagen y vídeo: el planificador define intención de escena; un optimizador dedicado expande cada escena a un prompt cinematográfico/fotográfico de 120–180 palabras antes de llamar a Imagen o Veo.

## Decisiones de Diseño

- **Enfoque**: Doble paso (máxima calidad), no solo skills ni solo plantillas de código.
- **Alcance**: Imagen (single/carrusel) + vídeo/Reels (Veo) + character lock.
- **Idioma de prompts generativos**: inglés (salvo `spokenDialog`, que permanece en español castellano literal).
- **Diálogo**: el optimizador de vídeo **no reescribe** `spokenDialog`; solo lo inserta entre comillas.
- **Fallback**: si el optimizador falla o devuelve texto demasiado corto, el orquestador usa plantilla código enriquecida (`_buildVeoPrompt` / prompt imagen mínimo) y no bloquea el flujo.
- **Fuera de alcance**: ElevenLabs, revisor visual de imágenes, cambios de publicación IG/FB.

## Problema Actual

| Pieza | Estado | Efecto |
|-------|--------|--------|
| `video-orchestrator` | Pide `promptVisual` corto (~2 frases) | Veo recibe escenas pobres |
| `_buildVeoPrompt` | Concatena estilo genérico | Poco control de cámara/acción/audio |
| `photo-prompt-optimizer` | 8 capas (bueno) | No siempre se aplica a cada escena de carrusel/vídeo-imagen |
| Character lock | Texto + imagen ancla | El prompt enriquecido debe repetir lock sin contradecirlo |

## Flujo Objetivo

```
Briefing + estrategia + copy
        │
        ▼
┌───────────────────────────────────┐
│  Planificador (corto)             │
│  video-orchestrator / carrusel    │
│  → intención de escena            │
│  → spokenDialog literal           │
│  → characterProfile + directive   │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  Character lock (si hay persona)  │
│  1 imagen ancla Gemini Image      │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  PASADA 2 — Enrichment por escena │
│  • Imagen → photo-prompt-optimizer│
│  • Vídeo  → video-prompt-optimizer│
│  (paralelo en B-roll/imágenes;    │
│   secuencial en talking-head)     │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  Ensamblador orquestador          │
│  CHARACTER LOCK + directive +     │
│  negativos + aspect ratio         │
└──────────────┬────────────────────┘
               ▼
     Imagen (Gemini) / Veo 3.1
               ▼
     Remotion (si multi-escena) o MP4 directo
```

## Componentes

### 1. Nueva skill `video-prompt-optimizer`

**Ruta**: `.agents/skills/video-prompt-optimizer/SKILL.md`  
**Agente**: `videoPromptOptimizer` (tipo `text`) en `AgentOrchestrator`.

**Input**: JSON/texto con:
- `promptVisual` (intención corta del plan)
- `spokenDialog` (literal o null)
- `characterProfile`
- `visualDirective` (palette, style, lighting)
- `role`: `talking` | `broll`
- `aspectRatio` (normalmente `9:16`)
- duración fija: 8 segundos

**Output**: **solo** el prompt final en inglés (un párrafo, sin markdown), 120–180 palabras.

**Capas obligatorias (en orden narrativo dentro del párrafo)**:
1. Subject + CHARACTER LOCK (identidad fija)
2. Action / camera move viable en 8s
3. Environment (lugar concreto, p. ej. invernadero Almería)
4. Lighting + color palette (de la directiva global)
5. Framing vertical 9:16, lente/ángulo
6. Audio: diálogo entre comillas **exacto** O ambient soundscape
7. Anti-cliché agro/tech + anti-artefactos (sin texto en frame, anatomía, un solo hablante)

**Reglas duras**:
- No inventar ni parafrasear `spokenDialog`.
- Un solo hablante; español castellano explícito cuando hay diálogo.
- Prohibido: drones cliché, hologramas, agricultores con sombrero de paja, ropa harapienta.
- Si `role=talking`: looking at camera / speaking + lip-sync instruction.
- Si `role=broll`: movimiento de cámara + ambiente; sin diálogo inventado.

### 2. Endurecer `photo-prompt-optimizer` y `visual-designer`

- Mantener sistema de 8 capas.
- Exigir mínimo **120 palabras** (target 130–160).
- Añadir bloque obligatorio de **directiva visual global** cuando el input la traiga (no reescribir a otro estilo).
- Añadir bloque **subjectConsistency / CHARACTER LOCK** cuando exista perfil de personaje.
- Reforzar anti-cliché HelpMeAgro (invernaderos modernos, polos técnicos, tablets reales).

### 3. Actualizar `video-orchestrator` (planificador)

El planificador deja de escribir el prompt final de Veo. Produce **intención**:

- `promptVisual`: 1–3 frases de intención (sujeto + acción + lugar), no el prompt largo.
- `spokenDialog`: máx 14 palabras, castellano, o null.
- `characterProfile`, `visualDirective`, `mood`, titles, etc. (igual que ahora, más estricto en gancho).

Documentar en la skill: “La expansión cinematográfica la hace `video-prompt-optimizer`.”

### 4. Orquestador — métodos nuevos / cambios

**Archivo**: `backend/core/AgentOrchestrator.js`

| Método | Rol |
|--------|-----|
| `_enrichVideoScenePrompt(scene, characterProfile, visualDirective)` | Llama a `videoPromptOptimizer`; valida longitud ≥ 100 palabras; si falla → `_buildVeoPrompt` enriquecido |
| `_enrichImageScenePrompt(brief, refs, directive, characterProfile)` | Llama a `photoOptimizer` con contexto de lock + directive |
| `_buildVeoPrompt(...)` | Fallback estructurado por capas (no genérico de una línea) |
| Registro agente | `videoPromptOptimizer: new Agent(..., "video-prompt-optimizer", "text")` |

**Integración Remotion**:
1. Plan → validate → character lock
2. Para cada escena: enrich (talking secuencial; b-roll paralelo)
3. `editor.execute(enrichedPrompt, { referenceImagePath, ... })`
4. Props Remotion sin cambios de audio (ya implementados)

**Integración single/direct**:
1. Brief → photo-optimizer solo para intención visual si hace falta
2. `video-prompt-optimizer` con diálogo derivado del copy (máx 14 palabras)
3. Veo directo sin Remotion

**Integración carrusel / single image**:
- Cada slide pasa por `photo-prompt-optimizer` con directive + subjectConsistency antes de `designer`/`generateImage`.

### 5. Telemetría

Log por escena:
- `enriched=true|false` (optimizer vs fallback)
- `wordCount`
- `hasDialog`
- `usedReferenceImage`
- `hasAudio` (ffprobe, ya existente)

## Criterios de Éxito

1. Cada clip Veo se genera con prompt ≥ 120 palabras (optimizer o fallback).
2. `spokenDialog` aparece literal entre comillas en el prompt Veo.
3. Character lock textual + imagen de referencia en escenas con persona.
4. Imágenes de carrusel/single no usan el briefing crudo sin pasar por photo-optimizer.
5. Si el optimizer falla, el Reel/imagen sigue generándose con fallback de calidad media-alta.

## Archivos a tocar

- `.agents/skills/video-prompt-optimizer/SKILL.md` *(nuevo)*
- `.agents/skills/photo-prompt-optimizer/SKILL.md`
- `.agents/skills/visual-designer/SKILL.md`
- `.agents/skills/video-orchestrator/SKILL.md`
- `backend/core/AgentOrchestrator.js`
- (opcional) `backend/agents/Agent.js` solo si hace falta sanitizar salida de texto puro

## Orden de Implementación

1. Crear skill `video-prompt-optimizer` + registrar agente.
2. Reescribir `_buildVeoPrompt` como fallback por capas + `_enrichVideoScenePrompt`.
3. Cablear Remotion + single/direct al enrichment.
4. Endurecer photo-optimizer / visual-designer + asegurar carrusel/single.
5. Actualizar video-orchestrator (plan corto).
6. Verificar logs de telemetría en un Reel de prueba.
