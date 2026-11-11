const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app, getBusinessDateMadrid, activePublishLocks } = require('../server');
const postService = require('../services/postService');
const approvalGateway = require('../automation/approvalGateway');
const instagramPublisher = require('../automation/instagramPublisher');
const botStateService = require('../services/botStateService');
const publishingService = require('../services/publishingService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('OPS-001: Seguridad de Webhooks, Endurecimiento y Coherencia Horaria', () => {

  // =========================================================================
  // a) Creación de post genera approvalToken válido (formato UUID)
  // =========================================================================
  describe('a) Creación de post con approvalToken UUID', () => {
    const postsFilePath = path.join(__dirname, '../data/posts.json');
    let backupPostsContent;

    beforeEach(() => {
      if (fs.existsSync(postsFilePath)) {
        backupPostsContent = fs.readFileSync(postsFilePath, 'utf8');
      } else {
        backupPostsContent = null;
      }
    });

    afterEach(() => {
      if (backupPostsContent !== null) {
        fs.writeFileSync(postsFilePath, backupPostsContent, 'utf8');
      }
    });

    test('save(post) genera automáticamente approvalToken con formato UUID v4', () => {
      const created = postService.save({
        briefing: 'Test OPS-001 UUID generation',
        contentType: 'single',
        aspectRatio: '1:1'
      });

      assert.ok(created.id, 'Debe asignar un ID al post');
      assert.ok(created.approvalToken, 'Debe contar con approvalToken');
      assert.equal(typeof created.approvalToken, 'string');
      assert.match(
        created.approvalToken,
        UUID_REGEX,
        `El approvalToken "${created.approvalToken}" debe cumplir el formato UUID`
      );
    });

    test('save(post) respeta un approvalToken preexistente si es proporcionado', () => {
      const customToken = '11111111-2222-4333-8444-555555555555';
      const created = postService.save({
        briefing: 'Test OPS-001 custom token',
        approvalToken: customToken
      });

      assert.equal(created.approvalToken, customToken, 'Debe preservar el approvalToken proporcionado');
    });

    test('approvalGateway.sendApprovalEmail incluye ?token=... en enlaces de aprobación y rechazo', async () => {
      let sentMail = null;
      const originalGetTransporter = approvalGateway._getTransporter;
      const originalEnv = {
        ADMIN_EMAIL: process.env.ADMIN_EMAIL,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        SMTP_HOST: process.env.SMTP_HOST,
        SERVER_URL: process.env.SERVER_URL
      };

      try {
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.SMTP_USER = 'smtp_user';
        process.env.SMTP_PASS = 'smtp_pass';
        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SERVER_URL = 'https://app.example.com';

        approvalGateway.transporter = {
          sendMail: async (options) => {
            sentMail = options;
            return { messageId: 'msg-123' };
          }
        };

        const testToken = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
        const post = {
          id: 'post_gateway_test',
          approvalToken: testToken,
          content: { facebook: { copy: 'FB text' } },
          visuals: []
        };

        await approvalGateway.sendApprovalEmail(post, {
          day: 10,
          hour: '11:00',
          format: 'single',
          concept: 'Test Gateway Link Token'
        });

        assert.ok(sentMail, 'sendMail debió ser invocado');
        assert.ok(
          sentMail.html.includes(`https://app.example.com/api/webhooks/approve/post_gateway_test?token=${encodeURIComponent(testToken)}`),
          'El enlace de aprobación debe contener el token'
        );
        assert.ok(
          sentMail.html.includes(`https://app.example.com/api/webhooks/reject/post_gateway_test?token=${encodeURIComponent(testToken)}`),
          'El enlace de rechazo debe contener el token'
        );
      } finally {
        approvalGateway._getTransporter = originalGetTransporter;
        approvalGateway.transporter = null;
        Object.entries(originalEnv).forEach(([k, v]) => {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        });
      }
    });
  });

  // =========================================================================
  // b & c) Webhook de Aprobación: validación estricta de token
  // =========================================================================
  describe('b & c) Webhook de Aprobación (/api/webhooks/approve/:postId)', () => {
    let server;
    let baseUrl;
    let originalGetAll;
    let originalUpdate;
    let originalTryClaim;
    let originalReleaseClaim;
    let originalMarkPublished;
    let originalPublishViaBridge;

    let inMemoryPosts = [];
    const validToken = '2b7e1516-28ae-4d2e-9d2a-43c2b8b9f123';
    const testPostId = 'post_ops_approve_test';

    beforeEach(async () => {
      inMemoryPosts = [
        {
          id: testPostId,
          approvalToken: validToken,
          visuals: ['https://cdn.example.com/ops_test.jpg'],
          publishedAt: null,
          publishedTo: {},
          publishedPlatformIds: {},
          content: { facebook: { copy: 'Test approve' } }
        }
      ];
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

      botStateService.tryClaimApprovalPublish = () => ({ claimed: true, status: 'publishing' });
      botStateService.releaseApprovalPublishClaim = () => {};
      botStateService.markApprovalPublished = () => {};

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
        await new Promise(resolve => server.close(resolve));
      }
    });

    test('b1) Rechaza con HTTP 403 si el token está ausente en la petición', async () => {
      const res = await fetch(`${baseUrl}/api/webhooks/approve/${testPostId}`);
      assert.equal(res.status, 403, 'Debe devolver código 403 Forbidden');
      const html = await res.text();
      assert.ok(
        html.includes('Acceso no autorizado: Token de aprobación inválido o ausente.'),
        'Debe informar de token inválido o ausente'
      );
    });

    test('b2) Rechaza con HTTP 403 si el token es incorrecto', async () => {
      const res = await fetch(`${baseUrl}/api/webhooks/approve/${testPostId}?token=token_invalido_hacker`);
      assert.equal(res.status, 403, 'Debe devolver código 403 Forbidden');
      const html = await res.text();
      assert.ok(
        html.includes('Acceso no autorizado: Token de aprobación inválido o ausente.'),
        'Debe rechazar token incorrecto'
      );
    });

    test('c) Autoriza y procesa exitosamente cuando el token coincide', async () => {
      publishingService.publishViaBridge = async () => ({
        success: true,
        allOk: true,
        partial: false,
        instagram: { success: true, postId: 'ig_ops_123' },
        facebook: { success: true, postId: 'fb_ops_456' }
      });

      const res = await fetch(`${baseUrl}/api/webhooks/approve/${testPostId}?token=${validToken}`);
      assert.equal(res.status, 200, 'Debe permitir el acceso con HTTP 200');
      const html = await res.text();
      assert.ok(
        html.includes('aprobado y publicado exitosamente') || html.includes('aprobado'),
        'Debe mostrar página de confirmación de publicación'
      );
      assert.ok(inMemoryPosts[0].publishedAt, 'El post debe haberse marcado como publicado');
    });
  });

  // =========================================================================
  // d) Webhook de Rechazo: exigencia y validación de token (403/200)
  // =========================================================================
  describe('d) Webhook de Rechazo (/api/webhooks/reject/:postId)', () => {
    let server;
    let baseUrl;
    let originalGetAll;
    let originalGetClaimStatus;
    let originalGetSchedule;
    let originalUpdateSchedule;
    let originalRemovePending;

    let inMemoryPosts = [];
    const validToken = '7c9e1516-38ae-4d2e-9d2a-43c2b8b9f789';
    const testPostId = 'post_ops_reject_test';

    beforeEach(async () => {
      inMemoryPosts = [
        {
          id: testPostId,
          approvalToken: validToken,
          publishedAt: null,
          publishedTo: {}
        }
      ];

      originalGetAll = postService.getAll;
      originalGetClaimStatus = botStateService.getPublishClaimStatus;
      originalGetSchedule = botStateService.getSchedule;
      originalUpdateSchedule = botStateService.updateScheduleEntryByPostId;
      originalRemovePending = botStateService.removePendingApproval;

      postService.getAll = () => inMemoryPosts;
      botStateService.getPublishClaimStatus = () => 'pending';
      botStateService.getSchedule = () => [{ postId: testPostId, status: 'awaiting_approval' }];
      botStateService.updateScheduleEntryByPostId = () => {};
      botStateService.removePendingApproval = () => {};

      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      postService.getAll = originalGetAll;
      botStateService.getPublishClaimStatus = originalGetClaimStatus;
      botStateService.getSchedule = originalGetSchedule;
      botStateService.updateScheduleEntryByPostId = originalUpdateSchedule;
      botStateService.removePendingApproval = originalRemovePending;

      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });

    test('d1) Rechaza con HTTP 403 si el token no se incluye en el rechazo', async () => {
      const res = await fetch(`${baseUrl}/api/webhooks/reject/${testPostId}`);
      assert.equal(res.status, 403, 'Debe responder 403 Forbidden sin token');
      const html = await res.text();
      assert.ok(html.includes('Acceso no autorizado: Token de aprobación inválido o ausente.'));
    });

    test('d2) Rechaza con HTTP 403 si el token es erróneo', async () => {
      const res = await fetch(`${baseUrl}/api/webhooks/reject/${testPostId}?token=token_invalido_reject`);
      assert.equal(res.status, 403, 'Debe responder 403 Forbidden con token inválido');
      const html = await res.text();
      assert.ok(html.includes('Acceso no autorizado: Token de aprobación inválido o ausente.'));
    });

    test('d3) Autoriza con HTTP 200 y procesa el rechazo cuando el token es correcto', async () => {
      let scheduleUpdated = false;
      let pendingRemoved = false;

      botStateService.updateScheduleEntryByPostId = (postId, updates) => {
        if (postId === testPostId && updates.status === 'planned') {
          scheduleUpdated = true;
        }
      };
      botStateService.removePendingApproval = (postId) => {
        if (postId === testPostId) pendingRemoved = true;
      };

      const res = await fetch(`${baseUrl}/api/webhooks/reject/${testPostId}?token=${validToken}`);
      assert.equal(res.status, 200, 'Debe responder 200 OK con token correcto');
      const html = await res.text();
      assert.ok(html.includes('Contenido rechazado'), 'Debe mostrar página de confirmación de rechazo');
      assert.ok(scheduleUpdated, 'Debe actualizar el calendario a planned');
      assert.ok(pendingRemoved, 'Debe eliminar el post de pendientes de aprobación');
    });
  });

  // =========================================================================
  // e) Saneamiento de logs en instagramPublisher.js: sin prefijo ni fragmento
  // =========================================================================
  describe('e) Protección de credenciales en logs de instagramPublisher.js', () => {
    let originalEnvToken;
    let originalEnvAccountId;
    let originalConsoleLog;
    let originalFetch;
    let loggedMessages = [];

    beforeEach(() => {
      originalEnvToken = process.env.INSTAGRAM_ACCESS_TOKEN;
      originalEnvAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
      originalConsoleLog = console.log;
      originalFetch = global.fetch;
      loggedMessages = [];

      console.log = (...args) => {
        loggedMessages.push(args.join(' '));
      };
    });

    afterEach(() => {
      process.env.INSTAGRAM_ACCESS_TOKEN = originalEnvToken;
      process.env.INSTAGRAM_ACCOUNT_ID = originalEnvAccountId;
      console.log = originalConsoleLog;
      global.fetch = originalFetch;
    });

    test('No imprime ningún prefijo ni fragmento del token en consola, muestra [CONFIGURADO]', async () => {
      const secretToken = 'EAABTESTSECRET_CRITICAL_TOKEN_NEVER_LEAK_12345';
      process.env.INSTAGRAM_ACCESS_TOKEN = secretToken;
      process.env.INSTAGRAM_ACCOUNT_ID = '17841400000000000';

      // Simular fallo temprano de fetch para no requerir conexión externa
      global.fetch = async () => ({
        json: async () => ({ error: { message: 'Detenido intencionalmente para prueba de log' } })
      });

      await instagramPublisher.publishImage('https://cdn.example.com/test_image.jpg', 'Test caption');

      const fullLogOutput = loggedMessages.join('\n');

      // 1. Verificar que NUNCA aparece el substring de 10 caracteres ni el secreto
      assert.equal(
        fullLogOutput.includes('EAABTESTSE'),
        false,
        'NO debe imprimirse el fragmento o prefijo del token (substring)'
      );
      assert.equal(
        fullLogOutput.includes('Token (recortado)'),
        false,
        'NO debe existir el texto "Token (recortado)" en la consola'
      );
      assert.equal(
        fullLogOutput.includes(secretToken),
        false,
        'NO debe aparecer el token completo en la consola'
      );

      // 2. Verificar que se imprime la marca segura
      assert.ok(
        fullLogOutput.includes('Token: [CONFIGURADO]'),
        'Debe imprimir de forma segura "Token: [CONFIGURADO]"'
      );
    });

    test('El código fuente de instagramPublisher.js no contiene llamadas a substring sobre accessToken', () => {
      const publisherSrc = fs.readFileSync(
        path.join(__dirname, '../automation/instagramPublisher.js'),
        'utf8'
      );
      assert.equal(
        publisherSrc.includes('accessToken.substring'),
        false,
        'No deben quedar llamadas a accessToken.substring en instagramPublisher.js'
      );
      assert.ok(
        publisherSrc.includes('Token: [CONFIGURADO]'),
        'Debe contener la cadena "Token: [CONFIGURADO]"'
      );
    });
  });

  // =========================================================================
  // f) Coherencia horaria (Europe/Madrid)
  // =========================================================================
  describe('f) Coherencia horaria estricta (Europe/Madrid)', () => {
    test('Calcula correctamente día y mes en horario de invierno (CET, UTC+1)', () => {
      // 2026-11-04 a las 23:30 UTC -> en Madrid (UTC+1) ya es 2026-11-05 a las 00:30
      const utcDate = new Date('2026-11-04T23:30:00.000Z');
      const madrid = getBusinessDateMadrid(utcDate);

      assert.equal(madrid.year, 2026);
      assert.equal(madrid.month, 11);
      assert.equal(madrid.day, 5, 'En Madrid debe ser día 5 a las 00:30');
      assert.equal(madrid.hour, 0);
      assert.equal(madrid.minute, 30);
      assert.equal(madrid.isoDateString, '2026-11-05');
      assert.equal(madrid.monthKey, '2026-11');
      assert.ok(
        madrid.formattedMadrid.includes('5') && madrid.formattedMadrid.includes('noviembre'),
        'Debe formatear como 5 de noviembre en español'
      );
    });

    test('Calcula correctamente día y mes en horario de verano (CEST, UTC+2)', () => {
      // 2026-07-15 a las 22:15 UTC -> en Madrid (UTC+2) ya es 2026-07-16 a las 00:15
      const utcDateSummer = new Date('2026-07-15T22:15:00.000Z');
      const madridSummer = getBusinessDateMadrid(utcDateSummer);

      assert.equal(madridSummer.year, 2026);
      assert.equal(madridSummer.month, 7);
      assert.equal(madridSummer.day, 16, 'En Madrid horario de verano debe ser día 16 a las 00:15');
      assert.equal(madridSummer.hour, 0);
      assert.equal(madridSummer.minute, 15);
      assert.equal(madridSummer.isoDateString, '2026-07-16');
      assert.equal(madridSummer.monthKey, '2026-07');
    });

    test('Manejo seguro con fecha por defecto (tiempo actual)', () => {
      const nowMadrid = getBusinessDateMadrid();
      assert.ok(nowMadrid.year >= 2026);
      assert.ok(nowMadrid.month >= 1 && nowMadrid.month <= 12);
      assert.ok(nowMadrid.day >= 1 && nowMadrid.day <= 31);
      assert.ok(nowMadrid.hour >= 0 && nowMadrid.hour <= 23);
      assert.ok(nowMadrid.isoDateString.match(/^\d{4}-\d{2}-\d{2}$/));
    });
  });

});
