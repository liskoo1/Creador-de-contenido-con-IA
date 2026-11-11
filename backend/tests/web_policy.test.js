const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const PublicWebPolicy = require('../services/publicWebPolicy');

describe('SEC-001: Política de Seguridad Web y Protección Anti-SSRF', () => {
  const policy = new PublicWebPolicy();

  test('a) Normaliza URLs sin esquema agregando https://', () => {
    const parsed = policy.parseAndValidateUrl('helpmeagro.com');
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'helpmeagro.com');
  });

  test('b) Rechaza esquemas no permitidos (file, ftp, javascript, data)', () => {
    assert.throws(() => policy.parseAndValidateUrl('file:///etc/passwd'), /Esquema no permitido/);
    assert.throws(() => policy.parseAndValidateUrl('ftp://ftp.example.com'), /Esquema no permitido/);
    assert.throws(() => policy.parseAndValidateUrl('javascript:alert(1)'), /Esquema no permitido/);
  });

  test('c) Bloquea URLs con credenciales embebidas (user:pass)', () => {
    assert.throws(
      () => policy.parseAndValidateUrl('https://admin:secret@example.com'),
      /No se permiten credenciales embebidas/
    );
  });

  test('d) Bloquea puertos no estándar (ej: 22, 3000, 8080) por defecto', () => {
    assert.throws(() => policy.parseAndValidateUrl('https://example.com:8080'), /Puerto no permitido/);
    assert.throws(() => policy.parseAndValidateUrl('http://example.com:3001'), /Puerto no permitido/);
    // Puertos 80 y 443 sí permitidos
    const p80 = policy.parseAndValidateUrl('http://example.com:80');
    assert.equal(p80.protocol, 'http:');
    const p443 = policy.parseAndValidateUrl('https://example.com:443');
    assert.equal(p443.protocol, 'https:');
  });

  test('e) Detecta y bloquea direcciones IP privadas y loopback (IPv4 e IPv6)', () => {
    assert.equal(policy.isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(policy.isPrivateOrReservedIp('10.0.1.5'), true);
    assert.equal(policy.isPrivateOrReservedIp('192.168.1.1'), true);
    assert.equal(policy.isPrivateOrReservedIp('172.16.0.10'), true);
    assert.equal(policy.isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(policy.isPrivateOrReservedIp('::1'), true);
    assert.equal(policy.isPrivateOrReservedIp('fe80::1'), true);
    assert.equal(policy.isPrivateOrReservedIp('::ffff:127.0.0.1'), true);

    // IPs públicas válidas
    assert.equal(policy.isPrivateOrReservedIp('8.8.8.8'), false);
    assert.equal(policy.isPrivateOrReservedIp('1.1.1.1'), false);
  });

  test('f) Bloquea localhost y dominios de metadata en validateTargetUrl', async () => {
    await assert.rejects(
      async () => await policy.validateTargetUrl('http://localhost'),
      /dirección local o interna no permitida/
    );
    await assert.rejects(
      async () => await policy.validateTargetUrl('http://127.0.0.1'),
      /red privada o restringida/
    );
    await assert.rejects(
      async () => await policy.validateTargetUrl('http://169.254.169.254'),
      /red privada o restringida/
    );
  });

  test('g) Permite localhost únicamente cuando allowLocalFixtures está explícitamente activado', async () => {
    const testPolicy = new PublicWebPolicy({ allowLocalFixtures: true, allowedPorts: [80, 443, 3001] });
    const result = await testPolicy.validateTargetUrl('http://localhost:3001/test');
    assert.equal(result.validUrl, 'http://localhost:3001/test');
    assert.equal(result.resolvedIp, '127.0.0.1');
  });
});
