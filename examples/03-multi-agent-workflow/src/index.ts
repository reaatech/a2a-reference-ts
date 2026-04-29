import { A2AClient } from '@reaatech/a2a-reference-client';
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from '@reaatech/a2a-reference-server';
import { safeEval } from './safe-math.js';

// --- Math Agent (specialist) ---
const mathAgentCard = {
  name: 'Math Agent',
  description: 'Evaluates mathematical expressions',
  url: 'http://localhost:3001',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    { id: 'calculate', name: 'Calculate', description: 'Evaluate math expressions', tags: [] },
  ],
  supportedInterfaces: [
    {
      url: 'http://localhost:3001',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const mathExecutor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    try {
      const result = safeEval(text);
      eventBus.emitArtifactUpdate({
        kind: 'artifact',
        artifact: { name: 'result', parts: [{ kind: 'text', text: String(result) }] },
      });
      eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
    } catch {
      eventBus.emitArtifactUpdate({
        kind: 'artifact',
        artifact: { name: 'error', parts: [{ kind: 'text', text: 'Invalid expression' }] },
      });
      eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'failed' } });
    }
  },
};

// --- Formatter Agent (specialist) ---
const formatterAgentCard = {
  name: 'Formatter Agent',
  description: 'Formats text output',
  url: 'http://localhost:3002',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'format', name: 'Format', description: 'Format text nicely', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:3002',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const formatterExecutor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        name: 'formatted',
        parts: [{ kind: 'text', text: `** Formatted Result: ${text} **` }],
      },
    });
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

// --- Orchestrator Agent ---
const orchestratorAgentCard = {
  name: 'Orchestrator Agent',
  description: 'Delegates math problems to specialists and formats the result',
  url: 'http://localhost:3003',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'solve-and-format',
      name: 'Solve and Format',
      description: 'Solves math and formats output',
      tags: [],
    },
  ],
  supportedInterfaces: [
    {
      url: 'http://localhost:3003',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const orchestratorExecutor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });

    // Step 1: Delegate to math agent
    const mathClient = new A2AClient({ baseUrl: 'http://localhost:3001' });
    const mathTask = await mathClient.sendMessage({
      messageId: `math-${Date.now()}`,
      role: 'user',
      parts: [{ kind: 'text', text }],
    });

    // Wait for completion
    let finalMath = mathTask;
    while (finalMath.status.state !== 'completed' && finalMath.status.state !== 'failed') {
      await new Promise((r) => setTimeout(r, 100));
      finalMath = await mathClient.getTask(mathTask.id);
    }

    const mathResult =
      finalMath.artifacts?.[0]?.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ') ?? 'no result';

    // Step 2: Delegate to formatter agent
    const formatterClient = new A2AClient({ baseUrl: 'http://localhost:3002' });
    const formatTask = await formatterClient.sendMessage({
      messageId: `fmt-${Date.now()}`,
      role: 'user',
      parts: [{ kind: 'text', text: mathResult }],
    });

    let finalFormat = formatTask;
    while (finalFormat.status.state !== 'completed' && finalFormat.status.state !== 'failed') {
      await new Promise((r) => setTimeout(r, 100));
      finalFormat = await formatterClient.getTask(formatTask.id);
    }

    const formattedResult =
      finalFormat.artifacts?.[0]?.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ') ?? 'no result';

    eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: { name: 'final', parts: [{ kind: 'text', text: formattedResult }] },
    });
    eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

// Start all agents
const mathApp = createA2AExpressApp({ agentCard: mathAgentCard, executor: mathExecutor });
const formatterApp = createA2AExpressApp({
  agentCard: formatterAgentCard,
  executor: formatterExecutor,
});
const orchestratorApp = createA2AExpressApp({
  agentCard: orchestratorAgentCard,
  executor: orchestratorExecutor,
});

mathApp.listen(3001, () => console.log('Math Agent on http://localhost:3001'));
formatterApp.listen(3002, () => console.log('Formatter Agent on http://localhost:3002'));
orchestratorApp.listen(3003, () => {
  console.log('Orchestrator Agent on http://localhost:3003');
  console.log('');
  console.log('Try: curl -X POST http://localhost:3003/ -H "Content-Type: application/json" -d \'');
  console.log(
    '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"message":{"messageId":"1","role":"user","parts":[{"kind":"text","text":"2 + 3 * 4"}]}}}\'',
  );
});
