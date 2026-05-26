import {
  FlattenedSign,
  type GenerateKeyPairResult,
  type CryptoKey as JoseCryptoKey,
  base64url,
  exportSPKI,
  generateKeyPair,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AgentCardSignature,
  AgentCardSignatureSchema,
  canonicalizeAgentCard,
  verifyAgentCardSignature,
  verifyAgentCardSignatures,
} from './signature.js';

const card: Record<string, unknown> = {
  name: 'Calculator Agent',
  version: '1.0.0',
  url: 'https://example.com/agent',
};

let rsa: GenerateKeyPairResult;
let rsaOther: GenerateKeyPairResult;
let ec: GenerateKeyPairResult;
let ed: GenerateKeyPairResult;
let rsaPublicPem: string;

beforeAll(async () => {
  rsa = await generateKeyPair('RS256');
  rsaOther = await generateKeyPair('RS256');
  ec = await generateKeyPair('ES256');
  ed = await generateKeyPair('EdDSA');
  rsaPublicPem = await exportSPKI(rsa.publicKey);
});

async function sign(
  target: Record<string, unknown>,
  privateKey: JoseCryptoKey,
  alg: string,
  headerExtra: Record<string, unknown> = {},
): Promise<AgentCardSignature> {
  const payload = new TextEncoder().encode(canonicalizeAgentCard(target));
  const jws = await new FlattenedSign(payload)
    .setProtectedHeader({ alg, typ: 'JOSE', ...headerExtra })
    .sign(privateKey);
  return { protected: jws.protected ?? '', signature: jws.signature };
}

function protectedHeader(header: Record<string, unknown>): string {
  return base64url.encode(new TextEncoder().encode(JSON.stringify(header)));
}

describe('canonicalizeAgentCard', () => {
  it('excludes the signatures field and sorts keys lexicographically', () => {
    const result = canonicalizeAgentCard({
      b: 1,
      a: 2,
      signatures: [{ protected: 'x', signature: 'y' }],
    });
    expect(result).toBe('{"a":2,"b":1}');
  });

  it('omits undefined properties and recurses', () => {
    const result = canonicalizeAgentCard({ a: { z: 1, y: undefined, x: [3, 2] }, m: undefined });
    expect(result).toBe('{"a":{"x":[3,2],"z":1}}');
  });
});

describe('verifyAgentCardSignature', () => {
  it('verifies a valid RS256 signature with a PEM public key', async () => {
    const sig = await sign(card, rsa.privateKey, 'RS256', { kid: 'key-1' });
    expect(await verifyAgentCardSignature(card, sig, { key: rsaPublicPem })).toBe(true);
  });

  it('verifies a valid ES256 signature with a CryptoKey', async () => {
    const sig = await sign(card, ec.privateKey, 'ES256');
    expect(await verifyAgentCardSignature(card, sig, { key: ec.publicKey })).toBe(true);
  });

  it('verifies a valid EdDSA (Ed25519) signature', async () => {
    const sig = await sign(card, ed.privateKey, 'EdDSA');
    expect(await verifyAgentCardSignature(card, sig, { key: ed.publicKey })).toBe(true);
  });

  it('returns false when the card has been tampered with', async () => {
    const sig = await sign(card, rsa.privateKey, 'RS256');
    const tampered = { ...card, url: 'https://evil.example.com' };
    expect(await verifyAgentCardSignature(tampered, sig, { key: rsa.publicKey })).toBe(false);
  });

  it('returns false when verified with the wrong key', async () => {
    const sig = await sign(card, rsa.privateKey, 'RS256');
    expect(await verifyAgentCardSignature(card, sig, { key: rsaOther.publicKey })).toBe(false);
  });

  it('throws on a malformed protected header', async () => {
    await expect(
      verifyAgentCardSignature(
        card,
        { protected: '@@@not-base64-json', signature: 'AAAA' },
        { key: rsa.publicKey },
      ),
    ).rejects.toThrow('Invalid JWS protected header');
  });

  it('throws for an unsupported algorithm', async () => {
    const sig = { protected: protectedHeader({ alg: 'FOO' }), signature: 'AAAA' };
    await expect(verifyAgentCardSignature(card, sig, { key: rsaPublicPem })).rejects.toThrow(
      'Unsupported or missing signature algorithm',
    );
  });

  it('throws when no key is available and remote keys are not allowed', async () => {
    const sig = await sign(card, rsa.privateKey, 'RS256', {
      jku: 'https://example.com/jwks.json',
    });
    await expect(verifyAgentCardSignature(card, sig)).rejects.toThrow(
      'No verification key available',
    );
  });
});

describe('verifyAgentCardSignatures', () => {
  it('returns valid for multiple valid signatures', async () => {
    const a = await sign(card, rsa.privateKey, 'RS256');
    const b = await sign(card, rsa.privateKey, 'RS256', { kid: 'key-2' });
    const result = await verifyAgentCardSignatures(card, [a, b], { key: rsa.publicKey });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors from invalid signatures, indexed', async () => {
    const valid = await sign(card, rsa.privateKey, 'RS256');
    const invalid = await sign(card, rsaOther.privateKey, 'RS256');
    const result = await verifyAgentCardSignatures(card, [valid, invalid], { key: rsa.publicKey });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Signature 1 is invalid');
    expect(result.errors[0].signatureIndex).toBe(1);
  });

  it('captures thrown structural errors with the right index', async () => {
    const ok = await sign(card, rsa.privateKey, 'RS256');
    const bad = { protected: protectedHeader({ alg: 'FOO' }), signature: 'AAAA' };
    const result = await verifyAgentCardSignatures(card, [ok, bad], { key: rsa.publicKey });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].signatureIndex).toBe(1);
    expect(result.errors[0].message).toContain('Unsupported or missing signature algorithm');
  });
});

describe('AgentCardSignatureSchema', () => {
  it('validates a JWS signature object', () => {
    expect(() =>
      AgentCardSignatureSchema.parse({
        protected: 'eyJ...',
        signature: 'abc',
        header: { kid: 'k' },
      }),
    ).not.toThrow();
  });

  it('validates without the optional unprotected header', () => {
    expect(() =>
      AgentCardSignatureSchema.parse({ protected: 'eyJ...', signature: 'abc' }),
    ).not.toThrow();
  });

  it('rejects a signature missing required fields', () => {
    expect(() => AgentCardSignatureSchema.parse({ protected: 'eyJ...' })).toThrow();
    expect(() => AgentCardSignatureSchema.parse({})).toThrow();
  });
});
