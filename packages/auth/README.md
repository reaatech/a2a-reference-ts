# @reaatech/a2a-reference-auth

Pluggable authentication and authorization for A2A agents.

## Strategies

### NoneStrategy
For development and open agents:
```ts
const auth = new NoneStrategy();
```

### ApiKeyStrategy
Header-based API key validation:
```ts
const auth = new ApiKeyStrategy({ keys: new Set(['sk-1234']) });
```

### JwtStrategy
RS256 JWT Bearer token validation with JWKS support:
```ts
const auth = new JwtStrategy({
  issuer: 'https://auth.example.com',
  audience: 'my-agent',
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
});
```

### OAuth2Strategy
Full OAuth2 flow for production deployments:
```ts
const auth = new OAuth2Strategy({
  issuer: 'https://auth.example.com',
  tokenEndpoint: 'https://auth.example.com/oauth/token',
  clientId: 'my-agent',
  clientSecret: process.env.CLIENT_SECRET,
  scopes: ['a2a:tasks'],
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
});

// Server-to-server auth
const { accessToken } = await auth.exchangeClientCredentials();

// User-facing auth
const { accessToken, refreshToken } = await auth.exchangeAuthorizationCode(code, redirectUri);

// Token refresh
const { accessToken } = await auth.refreshAccessToken(refreshToken);
```

## Utilities

```ts
import { extractScopes } from '@reaatech/a2a-reference-auth';

const scopes = extractScopes({ scope: 'read write admin' });
// ['read', 'write', 'admin']
```
