const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const service = require('../services/instagramSkillsService');
const routes = require('../routes/instagram');

test('all 13 skills and their reference files match the pinned upstream snapshot', async () => {
  const root = path.join(__dirname, '../vendor/instagram-agent-skill');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'source.json'), 'utf8'));
  assert.equal(service.list().length, 13);
  assert.equal(manifest.license, 'MIT');
  for (const file of manifest.files) {
    const bytes = await fs.readFile(path.join(root, file.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  for (const skill of service.list()) {
    assert.ok((await service.reference(skill.id)).length > 500, skill.id);
  }
  await assert.rejects(service.reference('../../.env'), /no permitida/);
});

test('writer gets format-specific guidance, resources and JSON contract overrides', async () => {
  const reel = await service.forAgent('content-writer', 'video');
  assert.match(reel, /REFERENCIA ig-reel/);
  assert.match(reel, /CATÁLOGO DE FÓRMULAS/);
  assert.match(reel, /Conserva EXACTAMENTE el esquema JSON/);
  assert.ok(reel.indexOf('CONTRATO DE INTEGRACIÓN') > reel.indexOf('REFERENCIA ig-caption'));
  const carousel = await service.forAgent('content-writer', 'carousel');
  assert.match(carousel, /REFERENCIA ig-carousel/);
  assert.doesNotMatch(carousel, /REFERENCIA ig-reel/);
  assert.match(await service.forAgent('social-media-planner'), /respeta\s+el mes/);
  assert.equal(await service.forAgent('visual-designer'), '');
});

test('caption checks preserve Unicode, handle empty text, excess length and missing facts', () => {
  const text = '🌱'.repeat(126);
  const review = service.reviewCaption(text);
  assert.equal(review.characters, 126);
  assert.equal(Array.from(review.preview).length, 125);
  assert.ok(service.reviewCaption('').warnings.length);
  const bad = service.reviewCaption('x'.repeat(2201) + ' {{dato}} #uno #dos #tres #cuatro #cinco #seis');
  assert.equal(bad.hashtags, 6);
  assert.equal(bad.warnings.length, 3);
  assert.equal(service.reviewCaption('Cultivo en Almería. #Almería #invernadero').warnings.length, 0);
});

test('draft passes brand context and explicitly distinguishes tools from editorial advice', async () => {
  let prompt;
  const draft = await service.draft({ skill: 'ig-audit', input: 'No tengo métricas.',
    productContext: 'Helpmeagro: agricultura en Almería.',
    generateText: async text => { prompt = text; return 'Faltan métricas.'; } });
  assert.equal(draft, 'Faltan métricas.');
  assert.match(prompt, /Helpmeagro: agricultura en Almería/);
  assert.match(prompt, /No inventes puntuaciones/);
  assert.match(prompt, /distingue lo observado de las hipótesis/);
});

// Dispatch through Express Router in memory: no sockets, models or cron jobs.
function dispatch(router, method, url, body) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); } };
    router.handle({ method, url, body, headers: {} }, res, error => reject(error || new Error('Route not found')));
  });
}

test('routes reject invalid inputs, contain provider errors and recover after failure', async () => {
  let calls = 0;
  const router = routes({ getProductContext: () => 'Helpmeagro',
    generateText: async () => { calls++; if (calls === 1) throw new Error('PRIVATE_PROVIDER_DETAIL'); return 'Borrador'; } });
  const send = (endpoint, body) => dispatch(router, 'POST', '/' + endpoint, body);
  assert.equal((await dispatch(router, 'GET', '/skills')).data.skills.length, 13);
  for (const body of [{}, { skill: '../.env', input: 'x' }, { skill: 'ig-reel', input: ' ' },
    { skill: 'ig-reel', input: 'x'.repeat(20001) }]) {
    assert.equal((await send('draft', body)).status, 400);
  }
  assert.equal(calls, 0);
  const failed = await send('draft', { skill: 'ig-reel', input: 'Una demo real.' });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(failed.data.error, /PRIVATE_PROVIDER_DETAIL/);
  const valid = await send('draft', { skill: 'ig-reel', input: 'Una demo real.' });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.draft, 'Borrador');
  assert.equal((await send('review-caption', { caption: 12 })).status, 400);
  assert.equal((await send('review-caption', { caption: 'Campo #Almería' })).data.hashtags, 1);
});

test('parallel draft requests do not duplicate paid work', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const router = routes({ getProductContext: () => '', generateText: () => {
    entered(); return new Promise(resolve => { release = resolve; });
  } });
  const pending = dispatch(router, 'POST', '/draft', { skill: 'ig-caption', input: 'Un texto' });
  await started;
  assert.equal((await dispatch(router, 'POST', '/draft', { skill: 'ig-caption', input: 'Otro texto' })).status, 409);
  release('Listo');
  assert.equal((await pending).data.draft, 'Listo');
});

test('the existing Agent still returns parsed JSON while applying the Instagram adapter', async () => {
  const names = ['../services/geminiService', '../services/openaiService', '../services/productContextService'];
  const ids = names.map(name => require.resolve(name));
  const originals = ids.map(id => require.cache[id]);
  let prompt = '';
  const response = { instagram: { copy: 'Un albarán, explicado paso a paso.', hashtags: '#Almería' } };
  const mocks = [{ generateText: async text => { prompt = text; return JSON.stringify(response); } }, {},
    { getAsPromptSection: () => 'Helpmeagro' }];
  ids.forEach((id, i) => { require.cache[id] = { id, filename: id, loaded: true, exports: mocks[i] }; });
  const agentId = require.resolve('../agents/Agent');
  try {
    delete require.cache[agentId];
    const Agent = require('../agents/Agent');
    const result = await new Agent('Escritor', 'content-writer')._executeInternal('Demo de albarán', { instagramFormat: 'video' });
    assert.deepEqual(result, response);
    assert.match(prompt, /REFERENCIA ig-reel/);
    assert.match(prompt, /CONTRATO DE INTEGRACIÓN/);
  } finally {
    delete require.cache[agentId];
    ids.forEach((id, i) => { if (originals[i]) require.cache[id] = originals[i]; else delete require.cache[id]; });
  }
});
