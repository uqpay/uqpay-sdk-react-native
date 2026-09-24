/**
 * AC RN-ERR1/2/5, RN-API3, RN-PAR3, RN-DOC4 — the canonical table, the mapper
 * and the generated artefacts. `errors/mapper.ts` is a 100 %-coverage file.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUnknownErrorCode, localError, toUqpayError } from '../errors/mapper';
import { ERROR_TABLE, UNKNOWN_ROW, findErrorRow } from '../errors/table';
import {
  OUTPUT_PATHS,
  renderErrorCodesDoc,
  renderErrorTableJson,
  renderScenariosJson,
} from '../../scripts/render';
import { PLATFORMS, type TestPlatform } from './helpers';

const ROOT = join(__dirname, '..', '..');

const CANONICAL_CODES = [
  'card_declined',
  'insufficient_funds',
  'invalid_payment_method',
  '3ds_failed',
  'cancelled',
  'authentication_failed',
  'invalid_configuration',
  'not_initialized',
  'invalid_request',
  'network_error',
  'timeout',
  'server_error',
  'intent_not_payable',
  'unknown',
];

describe('the canonical error table (RN-ERR1)', () => {
  it('contains exactly the fourteen canonical codes, in order', () => {
    expect(ERROR_TABLE.map((row) => row.code)).toEqual(CANONICAL_CODES);
  });

  it.each(ERROR_TABLE.map((row) => [row.code, row] as const))(
    '%s documents a meaning, a safe user message, a developer hint and both platforms',
    (_code, row) => {
      expect(row.meaning.length).toBeGreaterThan(0);
      expect(row.userMessage.length).toBeGreaterThan(0);
      expect(row.developerHint.length).toBeGreaterThan(0);
      expect(row.platforms).toEqual(['ios', 'android']);
      // RN-ERR3: no jargon, no platform name, no raw code in what the user sees.
      expect(row.userMessage).not.toMatch(
        /ios|android|http|null|undefined|stack/i
      );
      // No machine code (snake_case) ever reaches the customer.
      expect(row.userMessage).not.toMatch(/[a-z0-9]+_[a-z0-9_]+/);
    }
  );

  it('marks timeout as the only outcome-unknown row (lead decision OQ-A1)', () => {
    // `unknown` is the definitive no-failure-code fallback on both natives, so
    // its documented default is "outcome known"; the per-occurrence native
    // flag still wins in the mapper.
    expect(
      ERROR_TABLE.filter((row) => row.isOutcomeUnknown).map((r) => r.code)
    ).toEqual(['timeout']);
  });

  it('exposes the unknown row as the fallback', () => {
    expect(UNKNOWN_ROW.code).toBe('unknown');
    expect(findErrorRow('unknown')).toBe(UNKNOWN_ROW);
    expect(findErrorRow('nope')).toBeUndefined();
  });
});

describe('isUnknownErrorCode (RN-API3, RN-ERR5)', () => {
  it.each(CANONICAL_CODES.filter((code) => code !== 'unknown'))(
    'returns false for the canonical code %s',
    (code) => {
      expect(isUnknownErrorCode(code)).toBe(false);
    }
  );

  it('returns true for "unknown" itself and for anything undocumented', () => {
    expect(isUnknownErrorCode('unknown')).toBe(true);
    expect(isUnknownErrorCode('quantum_flux')).toBe(true);
    expect(isUnknownErrorCode('')).toBe(true);
  });
});

describe.each(PLATFORMS)(
  'toUqpayError on %s (RN-ERR2)',
  (platform: TestPlatform) => {
    it('fills userMessage and isRetryable from the table', () => {
      const error = toUqpayError(
        {
          code: 'network_error',
          developerMessage: 'connection reset',
          isOutcomeUnknown: false,
          httpStatus: 0,
          declineCode: '',
          traceId: 'trace-1',
        },
        platform
      );

      expect(error).toEqual({
        code: 'network_error',
        userMessage: findErrorRow('network_error')?.userMessage,
        developerMessage: 'connection reset',
        isRetryable: true,
        isOutcomeUnknown: false,
        declineCode: undefined,
        httpStatus: 0,
        traceId: 'trace-1',
        raw: undefined,
        platform,
      });
    });

    it('keeps declineCode, httpStatus and the native isOutcomeUnknown', () => {
      const error = toUqpayError(
        {
          code: 'card_declined',
          developerMessage: 'issuer declined',
          declineCode: 'do_not_honor',
          httpStatus: 402,
          isOutcomeUnknown: true,
        },
        platform
      );

      expect(error.declineCode).toBe('do_not_honor');
      expect(error.httpStatus).toBe(402);
      expect(error.isOutcomeUnknown).toBe(true);
    });

    it('gives an undocumented code the generic message and keeps it as raw', () => {
      const error = toUqpayError(
        {
          code: 'quantum_flux',
          developerMessage: 'native said quantum_flux',
          isOutcomeUnknown: false,
        },
        platform
      );

      expect(error.code).toBe('quantum_flux');
      expect(error.userMessage).toBe(UNKNOWN_ROW.userMessage);
      expect(error.isRetryable).toBe(false);
      expect(error.raw).toBe('quantum_flux');
      expect(isUnknownErrorCode(error.code)).toBe(true);
    });

    it('prefers the native raw value over the code', () => {
      const error = toUqpayError(
        {
          code: 'unknown',
          developerMessage: 'native said something new',
          raw: 'ERR_TELEPORT',
          isOutcomeUnknown: true,
        },
        platform
      );

      expect(error.raw).toBe('ERR_TELEPORT');
    });

    it('falls back to unknown for a blank or missing code', () => {
      expect(
        toUqpayError(
          { code: '', developerMessage: 'nothing', isOutcomeUnknown: false },
          platform
        ).code
      ).toBe('unknown');
      expect(
        toUqpayError(
          {
            code: undefined as unknown as string,
            developerMessage: 'x',
            isOutcomeUnknown: false,
          },
          platform
        ).code
      ).toBe('unknown');
    });

    it('falls back to the generic meaning for an undocumented code with no developer message', () => {
      const error = toUqpayError(
        { code: 'quantum_flux', developerMessage: '', isOutcomeUnknown: false },
        platform
      );

      expect(error.developerMessage).toBe(UNKNOWN_ROW.meaning);
    });

    it('drops an absent httpStatus', () => {
      expect(
        toUqpayError(
          { code: 'timeout', developerMessage: 'x', isOutcomeUnknown: true },
          platform
        ).httpStatus
      ).toBeUndefined();
    });

    it('falls back to the row meaning when the native sends no developer message', () => {
      const error = toUqpayError(
        { code: 'timeout', developerMessage: '', isOutcomeUnknown: true },
        platform
      );

      expect(error.developerMessage).toBe(findErrorRow('timeout')?.meaning);
    });

    it('never claims isOutcomeUnknown when the native did not', () => {
      const error = toUqpayError(
        {
          code: 'timeout',
          developerMessage: 'x',
          isOutcomeUnknown: undefined as unknown as boolean,
        },
        platform
      );

      expect(error.isOutcomeUnknown).toBe(false);
    });

    it('builds a JS-side error with the documented outcome-unknown default', () => {
      expect(
        localError(
          'invalid_configuration',
          'a sheet is already presented',
          platform
        )
      ).toMatchObject({
        code: 'invalid_configuration',
        isOutcomeUnknown: false,
        isRetryable: false,
      });
      expect(localError('unknown', 'bridge bug', platform, 'ERR_X').raw).toBe(
        'ERR_X'
      );
      // OQ-A1: `unknown` (and therefore any undocumented code) defaults to
      // outcome-known; only `timeout` defaults the other way.
      expect(
        localError('quantum_flux', 'never seen', platform).isOutcomeUnknown
      ).toBe(false);
      expect(
        localError('unknown', 'bridge bug', platform).isOutcomeUnknown
      ).toBe(false);
      expect(
        localError('timeout', 'no answer', platform).isOutcomeUnknown
      ).toBe(true);
    });

    it('agrees with the other platform on every documented row (RN-PAR3)', () => {
      for (const row of ERROR_TABLE) {
        const native = {
          code: row.code,
          developerMessage: 'x',
          isOutcomeUnknown: row.isOutcomeUnknown,
        };
        const ios = toUqpayError(native, 'ios');
        const android = toUqpayError(native, 'android');
        expect({ ...ios, platform: null }).toEqual({
          ...android,
          platform: null,
        });
      }
    });
  }
);

describe('generated artefacts are not stale (RN-DOC4 drift test)', () => {
  it('ERROR_CODES.md matches the table', () => {
    const onDisk = readFileSync(join(ROOT, OUTPUT_PATHS.errorCodesDoc), 'utf8');
    expect(onDisk).toBe(renderErrorCodesDoc());
  });

  it('src/errors/error-table.json matches the table', () => {
    const onDisk = readFileSync(
      join(ROOT, OUTPUT_PATHS.errorTableJson),
      'utf8'
    );
    expect(onDisk).toBe(renderErrorTableJson());
  });

  it.each([OUTPUT_PATHS.iosFixtureDir, OUTPUT_PATHS.androidFixtureDir])(
    '%s holds the current error table and scenario fixtures',
    (dir) => {
      expect(
        readFileSync(join(ROOT, dir, OUTPUT_PATHS.errorTableFixture), 'utf8')
      ).toBe(renderErrorTableJson());
      expect(
        readFileSync(join(ROOT, dir, OUTPUT_PATHS.scenariosFixture), 'utf8')
      ).toBe(renderScenariosJson());
    }
  );
});
