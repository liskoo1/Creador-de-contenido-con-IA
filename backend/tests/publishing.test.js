const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Cargar servidor y servicios
const { app, applyPublishResult, activePublishLocks } = require('../server');
const publishingService = require('../services/publishingService');
const { PublishingService } = publishingService;
const postService = require('../services/postService');
const botStateService = require('../services/botStateService');

describe('PUB-001 & DATA-001: Suite de Publicación Multiplataforma', () => {

  describe('1. Contrato estructurado de publishingService.publishViaBridge', () => {
    test('a) Fallo total: ambas redes devuelven error -> success=false, allOk=false, partial=false', async () => {
      const mockIg = {
        publishImage: async () => ({ success: false, error: 'IG token expired' })
      };
      const mockFb = {
        isConfigured: () => true,
        publishImage: async () => ({ success: false, error: 'FB permissions missing' })
      };

      const service = new PublishingService({
        instagramPublisher: mockIg,
        facebookPublisher: mockFb
      });

      // Configurar entorno simulado
      process.env.INSTAGRAM_ACCESS_TOKEN = 'test_token';
      process.env.INSTAGRAM_ACCOUNT_ID = 'test_account';

      const result = await service.publishViaBridge('https://cdn.example.com/foto.jpg', 'image', 'Caption prueba');

      assert.equal(result.success, false, 'success debe ser false en fallo total');
      assert.equal(result.allOk, false, 'allOk debe ser false en fallo total');
      assert.equal(result.partial, false, 'partial debe ser false en fallo total');
      assert.equal(result.instagram.success, false);
      assert.equal(result.instagram.postId, null);
      assert.match(result.instagram.error, /IG token expired/);
      assert.equal(result.facebook.success, false);
      assert.equal(result.facebook.postId, null);
      assert.match(result.facebook.error, /FB permissions missing/);
      assert.ok(result.error, 'debe contener mensaje de error global');
    });

    test('b) Éxito parcial: Instagram OK y Facebook falla -> partial=true, allOk=false, conserva postId de IG', async () => {
      const mockIg = {
        publishImage: async () => ({ success: true, postId: 'meta_ig_999888' })
      };
      const mockFb = {
        isConfigured: () => true,
        publishImage: async () => ({ success: false, error: 'FB graph timeout' })
      };

      const service = new PublishingService({
        instagramPublisher: mockIg,
        facebookPublisher: mockFb
      });

      process.env.INSTAGRAM_ACCESS_TOKEN = 'test_token';
      process.env.INSTAGRAM_ACCOUNT_ID = 'test_account';

      const result = await service.publishViaBridge('https://cdn.example.com/foto.jpg', 'image', 'Caption prueba');

      assert.equal(result.success, true, 'success debe ser true si al menos una tuvo éxito');
      assert.equal(result.allOk, false, 'allOk debe ser false');
      assert.equal(result.partial, true, 'partial debe ser true');
      assert.equal(result.instagram.success, true);
      assert.equal(result.instagram.postId, 'meta_ig_999888');
      assert.equal(result.instagram.error, null);
      assert.equal(result.facebook.success, false);
      assert.equal(result.facebook.postId, null);
      assert.match(result.facebook.error, /FB graph timeout/);
    });

    test('c) Éxito total: ambas plataformas publican -> success=true, allOk=true, partial=false con ambos postIds', async () => {
      const mockIg = {
        publishImage: async () => ({ success: true, postId: 'meta_ig_111' })
      };
      const mockFb = {
        isConfigured: () => true,
        publishImage: async () => ({ success: true, postId: 'meta_fb_222' })
      };

      const service = new PublishingService({
        instagramPublisher: mockIg,
        facebookPublisher: mockFb
      });

      process.env.INSTAGRAM_ACCESS_TOKEN = 'test_token';
      process.env.INSTAGRAM_ACCOUNT_ID = 'test_account';

      const result = await service.publishViaBridge('https://cdn.example.com/foto.jpg', 'image', 'Caption prueba');

      assert.equal(result.success, true);
      assert.equal(result.allOk, true);
      assert.equal(result.partial, false);
      assert.equal(result.instagram.postId, 'meta_ig_111');
      assert.equal(result.facebook.postId, 'meta_fb_222');
      assert.equal(result.error, undefined);
    });

    test('d) Reintento selectivo: solo Facebook solicitada y exitosa -> skipped en IG, allOk=true para las solicitadas', async () => {
      const mockIg = {
        publishImage: async () => { throw new Error('No debe invocarse IG'); }
      };
      const mockFb = {
        isConfigured: () => true,
        publishImage: async () => ({ success: true, postId: 'meta_fb_retry_333' })
      };

      const service = new PublishingService({
        instagramPublisher: mockIg,
        facebookPublisher: mockFb
      });

      const result = await service.publishViaBridge(
        'https://cdn.example.com/foto.jpg',
        'image',
        'Caption prueba',
        null,
        { platforms: ['facebook'] }
      );

      assert.equal(result.success, true);
      assert.equal(result.allOk, true);
      assert.equal(result.partial, false);
      assert.equal(result.instagram.skipped, true);
      assert.equal(result.facebook.success, true);
      assert.equal(result.facebook.postId, 'meta_fb_retry_333');
    });
  });

  describe('2. Función unificada applyPublishResult', () => {
    test('Fallo total: no muta publishedTo, ni publishedPlatformIds, ni publishedAt', () => {
      const initialPost = {
        id: 'post_test_1',
        content: { text: 'Hola' },
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {}
      };

      const failResult = {
        success: false,
        allOk: false,
        partial: false,
        instagram: { success: false, postId: null, error: 'Err IG' },
        facebook: { success: false, postId: null, error: 'Err FB' }
      };

      const applied = applyPublishResult(initialPost, failResult);

      assert.equal(applied.success, false);
      assert.equal(applied.allCompleted, false);
      assert.equal(applied.updatedPost.publishedAt, null);
      assert.deepEqual(applied.nextPublishedTo, {});
      assert.deepEqual(applied.nextPublishedPlatformIds, {});
    });

    test('Éxito parcial: guarda únicamente la plataforma exitosa, su timestamp y su Meta postId', () => {
      const initialPost = {
        id: 'post_test_2',
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {}
      };

      const partialResult = {
        success: true,
        allOk: false,
        partial: true,
        instagram: { success: true, postId: 'ig_success_001', error: null },
        facebook: { success: false, postId: null, error: 'FB failed' }
      };

      const applied = applyPublishResult(initialPost, partialResult);

      assert.equal(applied.success, true);
      assert.equal(applied.partial, true);
      assert.equal(applied.allCompleted, false);
      assert.ok(applied.nextPublishedTo.instagram, 'debe tener timestamp de IG');
      assert.equal(applied.nextPublishedTo.facebook, undefined);
      assert.equal(applied.nextPublishedPlatformIds.instagram, 'ig_success_001');
      assert.equal(applied.nextPublishedPlatformIds.facebook, undefined);
      assert.equal(applied.updatedPost.publishedAt, null, 'publishedAt global no debe asignarse en éxito parcial');
    });

    test('Éxito total: guarda ambos timestamps, ambos Meta postIds y asigna publishedAt', () => {
      const initialPost = {
        id: 'post_test_3',
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {}
      };

      const fullResult = {
        success: true,
        allOk: true,
        partial: false,
        instagram: { success: true, postId: 'ig_ok_001' },
        facebook: { success: true, postId: 'fb_ok_002' }
      };

      const applied = applyPublishResult(initialPost, fullResult);

      assert.equal(applied.success, true);
      assert.equal(applied.allCompleted, true);
      assert.ok(applied.nextPublishedTo.instagram);
      assert.ok(applied.nextPublishedTo.facebook);
      assert.equal(applied.nextPublishedPlatformIds.instagram, 'ig_ok_001');
      assert.equal(applied.nextPublishedPlatformIds.facebook, 'fb_ok_002');
      assert.ok(applied.updatedPost.publishedAt, 'publishedAt debe quedar asignado');
    });

    test('Reintento tras éxito parcial: completa la plataforma restante y marca publishedAt', () => {
      const previousTimestamp = '2026-11-04T12:00:00.000Z';
      const initialPost = {
        id: 'post_test_4',
        publishedAt: null,
        publishedTo: { instagram: previousTimestamp },
        publishedPlatformIds: { instagram: 'ig_prev_100' }
      };

      const retryResult = {
        success: true,
        allOk: true,
        partial: false,
        instagram: { skipped: true },
        facebook: { success: true, postId: 'fb_now_200' }
      };

      const applied = applyPublishResult(initialPost, retryResult);

      assert.equal(applied.allCompleted, true);
      assert.equal(applied.nextPublishedTo.instagram, previousTimestamp, 'conserva el timestamp anterior de IG');
      assert.ok(applied.nextPublishedTo.facebook, 'agrega nuevo timestamp de FB');
      assert.equal(applied.nextPublishedPlatformIds.instagram, 'ig_prev_100');
      assert.equal(applied.nextPublishedPlatformIds.facebook, 'fb_now_200');
      assert.ok(applied.updatedPost.publishedAt);
    });
  });

  describe('3. Flujo del Webhook de Aprobación (/api/webhooks/approve/:postId)', () => {
    let originalGetAll;
    let originalUpdate;
    let originalTryClaim;
    let originalReleaseClaim;
    let originalMarkPublished;
    let originalPublishViaBridge;
    let server;
    let baseUrl;

    let inMemoryPosts = [];
    let claimsState = {};
    let releaseCalls = [];
    let markPublishedCalls = [];
    let bridgeCalls = [];

    beforeEach(async () => {
      // Mock de persistencia aislada en memoria
      inMemoryPosts = [];
      claimsState = {};
      releaseCalls = [];
      markPublishedCalls = [];
      bridgeCalls = [];
      activePublishLocks.clear();

      originalGetAll = postService.getAll;
      originalUpdate = postService.update;
      originalTryClaim = botStateService.tryClaimApprovalPublish;
      originalReleaseClaim = botStateService.releaseApprovalPublishClaim;
      originalMarkPublished = botStateService.markApprovalPublished;
      originalPublishViaBridge = publishingService.publishViaBridge;

      postService.getAll = () => inMemoryPosts;
      postService.update = (id, updates) => {
        const p = inMemoryPosts.find(x => x.id === id);
        if (p) Object.assign(p, updates);
        return p;
      };

      botStateService.tryClaimApprovalPublish = (postId) => {
        if (claimsState[postId] === 'publishing' || claimsState[postId] === 'published') {
          return { claimed: false, status: claimsState[postId] };
        }
        claimsState[postId] = 'publishing';
        return { claimed: true, status: 'publishing' };
      };

      botStateService.releaseApprovalPublishClaim = (postId) => {
        releaseCalls.push(postId);
        delete claimsState[postId];
      };

      botStateService.markApprovalPublished = (postId) => {
        markPublishedCalls.push(postId);
        claimsState[postId] = 'published';
      };

      // Iniciar servidor temporal en puerto efímero (0)
      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      postService.getAll = originalGetAll;
      postService.update = originalUpdate;
      botStateService.tryClaimApprovalPublish = originalTryClaim;
      botStateService.releaseApprovalPublishClaim = originalReleaseClaim;
      botStateService.markApprovalPublished = originalMarkPublished;
      publishingService.publishViaBridge = originalPublishViaBridge;
      activePublishLocks.clear();

      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    test('Escenario A: Fallo total en webhook -> libera claim, NO marca publicado, permite reintento', async () => {
      const postId = 'post_webhook_fail';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/img.jpg'],
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {},
        approvalToken: 'token_pub_test'
      });

      publishingService.publishViaBridge = async (...args) => {
        bridgeCalls.push(args);
        return {
          success: false,
          allOk: false,
          partial: false,
          instagram: { success: false, postId: null, error: 'IG rechaza conexión' },
          facebook: { success: false, postId: null, error: 'FB rechaza conexión' },
          error: 'IG rechaza conexión | FB rechaza conexión'
        };
      };

      const res = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`);
      const body = await res.text();

      assert.equal(res.status, 200);
      assert.match(body, /Error al publicar/);
      assert.match(body, /Puedes reintentar el enlace/);

      // Verificaciones clave de estado:
      assert.equal(releaseCalls.includes(postId), true, 'El claim debe ser liberado en botStateService');
      assert.equal(claimsState[postId], undefined, 'El claim no debe quedar bloqueado');
      assert.equal(markPublishedCalls.includes(postId), false, 'NO debe llamarse markApprovalPublished');

      const post = inMemoryPosts.find(p => p.id === postId);
      assert.equal(post.publishedAt, null, 'publishedAt no debe asignarse');
      assert.deepEqual(post.publishedTo, {}, 'publishedTo debe permanecer vacío');
      assert.deepEqual(post.publishedPlatformIds, {}, 'publishedPlatformIds debe permanecer vacío');

      // Comprobar que un segundo clic (reintento) puede reclamar el lock de nuevo
      const secondClaim = botStateService.tryClaimApprovalPublish(postId);
      assert.equal(secondClaim.claimed, true, 'El usuario puede reintentar sin quedar bloqueado');
    });

    test('Escenario B: Éxito parcial en webhook -> guarda IG, FB queda pendiente, libera claim para reintentar', async () => {
      const postId = 'post_webhook_partial';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/img.jpg'],
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {},
        approvalToken: 'token_pub_test'
      });

      publishingService.publishViaBridge = async (...args) => {
        bridgeCalls.push(args);
        return {
          success: true,
          allOk: false,
          partial: true,
          instagram: { success: true, postId: 'meta_ig_hook_111', error: null },
          facebook: { success: false, postId: null, error: 'FB connection failed' },
          error: 'Publicación parcial'
        };
      };

      const res = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`);
      const body = await res.text();

      assert.equal(res.status, 200);
      assert.match(body, /Publicado parcialmente en: instagram/);
      assert.match(body, /Pendiente: facebook/);

      // Verificaciones de persistencia parcial:
      const post = inMemoryPosts.find(p => p.id === postId);
      assert.ok(post.publishedTo.instagram, 'Timestamp de IG guardado');
      assert.equal(post.publishedTo.facebook, undefined, 'FB debe quedar pendiente');
      assert.equal(post.publishedPlatformIds.instagram, 'meta_ig_hook_111', 'Meta postId de IG guardado');
      assert.equal(post.publishedPlatformIds.facebook, undefined);
      assert.equal(post.publishedAt, null, 'publishedAt global permanece null');

      // Verificaciones del claim:
      assert.equal(releaseCalls.includes(postId), true, 'El claim debe ser liberado para permitir reintentar FB');
      assert.equal(claimsState[postId], undefined);
    });

    test('Escenario C: Reintento tras éxito parcial -> solo solicita Facebook, completa el post y marca publishedAt', async () => {
      const postId = 'post_webhook_retry_fb';
      // Simula que en el intento 1 ya se publicó IG
      const igTimestamp = '2026-11-04T10:00:00.000Z';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/img.jpg'],
        publishedAt: null,
        publishedTo: { instagram: igTimestamp },
        publishedPlatformIds: { instagram: 'meta_ig_prev_999' },
        approvalToken: 'token_pub_test'
      });

      let requestedOptions = null;
      publishingService.publishViaBridge = async (path, type, caption, fbCaption, opts) => {
        requestedOptions = opts;
        return {
          success: true,
          allOk: true,
          partial: false,
          instagram: { skipped: true },
          facebook: { success: true, postId: 'meta_fb_retry_888' }
        };
      };

      const res = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`);
      const body = await res.text();

      assert.equal(res.status, 200);
      assert.match(body, /¡Contenido aprobado y publicado exitosamente en Instagram y Facebook!/);

      // Verifica que solo solicitó las redes pendientes (Facebook)
      assert.deepEqual(requestedOptions.platforms, ['facebook'], 'Solo debe solicitar las plataformas no publicadas');

      // Verifica que el post quedó completamente publicado con ambos IDs
      const post = inMemoryPosts.find(p => p.id === postId);
      assert.equal(post.publishedTo.instagram, igTimestamp, 'Conserva fecha de IG');
      assert.ok(post.publishedTo.facebook, 'Añade fecha de FB');
      assert.equal(post.publishedPlatformIds.instagram, 'meta_ig_prev_999');
      assert.equal(post.publishedPlatformIds.facebook, 'meta_fb_retry_888');
      assert.ok(post.publishedAt, 'publishedAt global asignado');

      // Verifica que ahora sí se marca definitivamente en botStateService
      assert.equal(markPublishedCalls.includes(postId), true);
      assert.equal(claimsState[postId], 'published');

      // Un tercer clic informa que ya estaba publicado
      const thirdRes = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`);
      const thirdBody = await thirdRes.text();
      assert.match(thirdBody, /ya estaba publicado/);
    });
    test('Escenario D: Prefetch de navegador/escáner con Accept: text/html muestra página de revisión segura', async () => {
      const postId = 'post_webhook_prefetch';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/img.jpg'],
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {},
        approvalToken: 'token_pub_test',
        content: { text: 'Texto de prueba para revisión' }
      });

      const initialBridgeCalls = bridgeCalls.length;
      const res = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`, {
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      const html = await res.text();

      assert.equal(res.status, 200);
      assert.match(html, /Revisión de Contenido Programado/);
      assert.match(html, /Aprobar para Fecha Programada/);
      assert.equal(bridgeCalls.length, initialBridgeCalls, 'No debe llamar a publicar durante una inspección GET/prefetch');
    });

    test('Escenario E: Aprobación diferida con mode=scheduled marca status approved sin publicar de inmediato', async () => {
      const postId = 'post_webhook_scheduled';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/img.jpg'],
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {},
        approvalToken: 'token_pub_test'
      });

      const res = await fetch(`${baseUrl}/api/webhooks/approve/${postId}?token=token_pub_test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'mode=scheduled'
      });
      const body = await res.text();

      assert.equal(res.status, 200);
      assert.match(body, /Queda programado para publicarse en su fecha prevista/);

      const post = inMemoryPosts.find(p => p.id === postId);
      assert.equal(post.status, 'approved');
      assert.ok(post.approvedAt);
      assert.equal(post.publishedAt, null, 'No debe publicar inmediatamente');
    });

  });

  describe('4. Endpoint manual /api/publish/:id con contrato unificado', () => {
    let server;
    let baseUrl;
    let originalGetAll;
    let originalUpdate;
    let inMemoryPosts = [];

    beforeEach(async () => {
      inMemoryPosts = [];
      originalGetAll = postService.getAll;
      originalUpdate = postService.update;
      postService.getAll = () => inMemoryPosts;
      postService.update = (id, updates) => {
        const p = inMemoryPosts.find(x => x.id === id);
        if (p) Object.assign(p, updates);
        return p;
      };
      activePublishLocks.clear();
      server = app.listen(0);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterEach(async () => {
      postService.getAll = originalGetAll;
      postService.update = originalUpdate;
      activePublishLocks.clear();
      if (server) await new Promise(r => server.close(r));
    });

    test('Devuelve publishedPlatformIds y publishedTo consistentes con el contrato', async () => {
      const postId = 'post_manual_1';
      inMemoryPosts.push({
        id: postId,
        visuals: ['https://cdn.example.com/foto.png'],
        publishedAt: null,
        publishedTo: {},
        publishedPlatformIds: {}
      });

      publishingService.publishViaBridge = async () => ({
        success: true,
        allOk: true,
        partial: false,
        instagram: { success: true, postId: 'meta_manual_ig' },
        facebook: { success: true, postId: 'meta_manual_fb' }
      });

      const res = await fetch(`${baseUrl}/api/publish/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: ['instagram', 'facebook'] })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.allCompleted, true);
      assert.equal(data.publishedPlatformIds.instagram, 'meta_manual_ig');
      assert.equal(data.publishedPlatformIds.facebook, 'meta_manual_fb');
      assert.ok(data.publishedTo.instagram);
      assert.ok(data.publishedTo.facebook);

      // Si se intenta publicar de nuevo inmediatamente, devuelve 409 alreadyPublished
      const retryRes = await fetch(`${baseUrl}/api/publish/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: ['instagram', 'facebook'] })
      });
      assert.equal(retryRes.status, 409);
      const retryData = await retryRes.json();
      assert.equal(retryData.alreadyPublished, true);
    });
  });

});
