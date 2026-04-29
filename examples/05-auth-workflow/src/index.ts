import { ApiKeyStrategy } from '@reaatech/a2a-reference-auth';
import { A2AClient } from '@reaatech/a2a-reference-client';
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from '@reaatech/a2a-reference-server';

const apiKey = 'secret-api-key-12345';

const authStrategy = new ApiKeyStrategy({
  keys: new Set([apiKey]),
  headerName: 'x-api-key',
});

const agentCard = {
  name: 'Protected Agent',
  description: 'An A2A agent protected by API key authentication',
  url: 'http://localhost:3006',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'echo', name: 'Echo', description: 'Echo back authenticated messages', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:3006',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const executor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        name: 'echo',
        parts: [{ kind: 'text', text: `Authenticated echo: ${text}` }],
      },
    });
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

const app = createA2AExpressApp({ agentCard, executor, authStrategy });
app.listen(3006, async () => {
  console.log('Protected Agent on http://localhost:3006');
  console.log('');

  // Demonstrate unauthorized request
  const unauthorizedClient = new A2AClient({ baseUrl: 'http://localhost:3006' });
  try {
    await unauthorizedClient.getAgentCard();
  } catch {
    console.log('Unauthorized request rejected (as expected)');
  }

  // Demonstrate authorized request
  const authorizedClient = new A2AClient({
    baseUrl: 'http://localhost:3006',
    fetchImpl: (url, init) =>
      globalThis.fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          'x-api-key': apiKey,
        },
      }),
  });

  try {
    const card = await authorizedClient.getAgentCard();
    console.log('Authorized request succeeded:', card.name);
    const task = await authorizedClient.sendMessage({
      messageId: 'auth-demo-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello, secure world!' }],
    });
    console.log('Task created:', task.id, 'state:', task.status.state);
  } catch (err) {
    console.error('Authorized request failed:', err);
  }
});
