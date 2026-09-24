/**
 * The SDK's only console output: a de-duplicated developer warning for a
 * documented platform limitation. It never receives a token, an amount, a URL
 * or any customer data.
 *
 * @internal
 */
const warned = new Set<string>();

/**
 * Print a developer warning at most once per JS context.
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[@uqpay/react-native] ${message}`);
}

/**
 * Forget which warnings have been printed. Test hook only.
 *
 * @internal
 */
export function resetWarnings(): void {
  warned.clear();
}
