// check-text.mjs の型（tests/unit/check-text.test.ts が使う。BL-077）
export interface TextRule {
  id: string;
  cat: string;
  type: 'sub' | 'word';
  words: string[];
  except?: string[];
  reason?: string;
}
export interface CompiledRule extends TextRule {
  readonly __compiled?: true;
}
export interface TextHit {
  rule: string;
  word: string;
  file?: string;
  key?: string;
  line?: number;
  text?: string;
  name?: boolean;
}
export interface AllowEntry {
  file: string;
  key?: string;
  line?: string;
  rule: string;
  word: string;
  reason: string;
  approvedBy: string;
  date: string;
}
export function normSub(s: string): string;
export function normWord(s: string): string;
export function compileRules(rules: readonly TextRule[]): CompiledRule[];
export function checkText(text: string, compiled: readonly CompiledRule[], opts?: { fileName?: boolean }): TextHit[];
export function allowlistProblems(list: unknown): string[];
export function isAllowed(list: readonly Partial<AllowEntry>[], hit: TextHit): boolean;
export function isTarget(file: string): boolean;
export function checkFile(file: string, body: string, compiled: readonly CompiledRule[]): TextHit[];
