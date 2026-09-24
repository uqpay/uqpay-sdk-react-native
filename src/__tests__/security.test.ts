/**
 * AC RN-SEC7 — token-provider hygiene. The merchant's token is handed to
 * native once and must never appear in a log line, an error message, or any
 * object the SDK hands back.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import mock from '../jest';
import {
  addPaymentListener,
  getPendingResult,
  init,
  presentPaymentSheet,
} from '../client';
import { UQPAY_EVENT_PAYMENT_RECONCILED } from '../nativeEvents';
import {
  PLATFORMS,
  initOptions,
  presentOptions,
  resetSdk,
  type TestPlatform,
} from './helpers';

const CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
] as const;

describe.each(PLATFORMS)(
  'token hygiene on %s (RN-SEC7)',
  (platform: TestPlatform) => {
    let captured: string[] = [];
    const spies: Array<{ mockRestore: () => void }> = [];

    beforeEach(() => {
      resetSdk(platform);
      captured = [];
      for (const method of CONSOLE_METHODS) {
        spies.push(
          jest
            .spyOn(console, method)
            .mockImplementation((...args: unknown[]) => {
              captured.push(args.map((arg) => String(arg)).join(' '));
            })
        );
      }
    });

    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    it('never writes the sentinel token to console.* on the happy path', async () => {
      await init(initOptions());
      mock.__nextResult({
        kind: 'completed',
        paymentIntentId: 'pi_matrix_0001',
        status: 'SUCCEEDED',
        platform,
        resultId: 'r1',
      });
      const result = await presentPaymentSheet(presentOptions());
      await Promise.resolve();

      expect(mock.__calls.provideToken[0]?.authToken).toBe(
        mock.__sentinelToken
      );
      expect(captured.join('\n')).not.toContain(mock.__sentinelToken);
      expect(JSON.stringify(result)).not.toContain(mock.__sentinelToken);
    });

    it('never puts the token into a failToken developer message', async () => {
      await init(
        initOptions({
          tokenProvider: () => Promise.reject(new Error('token endpoint 500')),
        })
      );
      mock.__nextResult({
        kind: 'failed',
        paymentIntentId: 'pi_matrix_0001',
        error: {
          code: 'authentication_failed',
          developerMessage: 'token provider failed',
          isOutcomeUnknown: false,
        },
        platform,
        resultId: 'r1',
      });
      const result = await presentPaymentSheet(presentOptions());
      await Promise.resolve();

      const messages = mock.__calls.failToken
        .map((call) => call.developerMessage)
        .join('\n');
      expect(messages).toContain('token endpoint 500');
      expect(messages).not.toContain(mock.__sentinelToken);
      expect(captured.join('\n')).not.toContain(mock.__sentinelToken);
      expect(JSON.stringify(result)).not.toContain(mock.__sentinelToken);
    });

    it('never leaks the token through events or the pending buffer', async () => {
      await init(initOptions());
      const seen: unknown[] = [];
      const subscription = addPaymentListener((event) => seen.push(event));

      mock.__pending({
        kind: 'pending',
        paymentIntentId: 'pi_matrix_0001',
        error: {
          code: 'timeout',
          developerMessage: 'no answer',
          isOutcomeUnknown: true,
        },
        platform,
        resultId: 'r1',
      });
      const buffered = await getPendingResult();
      mock.__emit(UQPAY_EVENT_PAYMENT_RECONCILED, {
        kind: 'completed',
        paymentIntentId: 'pi_matrix_0001',
        status: 'SUCCEEDED',
        platform,
        resultId: 'r2',
      });
      subscription.remove();

      expect(JSON.stringify(seen)).not.toContain(mock.__sentinelToken);
      expect(JSON.stringify(buffered)).not.toContain(mock.__sentinelToken);
      expect(captured.join('\n')).not.toContain(mock.__sentinelToken);
    });

    it('writes nothing at all to console on the happy path (RN-SEC6)', async () => {
      await init(initOptions());
      mock.__nextResult({
        kind: 'completed',
        paymentIntentId: 'pi_matrix_0001',
        status: 'SUCCEEDED',
        platform,
        resultId: 'r1',
      });
      await presentPaymentSheet(presentOptions());

      expect(captured).toEqual([]);
    });
  }
);
