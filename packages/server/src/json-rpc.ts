import { z } from 'zod';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export type JsonRpcMethodHandler<T = unknown> = (
  params: Record<string, unknown>,
  context?: T,
) => Promise<unknown>;

export class JsonRpcRouter<T = unknown> {
  private handlers = new Map<string, JsonRpcMethodHandler<T>>();

  register(method: string, handler: JsonRpcMethodHandler<T>): void {
    this.handlers.set(method, handler);
  }

  async handle(request: unknown, context?: T): Promise<JsonRpcResponse> {
    const parsed = JsonRpcRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
    }

    const { id, method, params = {} } = parsed.data;
    const handler = this.handlers.get(method);
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    }

    try {
      const result = await handler(params, context);
      return { jsonrpc: '2.0', id: id ?? null, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      const code =
        message.toLowerCase().includes('invalid') ||
        message.toLowerCase().includes('required') ||
        message.toLowerCase().includes('expected')
          ? -32602
          : -32603;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code, message },
      };
    }
  }
}
