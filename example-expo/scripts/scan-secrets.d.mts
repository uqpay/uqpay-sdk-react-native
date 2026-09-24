/**
 * Types for `scan-secrets.mjs`, which is plain JS on purpose: it is loaded by
 * `node --test` without a build step, so it cannot be TypeScript.
 */

export type Violation = {
  /** Path relative to `example/`. */
  file: string;
  line: number;
  text: string;
  rule: string;
};

export type Rule = { pattern: RegExp; rule: string };

export declare const APP_RULES: Rule[];
export declare const BACKEND_RULES: Rule[];

export declare function listSourceFiles(
  root: string,
  accept?: (relativePath: string) => boolean
): string[];

export declare function scanFiles(files: string[], rules: Rule[], root: string): Violation[];

/** Scans `example/src` + `example/scripts` for app-side violations. */
export declare function scanAppSources(exampleDir: string): Violation[];

/** Scans `example/backend` for credential logging. */
export declare function scanBackendSources(exampleDir: string): Violation[];

export declare function formatViolations(violations: Violation[]): string;
