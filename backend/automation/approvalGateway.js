const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

/**
 * Pasarela de Aprobación Human-in-the-Loop.
 * Envía correos HTML interactivos con botones de Aprobar/Rechazar.
 */
class ApprovalGateway {
  constructor() {
    this.transporter = null;
  }

  _getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
    return this.transporter;
  }

  /**
   * Envía un correo HTML con el contenido generado y botones de aprobación.
   * @param {object} post - El post guardado (con id, content, visuals, etc.)
   * @param {object} scheduleEntry - La entrada del calendario { day, hour, concept, format }
   */
  async sendApprovalEmail(post, scheduleEntry) {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
    const adminEmail = process.env.ADMIN_EMAIL;

    if (!adminEmail || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn('[ApprovalGateway] Credenciales SMTP no configuradas. Saltando envío de email.');
      return;
    }

    const approveUrl = `${serverUrl}/api/webhooks/approve/${post.id}`;
    const rejectUrl = `${serverUrl}/api/webhooks/reject/${post.id}`;

    const fbCopy = post.content?.facebook?.copy || post.content?.text || '';
    const igCopy = post.content?.instagram?.copy || '';
    const fbHash = post.content?.facebook?.hashtags || '';
    const igHash = post.content?.instagram?.hashtags || '';
    const imageUrl = post.visuals?.[0] || '';

    const hasCopy = fbCopy || igCopy;

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

        ${imageUrl ? `
        <!-- Imagen -->
        <div style="background:#0a0a12;padding:20px;text-align:center;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
          <img src="${imageUrl}" style="max-width:100%;border-radius:8px;border:2px solid #2a2a4a;" alt="Contenido generado">
        </div>
        ` : ''}

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
      await transporter.sendMail({
        from: `"🤖 AI Auto-Pilot" <${process.env.SMTP_USER}>`,
        to: adminEmail,
        subject: `📋 Aprobación requerida — Día ${scheduleEntry.day} [${(scheduleEntry.format || '').toUpperCase()}]`,
        html: htmlBody
      });
      console.log(`[ApprovalGateway] ✅ Email de aprobación enviado a ${adminEmail}`);
    } catch (error) {
      console.error('[ApprovalGateway] Error enviando email:', error.message);
    }
  }
}

module.exports = new ApprovalGateway();
