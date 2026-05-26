import { z } from 'zod';
import { AgentCardSignatureSchema, MutualTlsSecuritySchemeSchema } from './signature.js';

export const CapabilitySchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  stateTransitionHistory: z.boolean().optional(),
  extendedAgentCard: z.boolean().optional(),
  extensions: z.array(z.unknown()).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

// Security schemes follow the A2A spec (§4.5), modeled on the OpenAPI 3.x
// Security Scheme Object and discriminated by the `type` field.

export const ApiKeySecuritySchemeSchema = z.object({
  type: z.literal('apiKey'),
  description: z.string().optional(),
  name: z.string(),
  in: z.enum(['header', 'query', 'cookie']),
});
export type ApiKeySecurityScheme = z.infer<typeof ApiKeySecuritySchemeSchema>;

export const HttpSecuritySchemeSchema = z.object({
  type: z.literal('http'),
  description: z.string().optional(),
  // RFC 7235 HTTP Authentication scheme name (e.g. "Bearer", "Basic").
  scheme: z.string(),
  bearerFormat: z.string().optional(),
});
export type HttpSecurityScheme = z.infer<typeof HttpSecuritySchemeSchema>;

// OAuth 2.0 flow definitions (A2A spec §4.5.7–4.5.10).
const OAuthScopesSchema = z.record(z.string());

export const AuthorizationCodeOAuthFlowSchema = z.object({
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  refreshUrl: z.string().url().optional(),
  scopes: OAuthScopesSchema,
});
export type AuthorizationCodeOAuthFlow = z.infer<typeof AuthorizationCodeOAuthFlowSchema>;

export const ClientCredentialsOAuthFlowSchema = z.object({
  tokenUrl: z.string().url(),
  refreshUrl: z.string().url().optional(),
  scopes: OAuthScopesSchema,
});
export type ClientCredentialsOAuthFlow = z.infer<typeof ClientCredentialsOAuthFlowSchema>;

export const ImplicitOAuthFlowSchema = z.object({
  authorizationUrl: z.string().url(),
  refreshUrl: z.string().url().optional(),
  scopes: OAuthScopesSchema,
});
export type ImplicitOAuthFlow = z.infer<typeof ImplicitOAuthFlowSchema>;

export const PasswordOAuthFlowSchema = z.object({
  tokenUrl: z.string().url(),
  refreshUrl: z.string().url().optional(),
  scopes: OAuthScopesSchema,
});
export type PasswordOAuthFlow = z.infer<typeof PasswordOAuthFlowSchema>;

export const OAuthFlowsSchema = z.object({
  authorizationCode: AuthorizationCodeOAuthFlowSchema.optional(),
  clientCredentials: ClientCredentialsOAuthFlowSchema.optional(),
  implicit: ImplicitOAuthFlowSchema.optional(),
  password: PasswordOAuthFlowSchema.optional(),
});
export type OAuthFlows = z.infer<typeof OAuthFlowsSchema>;

export const OAuth2SecuritySchemeSchema = z.object({
  type: z.literal('oauth2'),
  description: z.string().optional(),
  flows: OAuthFlowsSchema,
  oauth2MetadataUrl: z.string().url().optional(),
});
export type OAuth2SecurityScheme = z.infer<typeof OAuth2SecuritySchemeSchema>;

export const OpenIdConnectSecuritySchemeSchema = z.object({
  type: z.literal('openIdConnect'),
  description: z.string().optional(),
  openIdConnectUrl: z.string().url(),
});
export type OpenIdConnectSecurityScheme = z.infer<typeof OpenIdConnectSecuritySchemeSchema>;

export const SecuritySchemeSchema = z.discriminatedUnion('type', [
  ApiKeySecuritySchemeSchema,
  HttpSecuritySchemeSchema,
  OAuth2SecuritySchemeSchema,
  OpenIdConnectSecuritySchemeSchema,
  MutualTlsSecuritySchemeSchema,
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
  signatures: z.array(AgentCardSignatureSchema).optional(),
  iconUrl: z.string().url().optional(),
  supportedInterfaces: z.array(AgentInterfaceSchema),
  extensions: z.array(z.unknown()).optional(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
