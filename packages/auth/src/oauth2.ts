import { A2AError } from '@reaatech/a2a-reference-core';
import { type Logger, defaultLogger } from '@reaatech/a2a-reference-observability';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { z } from 'zod';
import type { AuthContext, AuthResult, AuthStrategy } from './strategy.js';
import { extractScopes } from './utils.js';

export interface OAuth2StrategyOptions {
  issuer: string;
  tokenEndpoint: string;
  authorizationEndpoint?: string;
  clientId: string;
  /** Sensitive — avoid logging or serializing this value. */
  clientSecret: string;
  scopes?: string[];
  audience?: string;
  jwksUri?: string;
  publicKey?: string;
  algorithm?: string;
  fetchTimeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

const ZodTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type: string;
}

function parseTokenResponse(data: unknown): TokenResponse {
  const result = ZodTokenResponse.safeParse(data);
  if (!result.success) {
    throw new A2AError(
      'InvalidTokenResponse',
      `OAuth2 token response validation failed: ${result.error.message}`,
    );
  }
  const { access_token, token_type, expires_in, refresh_token } = result.data;
  // RFC 6749 §7.1 defines token_type as case-insensitive.
  if (token_type.toLowerCase() !== 'bearer') {
    throw new A2AError('InvalidTokenType', `Unexpected token type: ${token_type}`);
  }
  return { access_token, expires_in, refresh_token, token_type };
}

export type OAuth2ClientCredentialsGrantRequest = {
  grant_type: 'client_credentials';
  client_id: string;
  client_secret: string;
  scope?: string;
  audience?: string;
};

export type OAuth2AuthorizationCodeGrantRequest = {
  grant_type: 'authorization_code';
  code: string;
  redirect_uri: string;
  client_id: string;
  client_secret: string;
  code_verifier?: string;
};

export class OAuth2Strategy implements AuthStrategy {
  private jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
  private fetchTimeoutMs: number;
  private logger: Logger;

  constructor(private options: OAuth2StrategyOptions) {
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.logger = options.logger ?? defaultLogger;
    if (options.jwksUri) {
      try {
        this.jwksCache = createRemoteJWKSet(new URL(options.jwksUri));
      } catch (err) {
        throw new A2AError(
          'InvalidJwksUri',
          `Invalid jwksUri: ${options.jwksUri} — must be a valid URL`,
        );
      }
    }
  }

  toJSON(): Omit<OAuth2StrategyOptions, 'clientSecret'> & { clientSecret: '***' } {
    const { clientSecret: _, ...rest } = this.options;
    return { ...rest, clientSecret: '***' };
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    const authHeader = context.headers.authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue) {
      return { authenticated: false, reason: 'missing token' };
    }

    if (!headerValue.toLowerCase().startsWith('bearer ')) {
      return { authenticated: false, reason: 'invalid authorization header format' };
    }

    const token = headerValue.slice(7).trim();

    if (!this.options.jwksUri && !this.options.publicKey) {
      return { authenticated: false, reason: 'no verification key configured' };
    }

    try {
      let jwtPayload: JWTPayload;

      if (this.options.publicKey) {
        const key = await importSPKI(this.options.publicKey, this.options.algorithm ?? 'RS256');
        const result = await jwtVerify(token, key, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
        jwtPayload = result.payload;
      } else if (this.jwksCache) {
        const result = await jwtVerify(token, this.jwksCache, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
        jwtPayload = result.payload;
      } else {
        return { authenticated: false, reason: 'no verification key configured' };
      }

      if (typeof jwtPayload.sub !== 'string' || !jwtPayload.sub.trim()) {
        return { authenticated: false, reason: 'missing or invalid sub claim' };
      }
      const sub = jwtPayload.sub;
      const scopes = extractScopes(jwtPayload as Record<string, unknown>);

      return { authenticated: true, principal: sub, scopes };
    } catch (err) {
      this.logger.error({ err }, 'oauth2 verification failed');
      return { authenticated: false, reason: 'oauth2 verification failed' };
    }
  }

  async exchangeClientCredentials(
    scopes?: string[],
  ): Promise<{ accessToken: string; expiresIn?: number }> {
    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', this.options.clientId);
    params.set('client_secret', this.options.clientSecret);
    const scope = scopes !== undefined ? scopes.join(' ') : this.options.scopes?.join(' ');
    if (scope) params.set('scope', scope);
    if (this.options.audience) params.set('audience', this.options.audience);

    const data = await this.fetchToken(params);
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    };

    if (codeVerifier) {
      body.code_verifier = codeVerifier;
    }

    const data = await this.fetchToken(new URLSearchParams(body));
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshAccessToken(
    refreshToken: string,
    scopes?: string[],
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      refresh_token: refreshToken,
    };

    if (scopes?.length) {
      body.scope = scopes.join(' ');
    }

    const data = await this.fetchToken(new URLSearchParams(body));
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresIn: data.expires_in,
    };
  }

  private async fetchToken(body: URLSearchParams): Promise<TokenResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await fetch(this.options.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.logger.error({ body: errorBody }, 'oauth2 token request failed');
        throw new A2AError(
          'TokenRequestFailed',
          `token request failed with status ${response.status}`,
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new A2AError('InvalidTokenResponse', 'failed to parse token response body');
      }
      return parseTokenResponse(raw);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
