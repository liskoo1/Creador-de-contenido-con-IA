const fs = require('fs').promises;
const path = require('path');

/**
 * Utilidad para cargar y parsear habilidades (skills) desde la carpeta .agents/skills.
 */
class SkillLoader {
  constructor() {
    this.skillsPath = path.join(__dirname, '../../.agents/skills');
  }

  /**
   * Lee un archivo SKILL.md y extrae sus instrucciones.
   * @param {string} skillName - Nombre de la carpeta de la habilidad.
   * @returns {Promise<string>} - Las instrucciones de la habilidad.
   */
  async loadSkill(skillName) {
    try {
      const filePath = path.join(this.skillsPath, skillName, 'SKILL.md');
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Extraemos el cuerpo del markdown saltando el frontmatter de YAML si existe
      const body = content.replace(/^---[\s\S]*?---/, '').trim();
      return body;
    } catch (error) {
      console.error(`Error cargando la skill ${skillName}:`, error);
      throw new Error(`No se pudo cargar la habilidad: ${skillName}`);
    }
  }

  /**
   * Lista todas las habilidades disponibles.
   * @returns {Promise<string[]>}
   */
  async listSkills() {
    try {
      const dirs = await fs.readdir(this.skillsPath, { withFileTypes: true });
      return dirs.filter(d => d.isDirectory()).map(d => d.name);
    } catch (error) {
      console.error("Error listando skills:", error);
      return [];
    }
  }
}

module.exports = new SkillLoader();
