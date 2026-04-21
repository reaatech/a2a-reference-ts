import { z } from 'zod';
import { ArtifactSchema } from './artifact.js';
import { MessageSchema } from './message.js';
import { TaskSchema, TaskStatusSchema } from './task.js';

export const TaskStatusUpdateEventSchema = z.object({
  kind: z.literal('status'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  status: TaskStatusSchema,
  final: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskStatusUpdateEvent = z.infer<typeof TaskStatusUpdateEventSchema>;

export const TaskArtifactUpdateEventSchema = z.object({
  kind: z.literal('artifact'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  artifact: ArtifactSchema,
  append: z.boolean().optional(),
  lastChunk: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskArtifactUpdateEvent = z.infer<typeof TaskArtifactUpdateEventSchema>;

export const StreamResponseSchema = z.union([
  z.object({ kind: z.literal('task'), task: TaskSchema }),
  z.object({ kind: z.literal('message'), message: MessageSchema }),
  z.object({ kind: z.literal('status'), status: TaskStatusSchema, final: z.boolean().optional() }),
  z.object({ kind: z.literal('artifact'), artifact: ArtifactSchema }),
]);
export type StreamResponse = z.infer<typeof StreamResponseSchema>;
