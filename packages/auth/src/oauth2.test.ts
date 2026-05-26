import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { A2AError } from '@reaatech/a2a-reference-core';
import { SignJWT, exportJWK, exportSPKI, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { OAuth2Strategy } from './oauth2.js';

function startTokenServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({ url: `http://localhost:${port}/token`, close: () => server.close() });
    });
  });
}

describe('OAuth2Strategy', () => {
  describe('authenticate', () => {
    it('rejects missing authorization header', async () => {
      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: 'dummy',
      });
      const result = await strategy.authenticate({ headers: {} });
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('missing token');
    });

    it('rejects non-bearer authorization header', async () => {
      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: 'dummy',
      });
      const result = await strategy.authenticate({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('invalid authorization header format');
    });

    it('rejects token when no verification key is configured', async () => {
      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.authenticate({
        headers: { authorization: 'Bearer some-token' },
      });
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('no verification key configured');
    });

    it('authenticates a valid JWT with publicKey', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const spki = await exportSPKI(publicKey);

      const token = await new SignJWT({ sub: 'user-123', scope: 'read write' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://issuer.example')
        .setAudience('https://api.example')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        audience: 'https://api.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: spki,
      });
      const result = await strategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      });

      expect(result.authenticated).toBe(true);
      expect(result.principal).toBe('user-123');
      expect(result.scopes).toEqual(['read', 'write']);
    });

    it('authenticates a valid JWT via jwksUri', async () => {
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
        .setIssuer('https://issuer.example')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        jwksUri,
      });
      const result = await strategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      });

      expect(result.authenticated).toBe(true);
      expect(result.principal).toBe('user-jwks');
      expect(result.scopes).toEqual(['read']);

      server.close();
    });

    it('rejects an expired JWT', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const spki = await exportSPKI(publicKey);

      const token = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://issuer.example')
        .setIssuedAt()
        .setExpirationTime('-1h')
        .sign(privateKey);

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: spki,
      });
      const result = await strategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      });

      expect(result.authenticated).toBe(false);
      expect(result.reason).toMatch(/oauth2 verification failed/);
    });

    it('rejects a malformed JWT', async () => {
      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: 'dummy',
      });
      const result = await strategy.authenticate({
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      expect(result.authenticated).toBe(false);
      expect(result.reason).toMatch(/oauth2 verification failed/);
    });

    it('handles array authorization header', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const spki = await exportSPKI(publicKey);

      const token = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://issuer.example')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret',
        publicKey: spki,
      });
      const result = await strategy.authenticate({
        headers: { authorization: [`Bearer ${token}`] },
      });

      expect(result.authenticated).toBe(true);
      expect(result.principal).toBe('user-123');
    });
  });

  describe('exchangeClientCredentials', () => {
    it('exchanges client credentials for a token', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        expect(req.method).toBe('POST');
        expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('grant_type')).toBe('client_credentials');
          expect(params.get('client_id')).toBe('client-1');
          expect(params.get('client_secret')).toBe('secret');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ access_token: 'access-123', token_type: 'Bearer', expires_in: 3600 }),
          );
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.exchangeClientCredentials();

      expect(result.accessToken).toBe('access-123');
      expect(result.expiresIn).toBe(3600);

      close();
    });

    it('passes scopes and audience when provided', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('scope')).toBe('read write');
          expect(params.get('audience')).toBe('https://api.example');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ access_token: 'access-456', token_type: 'Bearer', expires_in: 7200 }),
          );
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
        audience: 'https://api.example',
      });
      const result = await strategy.exchangeClientCredentials(['read', 'write']);

      expect(result.accessToken).toBe('access-456');
      expect(result.expiresIn).toBe(7200);

      close();
    });

    it('uses default scopes from options when none provided', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('scope')).toBe('default-scope');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'access-789', token_type: 'Bearer' }));
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
        scopes: ['default-scope'],
      });
      const result = await strategy.exchangeClientCredentials();

      expect(result.accessToken).toBe('access-789');

      close();
    });

    it('rejects non-Bearer token type in response', async () => {
      const { url, close } = await startTokenServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'access-tok', token_type: 'Mac' }));
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await expect(strategy.exchangeClientCredentials()).rejects.toThrow('Unexpected token type');

      close();
    });

    it('rejects missing access_token in response', async () => {
      const { url, close } = await startTokenServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token_type: 'Bearer' }));
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await expect(strategy.exchangeClientCredentials()).rejects.toThrow(A2AError);

      close();
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges authorization code for a token', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('grant_type')).toBe('authorization_code');
          expect(params.get('code')).toBe('auth-code-123');
          expect(params.get('redirect_uri')).toBe('https://example.com/callback');
          expect(params.get('client_id')).toBe('client-1');
          expect(params.get('client_secret')).toBe('secret');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'access-code-123',
              token_type: 'Bearer',
              refresh_token: 'refresh-123',
              expires_in: 3600,
            }),
          );
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.exchangeAuthorizationCode(
        'auth-code-123',
        'https://example.com/callback',
      );

      expect(result.accessToken).toBe('access-code-123');
      expect(result.refreshToken).toBe('refresh-123');
      expect(result.expiresIn).toBe(3600);

      close();
    });

    it('includes code_verifier when provided', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('code_verifier')).toBe('verifier-value');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'access-code-456', token_type: 'Bearer' }));
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.exchangeAuthorizationCode(
        'auth-code-456',
        'https://example.com/callback',
        'verifier-value',
      );

      expect(result.accessToken).toBe('access-code-456');

      close();
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes access token using a refresh token', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('grant_type')).toBe('refresh_token');
          expect(params.get('refresh_token')).toBe('old-refresh-token');
          expect(params.get('client_id')).toBe('client-1');
          expect(params.get('client_secret')).toBe('secret');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'new-access-token',
              token_type: 'Bearer',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
            }),
          );
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresIn).toBe(3600);

      close();
    });

    it('falls back to original refresh token when response omits it', async () => {
      const { url, close } = await startTokenServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'new-access', token_type: 'Bearer' }));
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      const result = await strategy.refreshAccessToken('fallback-refresh');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('fallback-refresh');

      close();
    });

    it('passes scopes when provided', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('scope')).toBe('read write');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }));
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await strategy.refreshAccessToken('some-refresh', ['read', 'write']);

      close();
    });

    it('does not pass scope when scopes array is empty', async () => {
      const { url, close } = await startTokenServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          expect(params.get('scope')).toBeNull();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }));
        });
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await strategy.refreshAccessToken('some-refresh', []);

      close();
    });
  });

  describe('fetch error handling', () => {
    it('throws on non-ok token response', async () => {
      const { url, close } = await startTokenServer((_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await expect(strategy.exchangeClientCredentials()).rejects.toThrow(
        'token request failed with status 400',
      );

      close();
    });

    it('throws on invalid response JSON', async () => {
      const { url, close } = await startTokenServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('not-json');
      });

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
      });
      await expect(strategy.exchangeClientCredentials()).rejects.toThrow();

      close();
    });
  });

  describe('fetch timeout', () => {
    it('aborts when token endpoint does not respond within timeout', async () => {
      const server = createServer(() => {
        // Accept connection but never respond
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port;
      const url = `http://localhost:${port}/token`;

      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: url,
        clientId: 'client-1',
        clientSecret: 'secret',
        fetchTimeoutMs: 100,
      });

      await expect(strategy.exchangeClientCredentials()).rejects.toThrow();

      server.close();
    });
  });

  describe('toJSON', () => {
    it('returns sanitized options with masked clientSecret', () => {
      const strategy = new OAuth2Strategy({
        issuer: 'https://issuer.example',
        tokenEndpoint: 'https://example.com/token',
        clientId: 'client-1',
        clientSecret: 'supersecret',
        scopes: ['read', 'write'],
        fetchTimeoutMs: 5000,
      });

      const json = strategy.toJSON();

      expect(json.clientSecret).toBe('***');
      expect(json.clientId).toBe('client-1');
      expect(json.issuer).toBe('https://issuer.example');
      expect(json.tokenEndpoint).toBe('https://example.com/token');
      expect(json.scopes).toEqual(['read', 'write']);
      expect(json.fetchTimeoutMs).toBe(5000);
    });
  });
});
