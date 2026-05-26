#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface ScaffoldOptions {
  name: string;
  framework: 'express' | 'hono';
  auth: 'none' | 'api-key' | 'jwt';
  mcp: boolean;
  dir: string;
}

async function scaffold(options: ScaffoldOptions): Promise<void> {
  const { name, framework, auth, mcp, dir } = options;
  const targetDir = resolve(dir);

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, 'src'), { recursive: true });

  // package.json
  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
        },
        dependencies: {
          '@reaatech/a2a-reference-core': '^0.1.0',
          '@reaatech/a2a-reference-server': '^0.1.0',
          ...(auth !== 'none' ? { '@reaatech/a2a-reference-auth': '^0.1.0' } : {}),
          ...(mcp ? { '@reaatech/a2a-reference-mcp-bridge': '^0.1.0' } : {}),
          ...(framework === 'hono' ? { '@hono/node-server': '^1.0.0' } : {}),
        },
        devDependencies: {
          typescript: '^5.8.0',
          tsx: '^4.19.0',
          '@types/node': '^25.0.0',
        },
      },
      null,
      2,
    ),
  );

  // tsconfig.json
  await writeFile(
    join(targetDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
          outDir: 'dist',
          rootDir: 'src',
          declaration: true,
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
  );

  // Agent implementation
  const agentCode = generateAgentCode(name, framework, auth, mcp);
  await writeFile(join(targetDir, 'src', 'agent.ts'), agentCode);

  // Server entry
  const serverCode = generateServerCode(name, framework, auth);
  await writeFile(join(targetDir, 'src', 'index.ts'), serverCode);

  // .gitignore
  await writeFile(join(targetDir, '.gitignore'), 'node_modules\ndist\n.env\n');

  process.stdout.write(`
✅ Scaffolded A2A agent "${name}" at ${targetDir}

Next steps:
  cd ${name}
  npm install
  npm run dev

Your agent will be available at http://localhost:3001
Agent Card: http://localhost:3001/.well-known/agent.json
`);
}

function generateAgentCode(
  _name: string,
  _framework: 'express' | 'hono',
  auth: 'none' | 'api-key' | 'jwt',
  mcp: boolean,
): string {
  const authImport =
    auth !== 'none'
      ? `import { ${auth === 'api-key' ? 'ApiKeyStrategy' : 'JwtStrategy'} } from '@reaatech/a2a-reference-auth';\n`
      : '';
  const authConst =
    auth === 'api-key'
      ? "// Set A2A_API_KEY env var or replace this with your key\nconst authConfig = new ApiKeyStrategy({ keys: new Set([process.env.A2A_API_KEY || ''].filter(Boolean)) });\n"
      : auth === 'jwt'
        ? "const authConfig = new JwtStrategy({ issuer: 'https://issuer.example.com', jwksUri: 'https://issuer.example.com/.well-known/jwks.json' });\n"
        : '';

  return `import type { AgentExecutor, ExecutionEventBus } from '@reaatech/a2a-reference-server';
import type { Task, Message } from '@reaatech/a2a-reference-core';
${authImport}
${mcp ? `import { McpToolAdapter } from '@reaatech/a2a-reference-mcp-bridge';` : ''}

${authConst}
export const agentCard: import('@reaatech/a2a-reference-core').AgentCard = {
  name: '${_name}',
  description: 'An A2A agent scaffolded with a2a-cli',
  url: 'http://localhost:3001',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: true },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes back the input text',
      tags: ['utility'],
      examples: ['Say hello'],
      inputModes: ['text'],
      outputModes: ['text'],
    },
  ],
  supportedInterfaces: [],
};

export const executor: AgentExecutor = {
  execute: async (context: { task: Task; message: Message }, eventBus: ExecutionEventBus) => {
    const text = context.message.parts[0] && 'text' in context.message.parts[0]
      ? context.message.parts[0].text
      : 'No text provided';

    const response = \`\${agentCard.name} received: \${text}\`;

    await eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        parts: [{ kind: 'text', text: response }],
      },
    });

    await eventBus.emitStatusUpdate({
      kind: 'status',
      status: { state: 'completed' },
      final: true,
    });
  },
};

${authConst ? 'export { authConfig };\n' : ''}
`;
}

function generateServerCode(
  name: string,
  framework: 'express' | 'hono',
  auth: 'none' | 'api-key' | 'jwt',
): string {
  if (framework === 'express') {
    return `import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import { agentCard, executor${auth !== 'none' ? ', authConfig' : ''} } from './agent.js';
import { defaultLogger } from '@reaatech/a2a-reference-observability';

const app = createA2AExpressApp({
  agentCard,
  executor,
  ${auth !== 'none' ? 'authStrategy: authConfig,' : ''}
  // rateLimiter: new RateLimiter({ maxRequests: 100 }),
  // taskStore: new InMemoryTaskStore(),
});

const PORT = process.env.PORT ?? 3001;
const server = app.listen(PORT, () => {
  defaultLogger.info(\`${name} running on http://localhost:\${PORT}\`);
  defaultLogger.info(\`Agent Card: http://localhost:\${PORT}/.well-known/agent.json\`);
});

process.on('SIGTERM', async () => {
  await app.shutdown();
  server.close(() => {
    process.exit(0);
  });
});
`;
  }

  return `import { createA2AHonoApp } from '@reaatech/a2a-reference-server';
import { serve } from '@hono/node-server';
import { agentCard, executor${auth !== 'none' ? ', authConfig' : ''} } from './agent.js';
import { defaultLogger } from '@reaatech/a2a-reference-observability';

const app = createA2AHonoApp({
  agentCard,
  executor,
  ${auth !== 'none' ? 'authStrategy: authConfig,' : ''}
  // rateLimiter: new RateLimiter({ maxRequests: 100 }),
});

const PORT = process.env.PORT ?? 3001;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  defaultLogger.info(\`${name} running on http://localhost:\${info.port}\`);
  defaultLogger.info(\`Agent Card: http://localhost:\${info.port}/.well-known/agent.json\`);
});
`;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'init' || command === 'new') {
    const flags = new Set(['--hono', '--jwt', '--api-key', '--mcp']);
    const positional = args.slice(1).filter((a) => !flags.has(a));
    const rawName = positional[0] ?? 'my-a2a-agent';
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const framework = args.includes('--hono') ? 'hono' : 'express';
    const auth = args.includes('--jwt') ? 'jwt' : args.includes('--api-key') ? 'api-key' : 'none';
    const mcp = args.includes('--mcp');

    if (rawName !== name) {
      process.stderr.write(`Warning: Name sanitized from "${rawName}" to "${name}"\n`);
    }

    await scaffold({ name, framework, auth, mcp, dir: name });
  } else if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`
a2a - A2A Agent Scaffolding CLI

Usage:
  a2a init <name> [options]

Options:
  --hono       Use Hono instead of Express (default: Express)
  --api-key    Add API key authentication
  --jwt        Add JWT authentication
  --mcp        Add MCP bridge integration
  -h, --help   Show this help

Examples:
  a2a init my-agent
  a2a init my-agent --hono
  a2a init my-agent --jwt --mcp
  a2a init my-agent --api-key
`);
  } else {
    process.stdout.write('Usage: a2a init <name> [options]\n');
    process.stdout.write('Run a2a --help for more information\n');
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
