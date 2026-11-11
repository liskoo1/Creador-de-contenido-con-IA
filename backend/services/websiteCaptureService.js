const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PublicWebPolicy = require('./publicWebPolicy');

/**
 * Servicio de navegación y captura web controlada con Playwright y Chromium.
 * Implementa las directrices de aislamiento, límites de recursos y prevención SSRF.
 */
class WebsiteCaptureService {
  constructor(options = {}) {
    this.policy = options.policy || new PublicWebPolicy({ allowLocalFixtures: Boolean(options.allowLocalFixtures) });
    this.pageTimeoutMs = options.pageTimeoutMs || 20000;
    this.totalTimeoutMs = options.totalTimeoutMs || 120000;
    this.maxPages = options.maxPages || 5;
    this.maxTextBytesPerPage = options.maxTextBytesPerPage || 2 * 1024 * 1024; // 2 MiB
    this.tempBaseDir = options.tempBaseDir || path.join(__dirname, '../data/temp_captures');
    
    if (!fs.existsSync(this.tempBaseDir)) {
      fs.mkdirSync(this.tempBaseDir, { recursive: true });
    }
  }

  /**
   * Navega por una URL de destino, extrae evidencia textual limpia y toma dos capturas (escritorio y móvil).
   *
   * @param {string} targetUrl - URL pública a analizar
   * @param {object} context - Opciones del trabajo ({ jobId, onProgress, abortSignal })
   * @returns {Promise<object>} Evidencia textual, metadatos y capturas
   */
  async captureWebsite(targetUrl, context = {}) {
    const { jobId = crypto.randomUUID(), onProgress = () => {}, abortSignal = null } = context;
    const jobDir = path.join(this.tempBaseDir, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    onProgress({ stage: 'reading', message: 'Validando URL y políticas de seguridad...' });

    // 1. Validación de seguridad estricta Anti-SSRF
    const { validUrl, parsed: targetParsed } = await this.policy.validateTargetUrl(targetUrl);
    const origin = targetParsed.origin;

    let browser = null;
    let browserContext = null;

    try {
      if (abortSignal?.aborted) throw new Error('Operación cancelada antes de iniciar el navegador.');

      onProgress({ stage: 'reading', message: 'Iniciando navegador seguro en entorno aislado...' });
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security=false',
          '--disable-extensions'
        ]
      });

      // Contexto 1: Vista de Escritorio (1440x900)
      browserContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 HelpmeagroBot/1.0',
        ignoreHTTPSErrors: false,
        locale: 'es-ES'
      });

      const page = await browserContext.newPage();
      page.setDefaultTimeout(this.pageTimeoutMs);

      // Manejo de cancelación en tiempo real
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          browser?.close().catch(() => {});
        }, { once: true });
      }

      onProgress({ stage: 'reading', message: `Navegando a la página principal: ${validUrl}...` });
      
      const response = await page.goto(validUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.pageTimeoutMs
      });

      if (!response) {
        throw new Error(`No se recibió respuesta HTTP de ${validUrl}`);
      }

      const finalUrl = page.url();
      const finalParsed = new URL(finalUrl);

      // Verificación de desvío de dominio en redirección
      if (finalParsed.origin !== origin) {
        // Validar la URL final redirigida por seguridad
        await this.policy.validateTargetUrl(finalUrl);
      }

      // Esperar brevemente a que fuentes o elementos visuales se asienten
      await page.waitForTimeout(1200);

      // Intentar cerrar avisos de cookies comunes de forma segura
      await this._handleCookieConsent(page);

      // 2. Captura Escritorio (1440x900)
      onProgress({ stage: 'capturing', message: 'Generando captura de pantalla de escritorio (1440x900)...' });
      const desktopFilename = `screenshot_desktop_${Date.now()}.png`;
      const desktopPath = path.join(jobDir, desktopFilename);
      const desktopBuffer = await page.screenshot({ path: desktopPath, fullPage: false, type: 'png' });

      const desktopMeta = {
        viewport: 'desktop',
        width: 1440,
        height: 900,
        sizeBytes: desktopBuffer.length,
        hash: crypto.createHash('sha256').update(desktopBuffer).digest('hex'),
        filename: desktopFilename,
        filePath: desktopPath,
        capturedAt: new Date().toISOString()
      };

      // 3. Extracción de contenido de la página principal
      onProgress({ stage: 'extracting', message: 'Extrayendo metadatos y texto visible...' });
      const mainPageData = await this._extractPageContent(page, validUrl);

      // 4. Captura Móvil en contexto separado (390x844, DPR 1)
      onProgress({ stage: 'capturing', message: 'Generando captura móvil responsive (390x844)...' });
      let mobileMeta = null;
      try {
        const mobileContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 1,
          isMobile: true,
          hasTouch: true,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          locale: 'es-ES'
        });
        const mobilePage = await mobileContext.newPage();
        mobilePage.setDefaultTimeout(this.pageTimeoutMs);

        await mobilePage.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: this.pageTimeoutMs });
        await mobilePage.waitForTimeout(1000);
        await this._handleCookieConsent(mobilePage);

        const mobileFilename = `screenshot_mobile_${Date.now()}.png`;
        const mobilePath = path.join(jobDir, mobileFilename);
        const mobileBuffer = await mobilePage.screenshot({ path: mobilePath, fullPage: false, type: 'png' });

        mobileMeta = {
          viewport: 'mobile',
          width: 390,
          height: 844,
          sizeBytes: mobileBuffer.length,
          hash: crypto.createHash('sha256').update(mobileBuffer).digest('hex'),
          filename: mobileFilename,
          filePath: mobilePath,
          capturedAt: new Date().toISOString()
        };
        await mobileContext.close();
      } catch (mobileErr) {
        console.warn('[WebsiteCapture] Advertencia: Fallo en captura móvil parcial:', mobileErr.message);
      }

      // 5. Navegar por hasta 4 enlaces secundarios relevantes del mismo origen
      const secondaryPages = [];
      const linksToVisit = mainPageData.relevantLinks.slice(0, this.maxPages - 1);

      for (const link of linksToVisit) {
        if (abortSignal?.aborted) break;
        try {
          onProgress({ stage: 'reading', message: `Leyendo sección relacionada: ${link.text || link.url}...` });
          await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(600);
          const subData = await this._extractPageContent(page, link.url);
          secondaryPages.push(subData);
        } catch (subErr) {
          console.warn(`[WebsiteCapture] No se pudo leer enlace secundario ${link.url}: ${subErr.message}`);
        }
      }

      await browserContext.close();
      await browser.close();
      browser = null;

      // 6. Consolidar evidencia
      const allPages = [mainPageData, ...secondaryPages];
      let totalEvidenceText = '';
      const sources = [];

      for (const p of allPages) {
        sources.push({ url: p.url, title: p.title });
        const sectionHeader = `\n--- PÁGINA: ${p.title} (${p.url}) ---\n`;
        const sectionContent = `DESCRIPCIÓN META: ${p.metaDescription}\nTEXTO:\n${p.cleanText}\n`;
        if ((totalEvidenceText.length + sectionHeader.length + sectionContent.length) <= 30000) {
          totalEvidenceText += sectionHeader + sectionContent;
        } else {
          const remaining = 30000 - totalEvidenceText.length - sectionHeader.length;
          if (remaining > 200) {
            totalEvidenceText += sectionHeader + sectionContent.slice(0, remaining) + '\n[...recortado por límite...]';
          }
          break;
        }
      }

      onProgress({ stage: 'ready', message: 'Navegación y capturas completadas con éxito.' });

      return {
        jobId,
        sourceUrl: validUrl,
        finalUrl,
        origin,
        title: mainPageData.title,
        metaDescription: mainPageData.metaDescription,
        structuredData: mainPageData.structuredData,
        sources,
        evidenceText: totalEvidenceText.trim(),
        captures: {
          desktop: desktopMeta,
          mobile: mobileMeta
        }
      };

    } catch (error) {
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      throw error;
    }
  }

  /**
   * Extrae el contenido relevante y limpio de una página cargada en Playwright.
   */
  async _extractPageContent(page, currentUrl) {
    return await page.evaluate((currentUrl) => {
      // 1. Título
      const title = document.title || '';

      // 2. Metadatos
      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                              document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      
      const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '';

      // 3. Datos estructurados JSON-LD
      const structuredData = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const json = JSON.parse(s.textContent);
          structuredData.push(json);
        } catch (_) {}
      });

      // 4. Limpieza de texto visible
      // Eliminar elementos que no aportan contenido de negocio
      const toRemove = document.querySelectorAll('script, style, noscript, svg, iframe, nav, footer, [aria-hidden="true"]');
      toRemove.forEach(el => el.remove());

      // Extraer texto limpio de encabezados y párrafos
      const blocks = [];
      const elements = document.querySelectorAll('h1, h2, h3, h4, p, li, blockquote');
      elements.forEach(el => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 15 && !blocks.includes(text)) {
          blocks.push(text);
        }
      });
      const cleanText = blocks.join('\n');

      // 5. Enlaces internos relevantes
      const parsedCurrent = new URL(currentUrl);
      const links = [];
      const seenUrls = new Set([parsedCurrent.href]);

      const keywords = ['servicio', 'producto', 'nosotros', 'sobre', 'empresa', 'contacto', 'solucion', 'funcionalidad', 'pricing', 'tarifa', 'features'];
      const exclude = ['login', 'signin', 'signup', 'registro', 'cart', 'checkout', 'download', 'descarga', 'privacidad', 'cookies', 'aviso-legal', 'terminos'];

      document.querySelectorAll('a[href]').forEach(a => {
        try {
          const href = a.getAttribute('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

          const resolved = new URL(href, currentUrl);
          // Mismo origen estrictamente
          if (resolved.origin !== parsedCurrent.origin) return;

          // Excluir extensiones no HTML
          if (/\.(pdf|zip|png|jpg|jpeg|gif|svg|exe|dmg|tar|gz|mp4|mp3)$/i.test(resolved.pathname)) return;

          const lowerPath = (resolved.pathname + resolved.search).toLowerCase();
          if (exclude.some(ex => lowerPath.includes(ex))) return;

          const text = (a.innerText || a.textContent || '').trim();
          const cleanHref = resolved.origin + resolved.pathname;

          if (!seenUrls.has(cleanHref)) {
            seenUrls.add(cleanHref);
            const isRelevant = keywords.some(k => lowerPath.includes(k) || text.toLowerCase().includes(k));
            links.push({
              url: cleanHref,
              text: text.slice(0, 50),
              isRelevant
            });
          }
        } catch (_) {}
      });

      // Ordenar enlaces: primero los relevantes por palabra clave
      links.sort((a, b) => (b.isRelevant ? 1 : 0) - (a.isRelevant ? 1 : 0));

      return {
        url: currentUrl,
        title: (siteName && !title.includes(siteName)) ? `${title} | ${siteName}` : title,
        metaDescription,
        structuredData,
        cleanText,
        relevantLinks: links
      };
    }, currentUrl);
  }

  /**
   * Intenta detectar y cerrar banners de consentimiento de cookies.
   */
  async _handleCookieConsent(page) {
    try {
      const selectors = [
        'button[id*="cookie"]',
        'button[class*="cookie"]',
        'button:has-text("Aceptar")',
        'button:has-text("Rechazar")',
        'button:has-text("Acepto")',
        'button:has-text("Accept")',
        'button:has-text("Consent")',
        'a:has-text("Aceptar todas")',
        '#onetrust-accept-btn-handler',
        '.cc-btn.cc-dismiss'
      ];

      for (const sel of selectors) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click({ timeout: 1500 });
          await page.waitForTimeout(400);
          break;
        }
      }
    } catch (_) {
      // Ignorar fallos de cierre de cookies
    }
  }

  /**
   * Limpieza de directorios temporales de jobs antiguos (> 24h).
   */
  cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!fs.existsSync(this.tempBaseDir)) return;
    const now = Date.now();
    try {
      const entries = fs.readdirSync(this.tempBaseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(this.tempBaseDir, entry.name);
          const stats = fs.statSync(dirPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            // Eliminar archivos individuales de la carpeta y luego el directorio
            const files = fs.readdirSync(dirPath);
            for (const f of files) {
              fs.unlinkSync(path.join(dirPath, f));
            }
            fs.rmdirSync(dirPath);
            console.log(`[WebsiteCapture] Limpiado directorio temporal de job expirado: ${entry.name}`);
          }
        }
      }
    } catch (e) {
      console.warn('[WebsiteCapture] Error en limpieza de temporales:', e.message);
    }
  }
}

module.exports = WebsiteCaptureService;
