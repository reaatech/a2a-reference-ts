/**
 * Agent Card signature verification utilities.
 *
 * Implements A2A spec §8.4 (Agent Card Signing): signatures are JSON Web
 * Signatures (JWS, RFC 7515) computed over the RFC 8785 (JCS) canonicalization
 * of the Agent Card with its `signatures` field excluded. Verification is
 * performed with `jose`, which is WebCrypto-based and works in Node.js, edge
 * runtimes, and browsers.
 *
 * @module
 */
import { base64url, createRemoteJWKSet, flattenedVerify, importSPKI, importX509 } from 'jose';
import type { FlattenedVerifyGetKey, JWK, CryptoKey as JoseCryptoKey, KeyObject } from 'jose';
import { z } from 'zod';
import { A2AError } from './errors.js';

/**
 * An Agent Card signature in JWS form (A2A spec §4.4.7 / §8.4.2).
 *
 * - `protected`: base64url-encoded JWS Protected Header (must contain `alg`).
 * - `signature`: base64url-encoded signature value.
 * - `header`: optional JWS Unprotected Header (plain JSON, not encoded).
 */
export const AgentCardSignatureSchema = z.object({
  protected: z.string().min(1),
  signature: z.string().min(1),
  header: z.record(z.unknown()).optional(),
});

export type AgentCardSignature = z.infer<typeof AgentCardSignatureSchema>;

/**
 * mTLS security scheme (A2A spec §4.5.6 — `MutualTlsSecurityScheme`).
 * Carries only an optional human-readable description; the certificate trust
 * configuration is established out of band at the transport layer.
 */
export const MutualTlsSecuritySchemeSchema = z.object({
  scheme: z.literal('mutualTLS'),
  description: z.string().optional(),
});

export type MutualTlsSecurityScheme = z.infer<typeof MutualTlsSecuritySchemeSchema>;

export class AgentCardSignatureError extends A2AError {
  constructor(
    message: string,
    public readonly signatureIndex?: number,
  ) {
    super('AgentCardSignatureError', message, { signatureIndex });
  }
}

/** Algorithms accepted during verification (guards against `alg: none` / confusion). */
const ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
];

/** A static verification key. */
type VerifyKeyMaterial = JoseCryptoKey | KeyObject | JWK | Uint8Array;
/** Either a static key or a `jose` key-resolver function. */
type VerifyKey = VerifyKeyMaterial | FlattenedVerifyGetKey;

export interface VerifyAgentCardSignatureOptions {
  /**
   * A trusted verification key: a PEM-encoded SPKI public key or X.509
   * certificate (string), an imported `CryptoKey`, or a key-resolver function
   * such as the one returned by `jose`'s `createRemoteJWKSet`.
   */
  key?: VerifyKey | string;
  /**
   * When `true`, and no explicit `key` is supplied, fetch the JWKS from the
   * protected header's `jku` URL. Defaults to `false` to avoid SSRF: callers
   * must opt in to outbound key fetching from card-controlled URLs.
   */
  allowRemoteKeys?: boolean;
}

/**
 * Canonicalize an Agent Card for signing/verification per A2A spec §8.4.1.
 *
 * Excludes the `signatures` field, then serializes using the RFC 8785 (JCS)
 * rules: object keys sorted by UTF-16 code unit, no insignificant whitespace,
 * and standard JSON value serialization. Properties whose value is `undefined`
 * are omitted (mirroring JSON / Protobuf field-presence semantics).
 */
export function canonicalizeAgentCard(card: Record<string, unknown>): string {
  const { signatures: _signatures, ...rest } = card;
  return jcsStringify(rest);
}

function jcsStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new AgentCardSignatureError('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(value);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => jcsStringify(v === undefined ? null : v)).join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${jcsStringify(obj[k])}`);
    return `{${entries.join(',')}}`;
  }
  throw new AgentCardSignatureError(`Value of type ${t} is not JSON-serializable`);
}

function decodeProtectedHeader(encoded: string): Record<string, unknown> {
  try {
    const json = new TextDecoder().decode(base64url.decode(encoded));
    const header = JSON.parse(json);
    if (typeof header !== 'object' || header === null) {
      throw new Error('not an object');
    }
    return header as Record<string, unknown>;
  } catch {
    throw new AgentCardSignatureError('Invalid JWS protected header');
  }
}

async function resolveKey(
  header: Record<string, unknown>,
  options: VerifyAgentCardSignatureOptions | undefined,
): Promise<VerifyKey> {
  const alg = typeof header.alg === 'string' ? header.alg : undefined;
  if (!alg) {
    throw new AgentCardSignatureError('JWS protected header is missing the "alg" parameter');
  }

  const provided = options?.key;
  if (typeof provided === 'string') {
    return provided.includes('CERTIFICATE')
      ? await importX509(provided, alg)
      : await importSPKI(provided, alg);
  }
  if (provided) return provided;

  if (options?.allowRemoteKeys && typeof header.jku === 'string') {
    return createRemoteJWKSet(new URL(header.jku));
  }

  throw new AgentCardSignatureError(
    'No verification key available: pass options.key, or set allowRemoteKeys to fetch from the protected header "jku"',
  );
}

/**
 * Verify a single Agent Card signature (A2A spec §8.4.3).
 *
 * @returns `true` if the signature is cryptographically valid, `false` if the
 * signature does not match. Throws {@link AgentCardSignatureError} for
 * structural problems (malformed header, unavailable/disallowed key,
 * unsupported algorithm).
 */
export async function verifyAgentCardSignature(
  card: Record<string, unknown>,
  signature: AgentCardSignature,
  options?: VerifyAgentCardSignatureOptions,
): Promise<boolean> {
  const header = decodeProtectedHeader(signature.protected);
  const alg = header.alg;
  if (typeof alg !== 'string' || !ALLOWED_ALGORITHMS.includes(alg)) {
    throw new AgentCardSignatureError(`Unsupported or missing signature algorithm: ${String(alg)}`);
  }

  const key = await resolveKey(header, options);
  const payload = base64url.encode(new TextEncoder().encode(canonicalizeAgentCard(card)));
  const jws = { protected: signature.protected, payload, signature: signature.signature };
  const verifyOptions = { algorithms: ALLOWED_ALGORITHMS };

  try {
    if (typeof key === 'function') {
      await flattenedVerify(jws, key, verifyOptions);
    } else {
      await flattenedVerify(jws, key, verifyOptions);
    }
    return true;
  } catch (err) {
    // A mathematically-invalid signature is an expected "false", not an error.
    if ((err as { code?: string })?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return false;
    }
    throw new AgentCardSignatureError(
      `Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Verify all signatures on an Agent Card. Returns `valid: true` only when every
 * signature verifies; otherwise `errors` describes each failure by index.
 */
export async function verifyAgentCardSignatures(
  card: Record<string, unknown>,
  signatures: AgentCardSignature[],
  options?: VerifyAgentCardSignatureOptions,
): Promise<{ valid: boolean; errors: AgentCardSignatureError[] }> {
  const errors: AgentCardSignatureError[] = [];

  for (let i = 0; i < signatures.length; i++) {
    try {
      const isValid = await verifyAgentCardSignature(card, signatures[i], options);
      if (!isValid) {
        errors.push(new AgentCardSignatureError(`Signature ${i} is invalid`, i));
      }
    } catch (err) {
      if (err instanceof AgentCardSignatureError) {
        errors.push(new AgentCardSignatureError(err.message, i));
      } else {
        errors.push(
          new AgentCardSignatureError(
            `Signature ${i} verification failed: ${err instanceof Error ? err.message : String(err)}`,
            i,
          ),
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
