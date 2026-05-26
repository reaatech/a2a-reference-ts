// Parts
export { PartSchema, TextPartSchema, FilePartSchema, DataPartSchema } from './types/part.js';
export type { Part, TextPart, FilePart, DataPart } from './types/part.js';

// Messages
export { MessageSchema } from './types/message.js';
export type { Message } from './types/message.js';

// Agent Card
export {
  AgentCardSchema,
  CapabilitySchema,
  SkillSchema,
  SecuritySchemeSchema,
  AgentInterfaceSchema,
  ApiKeySecuritySchemeSchema,
  HttpSecuritySchemeSchema,
  OAuth2SecuritySchemeSchema,
  OpenIdConnectSecuritySchemeSchema,
  OAuthFlowsSchema,
  AuthorizationCodeOAuthFlowSchema,
  ClientCredentialsOAuthFlowSchema,
  ImplicitOAuthFlowSchema,
  PasswordOAuthFlowSchema,
} from './types/agent-card.js';
export type {
  AgentCard,
  Capability,
  Skill,
  SecurityScheme,
  AgentInterface,
  ApiKeySecurityScheme,
  HttpSecurityScheme,
  OAuth2SecurityScheme,
  OpenIdConnectSecurityScheme,
  OAuthFlows,
  AuthorizationCodeOAuthFlow,
  ClientCredentialsOAuthFlow,
  ImplicitOAuthFlow,
  PasswordOAuthFlow,
} from './types/agent-card.js';

// Task
export { TaskSchema, TaskStatusSchema, TaskStateSchema } from './types/task.js';
export type { Task, TaskStatus, TaskState } from './types/task.js';

// Artifact
export { ArtifactSchema } from './types/artifact.js';
export type { Artifact } from './types/artifact.js';

// Events
export {
  TaskStatusUpdateEventSchema,
  TaskArtifactUpdateEventSchema,
  StreamResponseSchema,
} from './types/events.js';
export type {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  StreamResponse,
} from './types/events.js';

// Requests / Responses
export {
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  GetTaskRequestSchema,
  GetTaskResponseSchema,
  ListTasksRequestSchema,
  ListTasksResponseSchema,
  CancelTaskRequestSchema,
  CancelTaskResponseSchema,
  SubscribeToTaskRequestSchema,
  TaskPushNotificationConfigSchema,
  GetExtendedAgentCardRequestSchema,
} from './types/requests.js';
export type {
  SendMessageRequest,
  SendMessageResponse,
  GetTaskRequest,
  GetTaskResponse,
  ListTasksRequest,
  ListTasksResponse,
  CancelTaskRequest,
  CancelTaskResponse,
  SubscribeToTaskRequest,
  TaskPushNotificationConfig,
  GetExtendedAgentCardRequest,
} from './types/requests.js';

// Errors
export {
  A2AError,
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  VersionNotSupportedError,
} from './types/errors.js';

// Signatures
export {
  AgentCardSignatureSchema,
  MutualTlsSecuritySchemeSchema,
  verifyAgentCardSignature,
  verifyAgentCardSignatures,
  canonicalizeAgentCard,
  AgentCardSignatureError,
} from './types/signature.js';
export type {
  AgentCardSignature,
  MutualTlsSecurityScheme,
  VerifyAgentCardSignatureOptions,
} from './types/signature.js';
