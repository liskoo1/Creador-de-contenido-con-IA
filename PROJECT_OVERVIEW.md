# Proyecto: Creador de Contenido con IA (IA Content Hub)

## Objetivo del Proyecto
El **IA Content Hub** es un ecosistema inteligente diseñado para automatizar la creación, gestión y publicación de contenido de marketing en redes sociales (Instagram, Facebook). Utiliza un "enjambre" de agentes de IA para transformar briefings básicos en piezas de contenido profesional (imágenes, vídeos, carruseles, reels) con coherencia visual y estratégica.

## Funcionalidades Principales

### 1. Hub de Conocimiento (Knowledge Hub)
- **Gestión de Activos:** Permite subir imágenes y archivos que sirven como contexto para la marca.
- **Visión por IA:** Analiza automáticamente las imágenes subidas para generar descripciones técnicas y metadatos.
- **Investigación Web:** Capacidad de guardar y analizar URLs para extraer tendencias e información relevante para el contenido.

### 2. Generación de Contenido Multi-Formato
- **Single Posts:** Imágenes únicas optimizadas con copys persuasivos.
- **Vídeos Cinematográficos:** Generación de clips de 8 segundos usando Google Veo.
- **Carruseles Inteligentes:** Secuencias de imágenes o vídeos con narrativa lógica.
- **Audio Reels:** Creación de vídeos a partir de archivos de audio, generando visuales que acompañan la pista.
- **Flyers/Carteles:** Composiciones estáticas orientadas a promociones.

### 3. Integración Agro (FullAgro)
- **Precios del Día:** Conexión a base de datos MySQL para extraer precios medios de hortalizas y generar automáticamente historias de Instagram.
- **Noticias del Sector:** Extracción y selección de noticias relevantes para crear posts informativos de forma automática.

### 4. Automatización y Auto-Pilot
- **Planificación Mensual:** El bot puede planificar un calendario completo de contenidos basado en la marca.
- **Sistema de Aprobación por Email:** Envío de propuestas de contenido al administrador por correo electrónico para su aprobación o rechazo mediante un solo clic.
- **Publicación Directa:** Integración con la API de Instagram Business para publicar automáticamente el contenido aprobado.

### 5. Motor de Vídeo (Remotion)
- **Composición Programática:** Uso de React (Remotion) para montar vídeos complejos, aplicar efectos de movimiento (Ken Burns), subtítulos y voz en off.

## Arquitectura Técnica
- **Backend:** Node.js + Express.
- **Frontend:** React (Vite) para la interfaz de administración.
- **IA:** Google Gemini (1.5 Pro/Flash), OpenAI (GPT/DALL-E), Google Veo.
- **Base de Datos:** MySQL (Datos externos) y JSON/NoSQL local (Estado del bot y posts).
- **Video:** Remotion.
