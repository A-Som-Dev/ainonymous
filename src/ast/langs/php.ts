import type { QueryDef } from './typescript.js';

export const PHP_QUERIES: QueryDef[] = [
  { kind: 'class', pattern: '(class_declaration name: (name) @name)' },
  { kind: 'interface', pattern: '(interface_declaration name: (name) @name)' },
  { kind: 'function', pattern: '(function_definition name: (name) @name)' },
  { kind: 'method', pattern: '(method_declaration name: (name) @name)' },
  { kind: 'variable', pattern: '(assignment_expression left: (variable_name (name) @name))' },
];
