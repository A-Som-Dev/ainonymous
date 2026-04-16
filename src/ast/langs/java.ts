import type { QueryDef } from './typescript.js';

export const JAVA_QUERIES: QueryDef[] = [
  { kind: 'class', pattern: '(class_declaration name: (identifier) @name)' },
  { kind: 'interface', pattern: '(interface_declaration name: (identifier) @name)' },
  { kind: 'enum', pattern: '(enum_declaration name: (identifier) @name)' },
  { kind: 'method', pattern: '(method_declaration name: (identifier) @name)' },
  { kind: 'variable', pattern: '(variable_declarator name: (identifier) @name)' },
  { kind: 'function', pattern: '(constructor_declaration name: (identifier) @name)' },
];
