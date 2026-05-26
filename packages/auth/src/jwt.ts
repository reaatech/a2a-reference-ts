import { A2AError } from '@reaatech/a2a-reference-core';
import { type Logger, defaultLogger } from '@reaatech/a2a-reference-observability';
import { type JWTVerifyResult, createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { AuthContext, AuthResult, AuthStrategy } from './strategy.js';
import { extractScopes } from './utils.js';

export interface JwtStrategyOptions {
  issuer?: string;
  audience?: string;
  publicKey?: string;
  jwksUri?: string;
  algorithm?: string;
  logger?: Logger;
}

export class JwtStrategy implements AuthStrategy {
  private jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

  private algorithm: string;
  private logger: Logger;

  constructor(private options: JwtStrategyOptions) {
    this.algorithm = options.algorithm ?? 'RS256';
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

  async authenticate(context: AuthContext): Promise<AuthResult> {
    const authHeader = context.headers.authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue) {
      return { authenticated: false, reason: 'missing token' };
    }

    if (!headerValue.toLowerCase().startsWith('bearer ')) {
      return { authenticated: false, reason: 'invalid format' };
    }

    const token = headerValue.slice(7).trim();

    if (!this.options.publicKey && !this.jwksCache) {
      return { authenticated: false, reason: 'no verification key configured' };
    }

    try {
      let result: JWTVerifyResult;

      if (this.options.publicKey) {
        const key = await importSPKI(this.options.publicKey, this.algorithm);
        result = await jwtVerify(token, key, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
      } else if (this.jwksCache) {
        result = await jwtVerify(token, this.jwksCache, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
      } else {
        return { authenticated: false, reason: 'no verification key configured' };
      }

      const sub = result.payload.sub ?? 'unknown';
      const scopes = extractScopes(result.payload as Record<string, unknown>);
      return { authenticated: true, principal: sub, scopes };
    } catch (err) {
      this.logger.error({ err }, 'jwt verification failed');
      return { authenticated: false, reason: 'jwt verification failed' };
    }
  }
}
