import { z } from 'zod';

export const TextPartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type TextPart = z.infer<typeof TextPartSchema>;

export const FilePartSchema = z.object({
  kind: z.literal('file'),
  file: z.object({
    name: z.string().optional(),
    mimeType: z.string().optional(),
    bytes: z.string().optional(),
    uri: z.string().optional(),
  }),
  metadata: z.record(z.unknown()).optional(),
});
export type FilePart = z.infer<typeof FilePartSchema>;

export const DataPartSchema = z.object({
  kind: z.literal('data'),
  data: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});
export type DataPart = z.infer<typeof DataPartSchema>;

export const PartSchema = z.union([TextPartSchema, FilePartSchema, DataPartSchema]);
export type Part = z.infer<typeof PartSchema>;
