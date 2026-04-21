import { type JWTVerifyResult, createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { AuthContext, AuthResult, AuthStrategy } from './strategy.js';

export interface JwtStrategyOptions {
  issuer?: string;
  audience?: string;
  publicKey?: string;
  jwksUri?: string;
}

export class JwtStrategy implements AuthStrategy {
  constructor(private options: JwtStrategyOptions) {}

  async authenticate(context: AuthContext): Promise<AuthResult> {
    const authHeader = context.headers.authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue) {
      return { authenticated: false, reason: 'missing token' };
    }

    if (!headerValue.startsWith('Bearer ')) {
      return { authenticated: false, reason: 'invalid format' };
    }

    const token = headerValue.slice(7);

    if (!this.options.publicKey && !this.options.jwksUri) {
      return { authenticated: false, reason: 'no verification key configured' };
    }

    try {
      let result: JWTVerifyResult;

      if (this.options.publicKey) {
        const key = await importSPKI(this.options.publicKey, 'RS256');
        result = await jwtVerify(token, key, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
      } else if (this.options.jwksUri) {
        const jwks = createRemoteJWKSet(new URL(this.options.jwksUri));
        result = await jwtVerify(token, jwks, {
          issuer: this.options.issuer,
          audience: this.options.audience,
        });
      } else {
        return { authenticated: false, reason: 'no verification key configured' };
      }

      const sub = result.payload.sub ?? 'unknown';
      const scopes = this.extractScopes(result.payload);
      return { authenticated: true, principal: sub, scopes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { authenticated: false, reason: `verification failed: ${message}` };
    }
  }

  private extractScopes(payload: Record<string, unknown>): string[] | undefined {
    const scope = payload.scope;
    if (typeof scope === 'string') {
      return scope.split(' ');
    }
    if (Array.isArray(scope)) {
      return scope.filter((s): s is string => typeof s === 'string');
    }
    return undefined;
  }
}
