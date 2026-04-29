import { A2AClient } from '@reaatech/a2a-reference-client';
import type {
  AgentCard,
  Message,
  Skill,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from '@reaatech/a2a-reference-core';
import { createLogger } from '@reaatech/a2a-reference-observability';
import type { Logger } from '@reaatech/a2a-reference-observability';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface A2aAsMcpServerOptions {
  a2aAgentUrl: string;
  name?: string;
  version?: string;
  maxPolls?: number;
  pollIntervalMs?: number;
}

export class A2aAsMcpServer {
  private server: Server;
  private client: A2AClient;
  private agentCard: AgentCard | undefined;
  private tools: Tool[] = [];
  private logger: Logger;
  private maxPolls: number;
  private pollIntervalMs: number;

  constructor(options: A2aAsMcpServerOptions) {
    this.server = new Server(
      {
        name: options.name ?? 'a2a-bridge-mcp-server',
        version: options.version ?? '0.1.0',
      },
      { capabilities: { tools: {} } },
    );
    this.client = new A2AClient({ baseUrl: options.a2aAgentUrl });
    this.logger = createLogger({ name: 'A2aAsMcpServer' });
    this.maxPolls = options.maxPolls ?? 60;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  async initialize(): Promise<void> {
    this.agentCard = await this.client.getAgentCard();
    this.tools = (this.agentCard.skills ?? []).map((skill) => this.skillToTool(skill));

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const skill = this.agentCard?.skills.find((s) => s.id === name);
      if (!skill) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const message: Message = {
        messageId: `msg-${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'data', data: args ?? {} }],
      };

      this.logger.debug({ skillId: name, args }, 'Sending message to A2A agent');
      const task = await this.client.sendMessage(message);

      const streamingSupported = this.agentCard?.capabilities.streaming ?? false;
      let finalTask: Task;

      if (streamingSupported) {
        finalTask = await this.streamTask(task.id);
      } else {
        finalTask = await this.pollTask(task.id);
      }

      if (finalTask.status.state === 'failed') {
        const errorText =
          finalTask.status.message?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(' ') ??
          'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Task failed: ${errorText}` }],
          isError: true,
        };
      }

      if (finalTask.status.state === 'canceled' || finalTask.status.state === 'rejected') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Task ${finalTask.status.state}: ${finalTask.status.message?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(' ') ?? 'No details'}`,
            },
          ],
          isError: true,
        };
      }

      const artifacts = finalTask.artifacts ?? [];
      const content = artifacts.flatMap((artifact) =>
        artifact.parts.map((part) => {
          if (part.kind === 'text') {
            return { type: 'text' as const, text: part.text };
          }
          if (part.kind === 'file' && part.file?.bytes) {
            return {
              type: 'text' as const,
              text: `[File: ${part.file.name ?? 'unnamed'}]\n${part.file.bytes}`,
            };
          }
          if (part.kind === 'file' && part.file?.uri) {
            return {
              type: 'text' as const,
              text: `[File URI: ${part.file.uri}]`,
            };
          }
          if (part.kind === 'data') {
            return { type: 'text' as const, text: JSON.stringify(part.data) };
          }
          return { type: 'text' as const, text: '[Unsupported part type]' };
        }),
      );

      return { content };
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  private skillToTool(skill: Skill): Tool {
    const schema = skill.parameters
      ? (skill.parameters as Tool['inputSchema'])
      : {
          type: 'object' as const,
          properties: {
            input: {
              type: 'string',
              description: 'Input for the skill',
            },
          },
          required: ['input'],
        };

    return {
      name: skill.id,
      description: skill.description,
      inputSchema: schema,
    };
  }

  private async pollTask(taskId: string): Promise<Task> {
    const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];
    let polls = 0;
    let currentTask = await this.client.getTask(taskId);

    while (!terminalStates.includes(currentTask.status.state) && polls < this.maxPolls) {
      if (currentTask.status.state === 'input-required') {
        currentTask = await this.handleInputRequired(currentTask);
        // After handling input-required, the server returned the updated task
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
      currentTask = await this.client.getTask(taskId);
      polls++;
    }

    if (!terminalStates.includes(currentTask.status.state)) {
      throw new Error(`Task ${taskId} timed out waiting for completion`);
    }

    return currentTask;
  }

  private async streamTask(taskId: string): Promise<Task> {
    let currentTask: Task | undefined;

    try {
      for await (const event of this.client.subscribe(taskId)) {
        if ('kind' in event && event.kind === 'task') {
          currentTask = event.task;
        } else if ('kind' in event && event.kind === 'status') {
          const statusEvent = event as TaskStatusUpdateEvent;
          if (statusEvent.status.state === 'input-required') {
            const fullTask = await this.client.getTask(taskId);
            currentTask = await this.handleInputRequired(fullTask);
            continue;
          }
          if (currentTask) {
            currentTask = { ...currentTask, status: statusEvent.status };
          }
        } else if ('kind' in event && event.kind === 'artifact') {
          if (currentTask) {
            const existing = currentTask.artifacts ?? [];
            currentTask = {
              ...currentTask,
              artifacts: [...existing, event.artifact],
            };
          }
        }

        if (
          currentTask &&
          ['completed', 'failed', 'canceled', 'rejected'].includes(currentTask.status.state)
        ) {
          break;
        }
      }
    } catch (err) {
      this.logger.warn({ taskId, error: err }, 'Streaming failed, falling back to polling');
      return this.pollTask(taskId);
    }

    // Always fetch the definitive final task to ensure complete artifacts
    currentTask = await this.client.getTask(taskId);
    return currentTask;
  }

  private async handleInputRequired(task: Task): Promise<Task> {
    const question =
      task.status.message?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(' ') ??
      'Additional input required';

    this.logger.info({ taskId: task.id }, 'Task requires input');

    const clientCaps = this.server.getClientCapabilities();
    if (!clientCaps?.sampling) {
      throw new Error(`Task ${task.id} requires input, but MCP client does not support sampling`);
    }

    try {
      const result = await this.server.createMessage({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: question,
            },
          },
        ],
        maxTokens: 1024,
      });

      const text =
        result.content.type === 'text' ? result.content.text : JSON.stringify(result.content);

      const followUpMessage: Message = {
        messageId: `msg-${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'text', text }],
      };

      return await this.sendTaskMessage(task.id, followUpMessage);
    } catch (err) {
      this.logger.error({ taskId: task.id, error: err }, 'Failed to get input via sampling');
      throw new Error(
        `Task ${task.id} requires input, but sampling request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendTaskMessage(taskId: string, message: Message): Promise<Task> {
    return this.client.sendMessage(message, undefined, taskId);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
