const dns = require('dns').promises;
const net = require('net');

/**
 * Política de seguridad estricta para navegación y análisis web (Anti-SSRF).
 * Basado en las recomendaciones OWASP SSRF Prevention Cheat Sheet.
 */
class PublicWebPolicy {
  constructor(options = {}) {
    this.allowedPorts = new Set(options.allowedPorts || [80, 443]);
    this.maxRedirects = options.maxRedirects || 5;
    this.allowLocalFixtures = Boolean(options.allowLocalFixtures);
  }

  /**
   * Comprueba si una dirección IP (IPv4 o IPv6) es privada, loopback o reservada.
   * @param {string} ip
   * @returns {boolean}
   */
  isPrivateOrReservedIp(ip) {
    if (!ip || typeof ip !== 'string') return true;

    // IPv4
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(p => parseInt(p, 10));
      if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;

      // 0.0.0.0/8 (red actual)
      if (parts[0] === 0) return true;
      // 10.0.0.0/8 (RFC 1918 privada)
      if (parts[0] === 10) return true;
      // 100.64.0.0/10 (Carrier-grade NAT)
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
      // 127.0.0.0/8 (Loopback)
      if (parts[0] === 127) return true;
      // 169.254.0.0/16 (Link-local y Cloud Metadata 169.254.169.254)
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 172.16.0.0/12 (RFC 1918 privada: 172.16 - 172.31)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.0.0.0/24 (IETF Protocol Assignments)
      if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
      // 192.0.2.0/24 (TEST-NET-1)
      if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
      // 192.168.0.0/16 (RFC 1918 privada)
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 198.18.0.0/15 (Benchmarking)
      if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
      // 198.51.100.0/24 (TEST-NET-2)
      if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
      // 203.0.113.0/24 (TEST-NET-3)
      if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
      // 224.0.0.0/4 (Multicast)
      if (parts[0] >= 224 && parts[0] <= 239) return true;
      // 240.0.0.0/4 (Reservado)
      if (parts[0] >= 240) return true;
      // 255.255.255.255 (Broadcast)
      if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;

      return false;
    }

    // IPv6
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      // Loopback ::1
      if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
      // Unspecified ::
      if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
      // IPv4-mapped ::ffff:127.0.0.1
      if (lower.startsWith('::ffff:') || lower.startsWith('0:0:0:0:0:ffff:')) {
        const lastPart = lower.split(':').pop();
        if (net.isIPv4(lastPart)) {
          return this.isPrivateOrReservedIp(lastPart);
        }
      }
      // Unique local fe80::/10 (Link-local)
      if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
      // Unique local fc00::/7 (ULA)
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      // Multicast ff00::/8
      if (lower.startsWith('ff')) return true;

      return false;
    }

    return true;
  }

  /**
   * Normaliza y valida sintácticamente una URL.
   * @param {string} rawUrl
   * @returns {URL}
   */
  parseAndValidateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('La URL es requerida y debe ser un texto válido.');
    }

    let urlString = rawUrl.trim();
    // Si no contiene un esquema explícito (foo://), asumimos https://
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(urlString) && !/^[a-zA-Z]+:/i.test(urlString)) {
      urlString = 'https://' + urlString;
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new Error(`URL malformada o inválida: ${rawUrl}`);
    }

    // 1. Esquema permitido estrictamente http o https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Esquema no permitido (${parsed.protocol}). Solo se admite http: o https:.`);
    }

    // 2. Bloquear credenciales en URL
    if (parsed.username || parsed.password) {
      throw new Error('No se permiten credenciales embebidas (username/password) en la URL.');
    }

    // 3. Validar puerto
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    if (!this.allowLocalFixtures && !this.allowedPorts.has(port)) {
      throw new Error(`Puerto no permitido (${port}). Solo se admiten puertos estándar (80, 443).`);
    }

    // 4. Bloquear localhost y nombres sospechosos
    const hostname = parsed.hostname.toLowerCase();
    if (!this.allowLocalFixtures) {
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === 'metadata.google.internal' ||
        hostname === 'instance-data'
      ) {
        throw new Error(`El destino ${hostname} es una dirección local o interna no permitida.`);
      }
    }

    return parsed;
  }

  /**
   * Valida una URL resolviendo su IP por DNS y verificando que no sea privada ni reservada.
   * Protege contra SSRF y DNS Rebinding.
   * @param {string} rawUrl
   * @returns {Promise<{ validUrl: string, parsed: URL, resolvedIp: string }>}
   */
  async validateTargetUrl(rawUrl) {
    const parsed = this.parseAndValidateUrl(rawUrl);
    const hostname = parsed.hostname;

    // En modo pruebas locales expreso (allowLocalFixtures: true), permitimos localhost / 127.0.0.1
    if (this.allowLocalFixtures && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
      return {
        validUrl: parsed.href,
        parsed,
        resolvedIp: '127.0.0.1'
      };
    }

    // Si el hostname es directamente una IP literal:
    if (net.isIP(hostname)) {
      if (this.isPrivateOrReservedIp(hostname)) {
        throw new Error(`La IP de destino (${hostname}) pertenece a una red privada o restringida.`);
      }
      return {
        validUrl: parsed.href,
        parsed,
        resolvedIp: hostname
      };
    }

    // Resolución DNS
    let addresses;
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch (dnsErr) {
      throw new Error(`No se pudo resolver el dominio ${hostname}: ${dnsErr.message}`);
    }

    if (!addresses || addresses.length === 0) {
      throw new Error(`El dominio ${hostname} no resolvió ninguna dirección IP.`);
    }

    // Comprobar que NINGUNA de las direcciones resueltas apunte a rangos privados o de metadata
    for (const record of addresses) {
      if (this.isPrivateOrReservedIp(record.address)) {
        throw new Error(
          `Seguridad: El dominio ${hostname} resolvió a una dirección privada/restringida (${record.address}). Solicitud bloqueada.`
        );
      }
    }

    return {
      validUrl: parsed.href,
      parsed,
      resolvedIp: addresses[0].address
    };
  }
}

module.exports = PublicWebPolicy;
