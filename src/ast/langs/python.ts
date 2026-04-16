import type { QueryDef } from './typescript.js';

export const PYTHON_QUERIES: QueryDef[] = [
  { kind: 'class', pattern: '(class_definition name: (identifier) @name)' },
  { kind: 'function', pattern: '(function_definition name: (identifier) @name)' },
  { kind: 'variable', pattern: '(assignment left: (identifier) @name)' },
];
