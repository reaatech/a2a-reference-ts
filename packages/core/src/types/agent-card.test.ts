import { describe, expect, it } from 'vitest';
import { AgentCardSchema } from './agent-card.js';

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
});
