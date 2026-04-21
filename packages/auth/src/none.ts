import type { AuthContext, AuthResult, AuthStrategy } from './strategy.js';

export class NoneStrategy implements AuthStrategy {
  async authenticate(_context: AuthContext): Promise<AuthResult> {
    return { authenticated: true, principal: 'anonymous' };
  }
}
