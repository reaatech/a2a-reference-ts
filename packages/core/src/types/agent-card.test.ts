import { describe, expect, it } from 'vitest';
import { AgentCardSchema, SecuritySchemeSchema } from './agent-card.js';

const validAgentCard = {
  name: 'Calculator Agent',
  description: 'Performs arithmetic calculations',
  url: 'http://localhost:3000',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'calculate',
      name: 'Calculate',
      description: 'Evaluate a mathematical expression',
      tags: ['math', 'calculation'],
    },
  ],
  supportedInterfaces: [
    {
      url: 'http://localhost:3000',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

describe('AgentCardSchema', () => {
  it('validates a correct agent card', () => {
    const result = AgentCardSchema.safeParse(validAgentCard);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = AgentCardSchema.safeParse({
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = AgentCardSchema.safeParse({
      ...validAgentCard,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('validates a card with spec-compliant securitySchemes', () => {
    const result = AgentCardSchema.safeParse({
      ...validAgentCard,
      securitySchemes: {
        apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        bearer: { type: 'http', scheme: 'Bearer', bearerFormat: 'JWT' },
        mtls: { type: 'mutualTLS', description: 'client certificate required' },
        oidc: {
          type: 'openIdConnect',
          openIdConnectUrl: 'https://issuer.example.com/.well-known/openid-configuration',
        },
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              tokenUrl: 'https://issuer.example.com/token',
              scopes: { 'tasks:read': 'Read tasks' },
            },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('SecuritySchemeSchema', () => {
  it('discriminates on the `type` field', () => {
    expect(SecuritySchemeSchema.safeParse({ type: 'mutualTLS' }).success).toBe(true);
    expect(SecuritySchemeSchema.safeParse({ type: 'http', scheme: 'Bearer' }).success).toBe(true);
  });

  it('rejects the legacy `scheme` discriminator and `httpScheme` field', () => {
    expect(
      SecuritySchemeSchema.safeParse({ scheme: 'apiKey', name: 'k', in: 'header' }).success,
    ).toBe(false);
    expect(SecuritySchemeSchema.safeParse({ type: 'http', httpScheme: 'bearer' }).success).toBe(
      false,
    );
  });

  it('requires tokenUrl and scopes inside an oauth2 flow', () => {
    expect(
      SecuritySchemeSchema.safeParse({
        type: 'oauth2',
        flows: { clientCredentials: { scopes: {} } },
      }).success,
    ).toBe(false);
  });
});
