import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type {
  AgentExecutor,
  ExecutionContext,
  ExecutionEventBus,
} from '@reaatech/a2a-reference-server';

const agentCard = {
  name: 'Hello Agent',
  description: 'A friendly agent that echoes your message back',
  url: 'http://localhost:3000',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echo a message back to the user',
      tags: ['echo', 'hello'],
      examples: ['Hello!', 'How are you?', 'Echo this back'],
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

const executor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');

    eventBus.emitStatusUpdate({
      kind: 'status',
      status: { state: 'working' },
    });

    eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        name: 'response',
        parts: [{ kind: 'text', text: `Hello! You said: "${text}"` }],
      },
    });

    eventBus.emitStatusUpdate({
      kind: 'status',
      status: { state: 'completed' },
    });
  },
};

const app = createA2AExpressApp({ agentCard, executor });

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Hello Agent running at http://localhost:${PORT}`);
  console.log(`Agent Card: http://localhost:${PORT}/.well-known/agent.json`);
});
