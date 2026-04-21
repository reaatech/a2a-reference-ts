import type { AuthContext, AuthResult, AuthStrategy } from './strategy.js';

export interface ApiKeyStrategyOptions {
  keys: Set<string>;
  headerName?: string;
}

export class ApiKeyStrategy implements AuthStrategy {
  private headerName: string;

  constructor(private options: ApiKeyStrategyOptions) {
    this.headerName = options.headerName ?? 'x-api-key';
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    const headerValue = context.headers[this.headerName.toLowerCase()];
    const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!key) {
      return { authenticated: false, reason: 'missing api key' };
    }

    if (this.options.keys.has(key)) {
      return { authenticated: true, principal: `api-key:${key.slice(0, 8)}...` };
    }

    return { authenticated: false, reason: 'invalid api key' };
  }
}
