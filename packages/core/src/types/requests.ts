import { z } from 'zod';
import { MessageSchema } from './message.js';
import { TaskSchema } from './task.js';

export const SendMessageRequestSchema = z.object({
  message: MessageSchema,
  contextId: z.string().optional(),
  historyLength: z.number().int().optional(),
  taskId: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = TaskSchema;
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

export const GetTaskRequestSchema = z.object({
  id: z.string(),
  historyLength: z.number().int().optional(),
});
export type GetTaskRequest = z.infer<typeof GetTaskRequestSchema>;

export const GetTaskResponseSchema = TaskSchema;
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;

export const ListTasksRequestSchema = z.object({
  contextId: z.string().optional(),
  status: z.string().optional(),
  pageSize: z.number().int().optional(),
  pageToken: z.string().optional(),
  historyLength: z.number().int().optional(),
});
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>;

export const ListTasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  nextPageToken: z.string(),
  totalSize: z.number().int(),
});
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

export const CancelTaskRequestSchema = z.object({
  id: z.string(),
});
export type CancelTaskRequest = z.infer<typeof CancelTaskRequestSchema>;

export const CancelTaskResponseSchema = TaskSchema;
export type CancelTaskResponse = z.infer<typeof CancelTaskResponseSchema>;

export const SubscribeToTaskRequestSchema = z.object({
  id: z.string(),
  historyLength: z.number().int().optional(),
});
export type SubscribeToTaskRequest = z.infer<typeof SubscribeToTaskRequestSchema>;

export const TaskPushNotificationConfigSchema = z.object({
  id: z.string().optional(),
  taskId: z.string().optional(),
  url: z.string().url(),
  token: z.string().optional(),
  authentication: z.unknown().optional(),
});
export type TaskPushNotificationConfig = z.infer<typeof TaskPushNotificationConfigSchema>;

export const GetExtendedAgentCardRequestSchema = z.object({
  tenant: z.string().optional(),
});
export type GetExtendedAgentCardRequest = z.infer<typeof GetExtendedAgentCardRequestSchema>;
