import { describe, expect, it } from 'vitest';
import {
  assertJavaScriptChunkWithinBudget,
  DEPLOYMENT_PLACEHOLDER,
  MAX_JAVASCRIPT_CHUNK_BYTES,
  validateProductionConfig,
} from '../scripts/deployment-config';

describe('validateProductionConfig', () => {
  it('accepts and normalizes an explicit HTTPS homeserver URL', () => {
    expect(validateProductionConfig({ homeserverUrl: 'https://matrix.example.org/prefix/' })).toEqual({
      homeserverUrl: 'https://matrix.example.org/prefix',
    });
  });

  it('allows the deployment placeholder only when explicitly requested', () => {
    expect(() => validateProductionConfig({ homeserverUrl: DEPLOYMENT_PLACEHOLDER })).toThrow(
      'must be replaced at deployment time',
    );
    expect(
      validateProductionConfig(
        { homeserverUrl: DEPLOYMENT_PLACEHOLDER },
        { allowPlaceholder: true },
      ),
    ).toEqual({ homeserverUrl: DEPLOYMENT_PLACEHOLDER });
  });

  it.each([
    [{ homeserverUrl: 'http://localhost:8008' }, 'must use HTTPS'],
    [{ homeserverUrl: 'https://localhost:8008' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://dev.localhost' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://localhost.' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://localhost..' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://dev.localhost.' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://127.9.8.7' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://0.0.0.0' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://[::1]' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://[::]' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://[::ffff:127.0.0.1]' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'https://[::ffff:0.0.0.0]' }, 'must not use a loopback or unspecified host'],
    [{ homeserverUrl: 'http://matrix.example.org' }, 'must use HTTPS'],
    [{ homeserverUrl: 'https://user:password@matrix.example.org' }, 'cannot contain credentials'],
    [{ homeserverUrl: 'https://matrix.example.org/?tenant=x' }, 'cannot contain a query or hash'],
    [{ homeserverUrl: 'not a URL' }, 'must be a valid URL'],
    [{}, 'must be a non-empty string'],
    [null, 'must be a JSON object'],
  ])('rejects unsafe production config %#', (value, message) => {
    expect(() => validateProductionConfig(value)).toThrow(message);
  });

  it('enforces the documented production JavaScript chunk budget', () => {
    expect(() => assertJavaScriptChunkWithinBudget('matrix.js', MAX_JAVASCRIPT_CHUNK_BYTES))
      .not.toThrow();
    expect(() => assertJavaScriptChunkWithinBudget('matrix.js', MAX_JAVASCRIPT_CHUNK_BYTES + 1))
      .toThrow('matrix.js exceeds the 1200000-byte JavaScript chunk budget');
  });
});
