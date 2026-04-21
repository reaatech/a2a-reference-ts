import { z } from 'zod';

export const CapabilitySchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  stateTransitionHistory: z.boolean().optional(),
  extendedAgentCard: z.boolean().optional(),
  extensions: z.array(z.unknown()).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const ApiKeySecuritySchemeSchema = z.object({
  scheme: z.literal('apiKey'),
  description: z.string().optional(),
  name: z.string(),
  in: z.enum(['header', 'query', 'cookie']),
});
export type ApiKeySecurityScheme = z.infer<typeof ApiKeySecuritySchemeSchema>;

export const HttpSecuritySchemeSchema = z.object({
  scheme: z.literal('http'),
  description: z.string().optional(),
  bearerFormat: z.string().optional(),
  httpScheme: z.literal('bearer'),
});
export type HttpSecurityScheme = z.infer<typeof HttpSecuritySchemeSchema>;

export const OAuth2SecuritySchemeSchema = z.object({
  scheme: z.literal('oauth2'),
  description: z.string().optional(),
  flows: z.record(z.unknown()),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  scopes: z.record(z.string()).optional(),
});
export type OAuth2SecurityScheme = z.infer<typeof OAuth2SecuritySchemeSchema>;

export const OpenIdConnectSecuritySchemeSchema = z.object({
  scheme: z.literal('openIdConnect'),
  description: z.string().optional(),
  openIdConnectUrl: z.string().url(),
  scopes: z.record(z.string()).optional(),
});
export type OpenIdConnectSecurityScheme = z.infer<typeof OpenIdConnectSecuritySchemeSchema>;

export const SecuritySchemeSchema = z.union([
  ApiKeySecuritySchemeSchema,
  HttpSecuritySchemeSchema,
  OAuth2SecuritySchemeSchema,
  OpenIdConnectSecuritySchemeSchema,
]);
export type SecurityScheme = z.infer<typeof SecuritySchemeSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
  parameters: z.record(z.unknown()).optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const AgentInterfaceSchema = z.object({
  url: z.string().url(),
  protocolBinding: z.string(),
  protocolVersion: z.string(),
  tenant: z.string().optional(),
});
export type AgentInterface = z.infer<typeof AgentInterfaceSchema>;

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string().url(),
  provider: z
    .object({
      organization: z.string(),
      url: z.string().url(),
    })
    .optional(),
  version: z.string(),
  protocolVersion: z.string(),
  documentationUrl: z.string().url().optional(),
  capabilities: CapabilitySchema,
  authentication: z
    .object({
      schemes: z.array(SecuritySchemeSchema),
      credentials: z.string().optional(),
    })
    .optional(),
  securitySchemes: z.record(SecuritySchemeSchema).optional(),
  securityRequirements: z.array(z.record(z.array(z.string()))).optional(),
  security: z.unknown().optional(),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  skills: z.array(SkillSchema),
  signatures: z.array(z.unknown()).optional(),
  iconUrl: z.string().url().optional(),
  supportedInterfaces: z.array(AgentInterfaceSchema),
  extensions: z.array(z.unknown()).optional(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
