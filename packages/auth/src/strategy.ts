export interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
}

export interface AuthResult {
  authenticated: boolean;
  principal?: string;
  scopes?: string[];
  reason?: string;
}

export interface AuthStrategy {
  authenticate(context: AuthContext): Promise<AuthResult>;
}
