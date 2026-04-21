import { z } from 'zod';
import { PartSchema } from './part.js';

export const MessageSchema = z.object({
  messageId: z.string(),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  role: z.enum(['user', 'agent']),
  parts: z.array(PartSchema),
  metadata: z.record(z.unknown()).optional(),
  extensions: z.array(z.unknown()).optional(),
  referenceTaskIds: z.array(z.string()).optional(),
});
export type Message = z.infer<typeof MessageSchema>;
