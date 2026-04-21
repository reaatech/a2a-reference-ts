import { A2AClient } from '@a2a-ref/client';
import { createA2AExpressApp } from '@a2a-ref/server';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from '@a2a-ref/server';

const agentCard = {
  name: 'Streaming Counter',
  description: 'Counts to a target number with live progress streaming',
  url: 'http://localhost:3005',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'count', name: 'Count', description: 'Count with progress updates', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:3005',
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
    const target = Number.parseInt(text, 10) || 5;

    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });

    for (let i = 1; i <= target; i++) {
      await new Promise((r) => setTimeout(r, 300));
      eventBus.emitArtifactUpdate({
        kind: 'artifact',
        artifact: {
          name: 'progress',
          parts: [{ kind: 'text', text: `Step ${i} of ${target}` }],
        },
      });
    }

    eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        name: 'result',
        parts: [{ kind: 'text', text: `Counted to ${target}` }],
      },
    });

    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

const app = createA2AExpressApp({ agentCard, executor });
app.listen(3005, () => {
  console.log('Streaming Counter Agent on http://localhost:3005');
  console.log('');
  console.log('Try streaming with:');
  console.log(
    '  curl -N -X POST http://localhost:3005/tasks/sendSubscribe -H "Content-Type: application/json" -d \'{"message":{"messageId":"1","role":"user","parts":[{"kind":"text","text":"5"}]}}\'',
  );
});

// Client demo (run separately or after server starts)
async function runClientDemo() {
  await new Promise((r) => setTimeout(r, 500));
  const client = new A2AClient({ baseUrl: 'http://localhost:3005' });
  console.log('\n--- Client streaming demo ---\n');

  for await (const event of client.sendSubscribe({
    messageId: 'demo-1',
    role: 'user',
    parts: [{ kind: 'text', text: '5' }],
  })) {
    if ('kind' in event) {
      if (event.kind === 'task') {
        console.log('Task created:', event.task.id);
      } else if (event.kind === 'status') {
        console.log('Status:', event.status.state);
      } else if (event.kind === 'artifact') {
        const text = event.artifact.parts
          .filter((p) => p.kind === 'text')
          .map((p) => p.text)
          .join(' ');
        console.log('Artifact:', text);
      }
    }
  }
  console.log('\n--- Stream complete ---\n');
}

runClientDemo().catch(console.error);
