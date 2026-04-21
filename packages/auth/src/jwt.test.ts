import { createServer } from 'node:http';
import { SignJWT, exportJWK, exportSPKI, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtStrategy } from './jwt.js';

describe('JwtStrategy', () => {
  it('rejects missing authorization header', async () => {
    const strategy = new JwtStrategy({});
    const result = await strategy.authenticate({ headers: {} });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe('missing token');
  });

  it('rejects non-bearer authorization header', async () => {
    const strategy = new JwtStrategy({});
    const result = await strategy.authenticate({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe('invalid format');
  });

  it('rejects invalid token when no public key is configured', async () => {
    const strategy = new JwtStrategy({});
    const result = await strategy.authenticate({
      headers: { authorization: 'Bearer invalid-token' },
    });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe('no verification key configured');
  });

  it('authenticates a valid JWT', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const spki = await exportSPKI(publicKey);

    const token = await new SignJWT({ sub: 'user-123', scope: 'read write' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const strategy = new JwtStrategy({ publicKey: spki });
    const result = await strategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.authenticated).toBe(true);
    expect(result.principal).toBe('user-123');
    expect(result.scopes).toEqual(['read', 'write']);
  });

  it('rejects an expired JWT', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const spki = await exportSPKI(publicKey);

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('-1h')
      .sign(privateKey);

    const strategy = new JwtStrategy({ publicKey: spki });
    const result = await strategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.authenticated).toBe(false);
    expect(result.reason).toMatch(/verification failed/);
  });

  it('extracts array scopes from payload', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const spki = await exportSPKI(publicKey);

    const token = await new SignJWT({ sub: 'user-123', scope: ['admin', 'read'] })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const strategy = new JwtStrategy({ publicKey: spki });
    const result = await strategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.scopes).toEqual(['admin', 'read']);
  });

  it('handles array authorization header', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const spki = await exportSPKI(publicKey);

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const strategy = new JwtStrategy({ publicKey: spki });
    const result = await strategy.authenticate({
      headers: { authorization: [`Bearer ${token}`] },
    });

    expect(result.authenticated).toBe(true);
  });

  it('authenticates a valid JWT via JWKS', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    const jwks = { keys: [jwk] };

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jwks));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'string' ? 0 : address?.port;
    const jwksUri = `http://localhost:${port}/.well-known/jwks.json`;

    const token = await new SignJWT({ sub: 'user-jwks', scope: 'read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const strategy = new JwtStrategy({ jwksUri });
    const result = await strategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.authenticated).toBe(true);
    expect(result.principal).toBe('user-jwks');
    expect(result.scopes).toEqual(['read']);

    server.close();
  });

  it('rejects invalid token via JWKS', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    const jwks = { keys: [jwk] };

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jwks));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'string' ? 0 : address?.port;
    const jwksUri = `http://localhost:${port}/.well-known/jwks.json`;

    const strategy = new JwtStrategy({ jwksUri });
    const result = await strategy.authenticate({
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(result.authenticated).toBe(false);
    expect(result.reason).toMatch(/verification failed/);

    server.close();
  });
});
