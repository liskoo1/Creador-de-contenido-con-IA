const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

/**
 * Pasarela de Aprobación Human-in-the-Loop.
 * Envía correos HTML interactivos con botones de Aprobar/Rechazar.
 * Las imágenes se incrustan como attachments CID para que sean visibles en cualquier cliente de email.
 */
class ApprovalGateway {
  constructor() {
    this.transporter = null;
  }

  _getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.dondominio.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
    return this.transporter;
  }

  /**
   * Resuelve una URL o ruta relativa a su ruta absoluta en disco.
   */
  _resolveFilePath(urlOrPath) {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;
    try {
      let filePath = urlOrPath;
      if (urlOrPath.startsWith('http')) {
        const url = new URL(urlOrPath);
        filePath = url.pathname;
      }
      const relative = filePath.replace(/^\/output\//, '').replace(/^output\//, '');
      const absolute = path.join(__dirname, '..', 'output', relative);
      return fs.existsSync(absolute) ? absolute : null;
    } catch {
      return null;
    }
  }

  /**
   * Envía un correo HTML con el contenido generado y botones de aprobación.
   * @param {object} post - El post guardado (con id, content, visuals, video, etc.)
   * @param {object} scheduleEntry - La entrada del calendario { day, hour, concept, format }
   */
  async sendApprovalEmail(post, scheduleEntry) {
    const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim();
    const adminEmail = process.env.ADMIN_EMAIL;

    if (!adminEmail || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_HOST) {
      console.warn('[ApprovalGateway] Credenciales SMTP no configuradas. Saltando envío de email.');
      return;
    }

    const approveUrl = `${serverUrl}/api/webhooks/approve/${post.id}`;
    const rejectUrl = `${serverUrl}/api/webhooks/reject/${post.id}`;

    const fbCopy = post.content?.facebook?.copy || post.content?.text || '';
    const igCopy = post.content?.instagram?.copy || '';
    const fbHash = post.content?.facebook?.hashtags || '';
    const igHash = post.content?.instagram?.hashtags || '';
    const hasCopy = fbCopy || igCopy;

    // --- Construir attachments e imágenes incrustadas ---
    const attachments = [];
    let imagesHtml = '';
    let videoHtml = '';

    // Procesar imágenes (carrusel o imagen única)
    const visuals = post.visuals || [];
    if (visuals.length > 0) {
      const isCarousel = visuals.length > 1;
      
      if (isCarousel) {
        imagesHtml += `
        <div style="background:#0a0a12;padding:20px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <p style="color:#e040fb;font-size:10px;letter-spacing:2px;margin:0 0 12px;text-align:center;">🎠 CARRUSEL (${visuals.length} SLIDES)</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">`;
      } else {
        imagesHtml += `
        <div style="background:#0a0a12;padding:20px;text-align:center;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">`;
      }

      visuals.forEach((visualUrl, index) => {
        const absPath = this._resolveFilePath(visualUrl);
        const cid = `visual_${index}_${Date.now()}`;
        const ext = absPath ? path.extname(absPath).toLowerCase().replace('.', '') : 'png';
        const mimeType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';

        if (absPath) {
          attachments.push({
            filename: path.basename(absPath),
            path: absPath,
            cid: cid,
            contentType: mimeType
          });

          if (isCarousel) {
            const slideWidth = visuals.length > 4 ? '140px' : '180px';
            imagesHtml += `
            <div style="text-align:center;">
              <img src="cid:${cid}" style="width:${slideWidth};border-radius:6px;border:1px solid #2a2a4a;" alt="Slide ${index + 1}">
              <p style="color:#556;font-size:9px;margin:4px 0 0;">Slide ${index + 1}</p>
            </div>`;
          } else {
            imagesHtml += `
          <img src="cid:${cid}" style="max-width:100%;border-radius:8px;border:2px solid #2a2a4a;" alt="Contenido generado">`;
          }
          console.log(`[ApprovalGateway] Imagen ${index + 1} incrustada: ${path.basename(absPath)}`);
        } else {
          // Fallback: usar URL directa si no se encuentra en disco
          const fullUrl = visualUrl.startsWith('http') ? visualUrl : `${serverUrl}${visualUrl.startsWith('/') ? '' : '/'}${visualUrl}`;
          if (isCarousel) {
            const slideWidth = visuals.length > 4 ? '140px' : '180px';
            imagesHtml += `
            <div style="text-align:center;">
              <img src="${fullUrl}" style="width:${slideWidth};border-radius:6px;border:1px solid #2a2a4a;" alt="Slide ${index + 1}">
              <p style="color:#556;font-size:9px;margin:4px 0 0;">Slide ${index + 1}</p>
            </div>`;
          } else {
            imagesHtml += `
          <img src="${fullUrl}" style="max-width:100%;border-radius:8px;border:2px solid #2a2a4a;" alt="Contenido generado">`;
          }
          console.warn(`[ApprovalGateway] Imagen ${index + 1} no encontrada en disco, usando URL: ${fullUrl}`);
        }
      });

      if (isCarousel) {
        imagesHtml += `
          </div>
        </div>`;
      } else {
        imagesHtml += `
        </div>`;
      }
    }

    // Procesar vídeo — solo mostrar enlace para abrir
    if (post.video && post.video.url) {
      const serverVideoUrl = post.video.url.startsWith('http') ? post.video.url : `${serverUrl}${post.video.url.startsWith('/') ? '' : '/'}${post.video.url}`;

      videoHtml = `
        <div style="background:#0d0d18;padding:25px;text-align:center;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <p style="color:#ff1744;font-size:10px;letter-spacing:2px;margin:0 0 15px;">🎬 VÍDEO / REEL GENERADO</p>
          <div style="background:rgba(255,23,68,0.08);border:1px solid rgba(255,23,68,0.3);border-radius:12px;padding:20px;">
            <div style="font-size:40px;margin-bottom:10px;">▶️</div>
            <a href="${serverVideoUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#ff1744,#ff5252);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:bold;font-size:14px;letter-spacing:1px;">VER VÍDEO</a>
          </div>
        </div>`;
    }

    const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px 16px 0 0;padding:30px;text-align:center;border:1px solid #2a2a4a;">
          <h1 style="color:#00d4ff;margin:0;font-size:24px;letter-spacing:2px;">🤖 AUTO-PILOT</h1>
          <p style="color:#8899aa;margin:8px 0 0;font-size:13px;letter-spacing:1px;">CONTENIDO LISTO PARA APROBACIÓN</p>
        </div>

        <!-- Info del Post -->
        <div style="background:#12121f;padding:25px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="color:#556;font-size:11px;padding:5px 0;letter-spacing:1px;">FORMATO</td>
              <td style="color:#fff;font-size:13px;padding:5px 0;text-align:right;">${(scheduleEntry.format || post.contentType || '').toUpperCase()}</td>
            </tr>
            <tr>
              <td style="color:#556;font-size:11px;padding:5px 0;letter-spacing:1px;">RATIO</td>
              <td style="color:#fff;font-size:13px;padding:5px 0;text-align:right;">${scheduleEntry.aspectRatio || post.aspectRatio || '1:1'}</td>
            </tr>
            <tr>
              <td style="color:#556;font-size:11px;padding:5px 0;letter-spacing:1px;">PUBLICACIÓN</td>
              <td style="color:#00d4ff;font-size:13px;padding:5px 0;text-align:right;">Día ${scheduleEntry.day} a las ${scheduleEntry.hour}</td>
            </tr>
            <tr>
              <td style="color:#556;font-size:11px;padding:5px 0;letter-spacing:1px;">CONCEPTO</td>
              <td style="color:#fff;font-size:13px;padding:5px 0;text-align:right;">${scheduleEntry.concept || 'Generación manual'}</td>
            </tr>
          </table>
        </div>

        ${hasCopy ? `
        <!-- Copy Facebook -->
        <div style="background:#0f0f1a;padding:25px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <p style="color:#00d4ff;font-size:10px;letter-spacing:2px;margin:0 0 12px;">📘 FACEBOOK</p>
          <p style="color:#ddd;font-size:14px;line-height:1.7;margin:0;">${fbCopy}</p>
          ${fbHash ? `<p style="color:#0095f6;font-size:12px;margin:10px 0 0;">${fbHash}</p>` : ''}
        </div>

        ${igCopy ? `
        <!-- Copy Instagram -->
        <div style="background:#0d0d18;padding:25px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <p style="color:#e040fb;font-size:10px;letter-spacing:2px;margin:0 0 12px;">📸 INSTAGRAM</p>
          <p style="color:#ddd;font-size:14px;line-height:1.7;margin:0;">${igCopy}</p>
          ${igHash ? `<p style="color:#e040fb;font-size:12px;margin:10px 0 0;">${igHash}</p>` : ''}
        </div>
        ` : ''}
        ` : ''}

        <!-- Contenido Visual (imágenes/vídeo) -->
        ${imagesHtml}
        ${videoHtml}

        <!-- Botones de Acción -->
        <div style="background:#12121f;padding:30px;text-align:center;border-radius:0 0 16px 16px;border:1px solid #2a2a4a;border-top:none;">
          <a href="${approveUrl}" style="display:inline-block;background:linear-gradient(135deg,#00c853,#00e676);color:#000;text-decoration:none;padding:16px 50px;border-radius:50px;font-weight:bold;font-size:16px;letter-spacing:1px;margin:0 10px;">
            ✅ APROBAR
          </a>
          <br><br>
          <a href="${rejectUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff1744,#ff5252);color:#fff;text-decoration:none;padding:12px 40px;border-radius:50px;font-weight:bold;font-size:13px;letter-spacing:1px;margin:0 10px;">
            ❌ RECHAZAR
          </a>
          <p style="color:#445;font-size:10px;margin:20px 0 0;letter-spacing:1px;">Si no respondes, el contenido NO se publicará.</p>
        </div>

      </div>
    </body>
    </html>
    `;

    try {
      const transporter = this._getTransporter();
      const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || 'AI Auto-Pilot'}" <${process.env.SMTP_USER}>`,
        to: adminEmail,
        subject: `📋 Aprobación requerida — Día ${scheduleEntry.day} [${(scheduleEntry.format || '').toUpperCase()}]`,
        html: htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined
      };

      await transporter.sendMail(mailOptions);
      console.log(`[ApprovalGateway] ✅ Email de aprobación enviado a ${adminEmail} (${attachments.length} imágenes incrustadas)`);
    } catch (error) {
      console.error('[ApprovalGateway] Error enviando email:', error.message);
    }
  }
}

module.exports = new ApprovalGateway();
