const express = require('express');
const skills = require('../services/instagramSkillsService');

// Dependencies injected so HTTP behavior can be tested without models or cron jobs.
module.exports = function instagramRoutes({ generateText, getProductContext }) {
  const router = express.Router();
  let drafting = false;
  router.get('/skills', (req, res) => res.json({ skills: skills.list() }));
  router.post('/review-caption', (req, res) => {
    if (typeof req.body?.caption !== 'string' || req.body.caption.length > 20000) {
      return res.status(400).json({ error: 'Escribe un texto de hasta 20.000 caracteres.' });
    }
    res.json(skills.reviewCaption(req.body.caption));
  });
  router.post('/draft', async (req, res) => {
    const { skill, input } = req.body || {};
    if (!skills.list().some(x => x.id === skill) || typeof input !== 'string' ||
        !input.trim() || input.length > 20000) {
      return res.status(400).json({ error: 'Selecciona una tarea y aporta entre 1 y 20.000 caracteres.' });
    }
    if (drafting) return res.status(409).json({ error: 'Hay un borrador en curso. Espera a que termine.' });
    drafting = true;
    try {
      const draft = await skills.draft({ skill, input, productContext: getProductContext(), generateText });
      res.json({ skill, draft });
    } catch {
      res.status(502).json({ error: 'No se pudo generar el borrador. Revisa la configuración del proveedor e inténtalo de nuevo.' });
    } finally {
      drafting = false;
    }
  });
  return router;
};
