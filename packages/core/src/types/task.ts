import { z } from 'zod';
import { ArtifactSchema } from './artifact.js';
import { MessageSchema } from './message.js';

export const TaskStateSchema = z.enum([
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
  'auth-required',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  message: MessageSchema.optional(),
  timestamp: z.string().datetime().optional(),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string().optional(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).optional(),
  history: z.array(MessageSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
  // Ownership fields for authorization
  principal: z.string().optional(),
  tenantId: z.string().optional(),
  historyLength: z.number().int().optional(),
});
export type Task = z.infer<typeof TaskSchema>;
