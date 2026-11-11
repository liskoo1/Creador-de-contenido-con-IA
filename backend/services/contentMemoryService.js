const postService = require('./postService');
const experimentService = require('./experimentService');
const geminiService = require('./geminiService');

class ContentMemoryService {
  constructor(customPostService = postService, customExpService = experimentService) {
    this.postService = customPostService;
    this.experimentService = customExpService;
  }

  /**
   * Obtiene el historial reciente de contenidos generados y publicados
   * para evitar repeticiones y aprender del rendimiento pasado.
   *
   * @param {number} limit - Número máximo de publicaciones a recordar
   * @returns {object} Memoria estructurada
   */
  getRecentMemory(limit = 25) {
    const allPosts = this.postService.getAll();
    const sorted = [...allPosts].sort((a, b) => (b.timestamp || b.id || 0) - (a.timestamp || a.id || 0));
    const recent = sorted.slice(0, limit);

    // Temas y conceptos recientes
    const coveredTopics = recent.map(p => {
      const topic = p.briefing || p.concept || p.content?.instagram?.copy?.substring(0, 100) || 'Contenido general';
      const angle = p.angle || p.hypothesis?.angle || 'general';
      const format = this.experimentService.resolvePostFormat(p);
      const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('es-ES') : 'reciente';
      return { id: p.id, topic, angle, format, date };
    });

    // Análisis de experimentos
    const analysis = this.experimentService.analyzeExperiments(allPosts);

    return {
      totalHistoricalPosts: allPosts.length,
      recentCoveredTopics: coveredTopics,
      topPerformer: analysis?.summary?.topPerformer || null,
      byFormat: analysis?.byFormat || {},
      summary: analysis?.summary || {}
    };
  }

  /**
   * Genera el bloque de contexto de memoria histórica para inyectar en el prompt del planificador.
   * @returns {string} Texto formateado para el agente
   */
  formatMemoryForPlanner() {
    const memory = this.getRecentMemory(20);
    let out = '\n=== MEMORIA DE CONTENIDO AYER Y HOY (ANTI-REPETICIÓN Y RENDIMIENTO) ===\n';

    if (memory.recentCoveredTopics.length > 0) {
      out += 'TEMAS Y ÁNGULOS RECIENTES TRATADOS (PROHIBIDO REPETIR O CLONAR ESTOS ENFOQUES):\n';
      memory.recentCoveredTopics.slice(0, 12).forEach((t, i) => {
        const cleanTopic = String(t.topic).replace(/\n/g, ' ').substring(0, 120);
        out += `${i + 1}. [Formato: ${t.format} | Ángulo: ${t.angle}] ${cleanTopic}\n`;
      });
    } else {
      out += 'No hay contenidos previos registrados en la memoria local.\n';
    }

    if (memory.topPerformer) {
      out += `\nPUBLICACIÓN CON MEJOR RENDIMIENTO HISTÓRICO:
- Formato: ${memory.topPerformer.format}
- Save-to-Reach Ratio (SRR): ${memory.topPerformer.srr}%
- Ángulo: ${memory.topPerformer.hypothesis?.angle || 'N/A'}
- Lección: Los usuarios valoran este formato y ángulo; crea variaciones o temas complementarios sin repetir el mismo problema.\n`;
    }

    out += `\nDIRECTRICES DE INNOVACIÓN EDITORIAL:
1. Explora nuevos dolores del agricultor (gestión de cuadrillas, cuaderno de campo digital, fertirriego eficiente, inspecciones, control de costes en campaña).
2. Diversifica formatos: alterna carruseles de utilidad técnica con reels cortos de pantalla o reflexiones del sector.
=========================================================================\n`;

    return out;
  }

  /**
   * Investiga en internet con Grounding (Google Search) las tendencias y contenidos virales
   * del sector agrícola, agrotech y hortícola de España y Almería.
   *
   * @returns {Promise<string>} Resumen de tendencias extraídas en tiempo real
   */
  async searchMarketTrends() {
    try {
      console.log('\x1b[36m[ContentMemory] 🌐 Investigando tendencias y virales del sector agro en internet (Grounding)...\x1b[0m');
      const searchPrompt = `
Actúa como analista de tendencias e inteligencia de mercado para Helpmeagro en Instagram.
Investiga en la web en tiempo real:
1. ¿Cuáles son las noticias, debates, quejas o preocupaciones más candentes de los agricultores de invernadero en Almería y el campo español esta semana?
2. ¿Qué temas están funcionando mejor en redes sociales sobre Agrotech, gestión de explotaciones y digitalización agrícola?
3. ¿Qué virales, novedades de precios, plagas o normativas (cuaderno digital, inspecciones, costes de insumos) están comentando los horticultores?

Devuelve un resumen muy concreto de 4-5 puntos clave con hechos verificables y ángulos editoriales recomendados para publicaciones de alto impacto en Instagram.
`;

      const groundingResult = await geminiService.generateTextWithGrounding(
        searchPrompt,
        process.env.GEMINI_TEXT_GROUNDING_MODEL || 'gemini-3.8-flash'
      );

      return groundingResult || 'No se obtuvieron tendencias externas; recurriendo al contexto de marca Helpmeagro.';
    } catch (error) {
      console.warn('[ContentMemory] Error en la búsqueda de tendencias con Grounding:', error.message);
      return 'Búsqueda web temporalmente no disponible; aplicando mejores prácticas de Instagram y contexto de marca.';
    }
  }
}

module.exports = new ContentMemoryService();
