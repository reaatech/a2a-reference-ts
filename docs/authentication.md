# Authentication Guide

## Supported Strategies

### None (Development / Open Agents)
```ts
import { NoneStrategy } from '@a2a-ref/auth';
const auth = new NoneStrategy();
```
Use `NoneStrategy` for local development or when the agent is intentionally public.

### API Key
```ts
import { ApiKeyStrategy } from '@a2a-ref/auth';
const auth = new ApiKeyStrategy({ keys: new Set(['secret']) });
```

### JWT (RS256)
```ts
import { JwtStrategy } from '@a2a-ref/auth';
const auth = new JwtStrategy({ publicKey: '-----BEGIN PUBLIC KEY-----...' });
```

### JWT with JWKS
```ts
const auth = new JwtStrategy({ jwksUri: 'https://auth.example.com/.well-known/jwks.json' });
```

## OAuth2

`OAuth2Strategy` is **not yet implemented**. If you need OAuth2 Bearer token validation, use `JwtStrategy` with a `jwksUri` instead. It handles RS256 JWTs issued by most OAuth2 providers.

## Wiring into Server
```ts
import { createA2AExpressApp } from '@a2a-ref/server';
const app = createA2AExpressApp({ agentCard, executor, authStrategy: auth });
```

## Tenant Isolation

Tenant isolation (path-param based `tenant` scoping) is **not yet implemented**. All tasks currently share a single namespace per deployment.
