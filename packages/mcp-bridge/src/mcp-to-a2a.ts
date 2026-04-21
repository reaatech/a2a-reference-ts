import type { AgentCard, Artifact, Message, Skill, Task } from '@a2a-ref/core';
import { DataPartSchema, TextPartSchema } from '@a2a-ref/core';
import { InvalidAgentResponseError } from '@a2a-ref/core';
import { createLogger } from '@a2a-ref/observability';
import type { Logger } from '@a2a-ref/observability';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolResultSchema,
  ImageContentSchema,
  TextContentSchema,
} from '@modelcontextprotocol/sdk/types.js';

export interface McpToolAdapterOptions {
  mcpTransport: Transport;
  agentCardBase: Omit<AgentCard, 'skills'>;
}

export class McpToolCallError extends Error {
  constructor(
    public skillId: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpToolCallError';
  }
}

export class McpToolAdapter {
  private client: Client;
  private skills: Skill[] = [];
  private agentCard: AgentCard;
  private logger: Logger;

  constructor(private options: McpToolAdapterOptions) {
    this.client = new Client({ name: 'a2a-mcp-bridge', version: '0.1.0' });
    this.agentCard = { ...options.agentCardBase, skills: [] };
    this.logger = createLogger({ name: 'McpToolAdapter' });
  }

  async initialize(): Promise<void> {
    await this.client.connect(this.options.mcpTransport);
    const tools = await this.client.listTools();
    this.skills = tools.tools.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description ?? `MCP tool: ${tool.name}`,
      tags: ['mcp'],
      parameters: tool.inputSchema as Record<string, unknown> | undefined,
    }));
    this.agentCard = { ...this.agentCard, skills: this.skills };
    this.logger.info({ skillCount: this.skills.length }, 'Initialized MCP tool adapter');
  }

  getAgentCard(): AgentCard {
    return this.agentCard;
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  async executeTask(_task: Task, message: Message): Promise<Artifact[]> {
    const skillId = this.inferSkillId(message);
    if (!skillId) {
      throw new Error('Could not infer MCP tool from message');
    }

    const args = this.extractArguments(message);
    this.logger.debug({ skillId, args }, 'Calling MCP tool');

    let rawResult: unknown;
    try {
      rawResult = await this.client.callTool({
        name: skillId,
        arguments: args,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ skillId, error: message }, 'MCP tool call failed');
      throw new McpToolCallError(skillId, `MCP tool call failed: ${message}`);
    }

    const parsed = CallToolResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      this.logger.error({ error: parsed.error.flatten() }, 'Invalid MCP tool result');
      throw new InvalidAgentResponseError(`Invalid MCP tool result: ${parsed.error.message}`);
    }

    const result = parsed.data;
    if (result.isError) {
      const errorText = result.content
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
        .join(' ');
      this.logger.error({ skillId, errorText }, 'MCP tool returned error');
      throw new McpToolCallError(skillId, `MCP tool returned error: ${errorText}`);
    }

    const artifacts: Artifact[] = [];

    for (const content of result.content) {
      const textParsed = TextContentSchema.safeParse(content);
      if (textParsed.success) {
        artifacts.push({
          name: skillId,
          parts: [{ kind: 'text', text: textParsed.data.text }],
        });
        continue;
      }

      const imageParsed = ImageContentSchema.safeParse(content);
      if (imageParsed.success) {
        artifacts.push({
          name: `${skillId}-image`,
          parts: [
            {
              kind: 'file',
              file: {
                bytes: imageParsed.data.data,
                mimeType: imageParsed.data.mimeType,
              },
            },
          ],
        });
        continue;
      }

      // Fallback: represent unknown content as text
      artifacts.push({
        name: skillId,
        parts: [{ kind: 'text', text: JSON.stringify(content) }],
      });
    }

    this.logger.debug({ artifactCount: artifacts.length }, 'MCP tool returned artifacts');
    return artifacts;
  }

  private extractArguments(message: Message): Record<string, unknown> {
    // Prefer structured data parts
    for (const part of message.parts) {
      const dataParsed = DataPartSchema.safeParse(part);
      if (dataParsed.success) {
        return dataParsed.data.data;
      }
    }

    // Try to parse text parts as JSON object
    const text = message.parts
      .filter((p) => TextPartSchema.safeParse(p).success)
      .map((p) => (p as { text: string }).text)
      .join(' ')
      .trim();

    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Not valid JSON object, fall through to text input
      }
      return { input: text };
    }

    return {};
  }

  private inferSkillId(message: Message): string | undefined {
    // Simple heuristic: use the first text part as the tool name if it matches a skill
    const text = message.parts
      .filter((p) => TextPartSchema.safeParse(p).success)
      .map((p) => (p as { text: string }).text)
      .join(' ')
      .toLowerCase()
      .trim();

    for (const skill of this.skills) {
      if (text.startsWith(skill.id.toLowerCase())) {
        return skill.id;
      }
    }

    // Check for an explicit skill reference in a data part
    for (const part of message.parts) {
      const dataParsed = DataPartSchema.safeParse(part);
      if (dataParsed.success && typeof dataParsed.data.data.skill === 'string') {
        const candidate = dataParsed.data.data.skill;
        if (this.skills.some((s) => s.id === candidate)) {
          return candidate;
        }
      }
    }

    // Fallback: return the first skill if only one exists
    if (this.skills.length === 1) {
      return this.skills[0].id;
    }

    return undefined;
  }
}
