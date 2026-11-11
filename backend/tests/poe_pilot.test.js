const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const poeService = require('../services/poeService');
const { PoeService } = poeService;

describe('POE-001: Piloto de Contrato y Validación de Poe API', () => {

  // =========================================================================
  // 1. Catálogo Oficial de Modelos (Nano Banana 2.1 y Gemini Omni 1.1 Flash)
  // =========================================================================
  describe('1. Catálogo Oficial de Modelos de Poe', () => {
    test('a) getModelsCatalog consulta y devuelve lista de modelos', async () => {
      const result = await poeService.getModelsCatalog();
      assert.ok(result.success, 'Debe consultar el catálogo exitosamente');
      assert.ok(Array.isArray(result.models), 'models debe ser un array');
      assert.ok(result.total > 0, 'Debe haber más de 0 modelos en el catálogo');
    });

    test('b) gemini-omni-1.1-flash está presente y cuenta con especificación de vídeo', async () => {
      const result = await poeService.getModelDescriptor('gemini-omni-1.1-flash');
      assert.ok(result.success, 'gemini-omni-1.1-flash debe existir en el catálogo');
      const model = result.model;
      assert.equal(model.id, 'gemini-omni-1.1-flash');
      assert.deepEqual(model.architecture.output_modalities, ['video']);

      // Parámetros observados en el catálogo de Poe
      const paramNames = (model.parameters || []).map(p => p.name);
      assert.ok(paramNames.includes('task'), 'Debe soportar parámetro "task"');
      assert.ok(paramNames.includes('resolution'), 'Debe soportar parámetro "resolution"');
      assert.ok(paramNames.includes('aspect_ratio'), 'Debe soportar parámetro "aspect_ratio"');

      // Validar valores de aspecto permitidos (incluyendo 9:16 para Reels)
      const aspectParam = model.parameters.find(p => p.name === 'aspect_ratio');
      assert.ok(aspectParam.schema.enum.includes('9:16'), 'Debe soportar 9:16');
    });

    test('c) nano-banana-2.1 está presente y cuenta con especificación de imagen 1K / 9:16', async () => {
      const result = await poeService.getModelDescriptor('nano-banana-2.1');
      assert.ok(result.success, 'nano-banana-2.1 debe existir en el catálogo');
      const model = result.model;
      assert.equal(model.id, 'nano-banana-2.1');
      assert.ok(model.architecture.output_modalities.includes('image'));

      const paramNames = (model.parameters || []).map(p => p.name);
      assert.ok(paramNames.includes('image_size'), 'Debe soportar "image_size"');
      assert.ok(paramNames.includes('aspect_ratio'), 'Debe soportar "aspect_ratio"');

      const sizeParam = model.parameters.find(p => p.name === 'image_size');
      assert.ok(sizeParam.schema.enum.includes('1K'), 'Debe soportar tamaño 1K');

      const aspectParam = model.parameters.find(p => p.name === 'aspect_ratio');
      assert.ok(aspectParam.schema.enum.includes('9:16'), 'Debe soportar aspecto 9:16');
      assert.ok(aspectParam.schema.enum.includes('1:1'), 'Debe soportar aspecto 1:1');
    });
  });

  // =========================================================================
  // 2. Extracción de URLs de Medios (extractMediaUrl)
  // =========================================================================
  describe('2. Extracción de URLs de Medios', () => {
    test('a) Extrae URL desde attachments nativos de FastAPI Poe', () => {
      const payload = {
        attachments: [
          { url: 'https://poecdn.net/attachments/clip_123.mp4', name: 'clip_123.mp4' }
        ]
      };
      const url = poeService.extractMediaUrl(payload);
      assert.equal(url, 'https://poecdn.net/attachments/clip_123.mp4');
    });

    test('b) Extrae URL desde choices[0].message.attachments', () => {
      const payload = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Aquí tienes tu imagen:',
              attachments: [{ url: 'https://poecdn.net/images/banana_456.png' }]
            }
          }
        ]
      };
      const url = poeService.extractMediaUrl(payload);
      assert.equal(url, 'https://poecdn.net/images/banana_456.png');
    });

    test('c) Extrae URL desde Markdown en choices[0].message.content', () => {
      const payload = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '¡Listo! Mira la imagen generada: ![Nano Banana](https://poecdn.net/gen_789.png)'
            }
          }
        ]
      };
      const url = poeService.extractMediaUrl(payload);
      assert.equal(url, 'https://poecdn.net/gen_789.png');
    });

    test('d) Extrae URL directa con extensión multimedia en texto plano', () => {
      const payload = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Vídeo generado en: https://cdn.example.com/videos/omni_888.mp4?token=abc'
            }
          }
        ]
      };
      const url = poeService.extractMediaUrl(payload);
      assert.equal(url, 'https://cdn.example.com/videos/omni_888.mp4?token=abc');
    });

    test('e) Devuelve null si la respuesta es puro texto sin URL de medios', () => {
      const payload = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Lo siento, no pude procesar la solicitud de generación visual.'
            }
          }
        ]
      };
      assert.equal(poeService.extractMediaUrl(payload), null);
      assert.equal(poeService.extractMediaUrl(null), null);
      assert.equal(poeService.extractMediaUrl({}), null);
    });
  });

  // =========================================================================
  // 3. Descargador Seguro de Medios (downloadMediaFile)
  // =========================================================================
  describe('3. Descargador Seguro de Medios', () => {
    let mockHttpServer;
    let mockServerUrl;
    const downloadedFiles = [];

    beforeEach(async () => {
      poeService.allowLocalHosts = true;
      await new Promise((resolve) => {
        mockHttpServer = http.createServer((req, res) => {
          if (req.url === '/test-image.png') {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(Buffer.from('fake_png_data'));
          } else if (req.url === '/test-video.mp4') {
            res.writeHead(200, { 'Content-Type': 'video/mp4' });
            res.end(Buffer.from('fake_mp4_video_data'));
          } else if (req.url === '/malicious.exe') {
            res.writeHead(200, { 'Content-Type': 'application/x-executable' });
            res.end(Buffer.from('mz_pe_exe'));
          } else if (req.url === '/huge-file.mp4') {
            // Simula cabecera de más de 50 MB
            res.writeHead(200, {
              'Content-Type': 'video/mp4',
              'Content-Length': (60 * 1024 * 1024).toString()
            });
            res.end();
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        mockHttpServer.listen(0, '127.0.0.1', () => {
          mockServerUrl = `http://127.0.0.1:${mockHttpServer.address().port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (mockHttpServer) {
        await new Promise((res) => mockHttpServer.close(res));
      }
      // Limpiar archivos 1 a 1 sin borrado recursivo
      for (const f of downloadedFiles) {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      }
      downloadedFiles.length = 0;
    });

    test('a) Descarga exitosamente una imagen válida y la ubica en output/poe', async () => {
      const result = await poeService.downloadMediaFile(`${mockServerUrl}/test-image.png`, '.png');
      downloadedFiles.push(result.localPath);

      assert.ok(fs.existsSync(result.localPath), 'El archivo descargado debe existir en disco');
      assert.ok(result.localPath.includes(path.join('output', 'poe')), 'Debe estar en output/poe');
      assert.equal(result.contentType, 'image/png');
      assert.ok(result.sizeBytes > 0);
      assert.ok(result.publicUrl.includes('/output/poe/'));
    });

    test('b) Descarga exitosamente un vídeo válido', async () => {
      const result = await poeService.downloadMediaFile(`${mockServerUrl}/test-video.mp4`, '.mp4');
      downloadedFiles.push(result.localPath);

      assert.ok(fs.existsSync(result.localPath));
      assert.equal(result.contentType, 'video/mp4');
      assert.ok(result.localPath.endsWith('.mp4'));
    });

    test('c) Rechaza descargas con tipos MIME no permitidos', async () => {
      await assert.rejects(
        poeService.downloadMediaFile(`${mockServerUrl}/malicious.exe`),
        /Tipo de medio no permitido/
      );
    });

    test('d) Rechaza archivos que exceden el límite de tamaño seguro (50 MB)', async () => {
      await assert.rejects(
        poeService.downloadMediaFile(`${mockServerUrl}/huge-file.mp4`),
        /excede el tamaño máximo/
      );
    });

    test('e) Rechaza protocolos inseguros (file:// o ftp://)', async () => {
      await assert.rejects(
        poeService.downloadMediaFile('file:///etc/passwd'),
        /Solo se permiten protocolos HTTP y HTTPS/
      );
    });

    test('f) Rechaza descargas hacia hosts privados (anti-SSRF) cuando allowLocalHosts=false', async () => {
      const hardenedClient = new PoeService({ allowLocalHosts: false });
      await assert.rejects(
        hardenedClient.downloadMediaFile('http://169.254.169.254/latest/meta-data'),
        /Acceso denegado a host privado o inseguro/
      );
      await assert.rejects(
        hardenedClient.downloadMediaFile('http://192.168.1.1/admin'),
        /Acceso denegado a host privado o inseguro/
      );
      await assert.rejects(
        hardenedClient.downloadMediaFile('http://127.0.0.1:8080/secret'),
        /Acceso denegado a host privado o inseguro/
      );
    });
  });

  // =========================================================================
  // 4. Control Presupuestario y Manejo de Saldo (getBalance & Reservas)
  // =========================================================================
  describe('4. Control Presupuestario y Reservas de Puntos', () => {
    test('a) getBalance devuelve mock cuando no hay POE_API_KEY configurada', async () => {
      const serviceWithoutKey = new PoeService({ apiKey: '' });
      const balance = await serviceWithoutKey.getBalance();

      assert.equal(balance.success, false);
      assert.equal(balance.mock, true);
      assert.equal(balance.balance, null);
      assert.match(balance.message, /POE_API_KEY no configurada/);
    });

    test('b) Aborta con 402 si el saldo disponible es inferior a la reserva de imagen', async () => {
      const client = new PoeService({ apiKey: 'fake_key' });
      // Simulamos getBalance devolviendo 500 puntos (insuficiente para imagen ~1200)
      client.getBalance = async () => ({ success: true, balance: 500 });

      const result = await client.generateImage({
        prompt: 'Un tractor en invernadero de Almería',
        mock: false
      });

      assert.equal(result.success, false);
      assert.equal(result.status, 402);
      assert.match(result.error, /Saldo insuficiente en Poe/);
    });

    test('c) Aborta con 402 si el saldo disponible es inferior a la reserva de vídeo (~30.000)', async () => {
      const client = new PoeService({ apiKey: 'fake_key' });
      // Saldo de 20.000 puntos (insuficiente para clip de vídeo de 30.000)
      client.getBalance = async () => ({ success: true, balance: 20000 });

      const result = await client.generateVideo({
        prompt: 'Agricultor revisando albarán de subasta',
        mock: false
      });

      assert.equal(result.success, false);
      assert.equal(result.status, 402);
      assert.match(result.error, /Saldo insuficiente para clip de vídeo/);
    });

    test('d) Fail-Closed: aborta la generación si getBalance() falla o devuelve error', async () => {
      const client = new PoeService({ apiKey: 'fake_key' });
      // Simula fallo de red o estado indeterminado de saldo
      client.getBalance = async () => ({ success: false, status: 500, error: 'Connection reset by peer' });

      const imgRes = await client.generateImage({
        prompt: 'Cultivo de calabacín en Almería',
        mock: false
      });
      assert.equal(imgRes.success, false);
      assert.match(imgRes.error, /Imposible verificar saldo en Poe/);

      const vidRes = await client.generateVideo({
        prompt: 'Riego por goteo en invernadero',
        mock: false
      });
      assert.equal(vidRes.success, false);
      assert.match(vidRes.error, /Imposible verificar saldo en Poe/);
    });

    test('e) Valida constantes de reserva del piloto (DEFAULT_PILOT_POINTS_RESERVE = 40000)', () => {
      assert.equal(poeService.DEFAULT_PILOT_POINTS_RESERVE, 40000);
      assert.equal(poeService.ESTIMATED_IMAGE_POINTS, 1200);
      assert.equal(poeService.ESTIMATED_VIDEO_POINTS, 30000);
    });
    test('f) parsea current_point_balance como campo primario de la API oficial de Poe [F4]', async () => {
      const client = new PoeService({ apiKey: 'valid_test_key' });
      // Simula respuesta HTTP de Poe con el campo oficial current_point_balance
      const originalFetch = global.fetch;
      try {
        global.fetch = async () => ({
          ok: true,
          status: 200,
          json: async () => ({ current_point_balance: 85000 })
        });

        const res = await client.getBalance();
        assert.equal(res.success, true);
        assert.equal(res.balance, 85000);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // 5. Contratos de Generación y Compatibilidad con Remotion
  // =========================================================================
  describe('5. Contratos de Generación y Compatibilidad', () => {
    const createdTempFiles = [];

    afterEach(() => {
      for (const f of createdTempFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      createdTempFiles.length = 0;
    });

    test('a) generateImage en modo mock devuelve contrato completo de imagen', async () => {
      const result = await poeService.generateImage({
        prompt: 'Invernadero multitúnel al atardecer en El Ejido',
        aspectRatio: '9:16',
        imageSize: '1K',
        mock: true
      });

      assert.equal(result.success, true);
      assert.equal(result.mock, true);
      assert.equal(result.model, 'nano-banana-2.1');
      assert.equal(result.aspectRatio, '9:16');
      assert.equal(result.imageSize, '1K');
      assert.ok(result.path && fs.existsSync(result.path));
      assert.ok(result.url.includes('/output/poe/'));
      assert.equal(result.costPoints, 1200);

      createdTempFiles.push(result.path);
    });

    test('b) generateVideo en modo mock devuelve contrato Remotion (8s, 9:16, aac)', async () => {
      const result = await poeService.generateVideo({
        prompt: 'Recolección de pimiento california rojo en invernadero',
        aspectRatio: '9:16',
        resolution: '720p',
        mock: true
      });

      assert.equal(result.success, true);
      assert.equal(result.mock, true);
      assert.equal(result.model, 'gemini-omni-1.1-flash');
      assert.equal(result.aspectRatio, '9:16');
      assert.equal(result.resolution, '720p');
      assert.equal(result.duration, 8.0);
      assert.equal(result.hasAudio, true);
      assert.equal(result.audioCodec, 'aac');
      assert.equal(result.engine, 'gemini-omni-poe');
      assert.ok(result.path && fs.existsSync(result.path));
      assert.ok(result.url.includes('/output/poe/'));
      assert.equal(result.costPoints, 30000);

      createdTempFiles.push(result.path);
    });

    test('c) Validación de prompt requerido en imagen y vídeo', async () => {
      const imgRes = await poeService.generateImage({ prompt: '' });
      assert.equal(imgRes.success, false);
      assert.match(imgRes.error, /prompt de imagen es obligatorio/);

      const vidRes = await poeService.generateVideo({ prompt: '   ' });
      assert.equal(vidRes.success, false);
      assert.match(vidRes.error, /prompt de vídeo es obligatorio/);
    });
    test('d) sin POE_API_KEY y sin mock:true, generateImage y generateVideo retornan status 401', async () => {
      const clientWithoutKey = new PoeService({ apiKey: '' });
      const imgRes = await clientWithoutKey.generateImage({
        prompt: 'Invernadero almeriense',
        mock: false
      });
      assert.equal(imgRes.success, false);
      assert.equal(imgRes.status, 401);
      assert.match(imgRes.error, /POE_API_KEY no configurada/);

      const vidRes = await clientWithoutKey.generateVideo({
        prompt: 'Riego en invernadero',
        mock: false
      });
      assert.equal(vidRes.success, false);
      assert.equal(vidRes.status, 401);
      assert.match(vidRes.error, /POE_API_KEY no configurada/);
    });

    test('e) buildVideoPayload incluye parámetros de tarea, aspect_ratio y resolution reales', () => {
      const client = new PoeService({ apiKey: 'test_key' });
      const payload = client.buildVideoPayload('Cosecha de tomate', {
        aspectRatio: '9:16',
        resolution: '720p',
        task: 'text_to_video'
      });

      assert.equal(payload.model, 'gemini-omni-1.1-flash');
      assert.equal(payload.aspect_ratio, '9:16');
      assert.equal(payload.resolution, '720p');
      assert.equal(payload.task, 'text_to_video');
    });
  });
});
