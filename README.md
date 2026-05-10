# IA Content Hub - Creador de Contenido con IA

Este proyecto es una plataforma avanzada para la generación automatizada de contenido de marketing (imágenes, vídeos, reels) utilizando un enjambre de agentes de IA (Google Gemini, OpenAI) y el motor de vídeo Remotion.

## 🚀 Requisitos Previos

- **Node.js** (v18 o superior)
- **Git**
- **MySQL** (Si se desea usar la integración con FullAgro)
- **FFmpeg** (Instalado en el sistema para el procesamiento de vídeo)
- **API Keys:**
  - Google Gemini API (AI Studio)
  - OpenAI API
  - Meta (Instagram Graph API)

## 🛠️ Instalación Paso a Paso

1. **Clonar el repositorio:**
   ```bash
   git clone <url-del-repo>
   cd "Creador de contenido con IA"
   ```

2. **Configurar el Backend:**
   ```bash
   cd backend
   npm install
   ```

3. **Configurar variables de entorno:**
   - Copia el archivo `.env-example` a `.env`:
     ```bash
     cp .env-example .env
     ```
   - Edita el archivo `.env` y añade tus credenciales (API Keys, DB, SMTP).

4. **Configurar el Motor de Vídeo:**
   ```bash
   cd ../video-engine
   npm install
   ```

## 🏃 Ejecución

1. **Iniciar el servidor Backend:**
   ```bash
   cd backend
   npm start
   ```
   El servidor correrá por defecto en `http://localhost:3001`.

2. **Acceder a la interfaz:**
   Abre tu navegador en `http://localhost:3001`.

## 📂 Estructura del Proyecto

- `/backend`: Servidor Express, lógica de agentes de IA y servicios de automatización.
- `/frontend`: Interfaz de usuario (HTML/JS/CSS estático).
- `/video-engine`: Composiciones de Remotion para la creación de vídeos.
- `PROJECT_OVERVIEW.md`: Documentación detallada de objetivos y funcionalidades.

## 🛡️ Seguridad

- El archivo `.env` está en el `.gitignore` para evitar subir credenciales privadas.
- No compartas nunca tus API Keys ni las subas a repositorios públicos.

## 📄 Licencia
[Añadir licencia si corresponde]
