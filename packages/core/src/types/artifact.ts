import { z } from 'zod';
import { PartSchema } from './part.js';

export const ArtifactSchema = z.object({
  artifactId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(PartSchema),
  metadata: z.record(z.unknown()).optional(),
  extensions: z.array(z.unknown()).optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;
