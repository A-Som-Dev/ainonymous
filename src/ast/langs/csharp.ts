import type { QueryDef } from './typescript.js';

export const CSHARP_QUERIES: QueryDef[] = [
  { kind: 'class', pattern: '(class_declaration name: (identifier) @name)' },
  { kind: 'interface', pattern: '(interface_declaration name: (identifier) @name)' },
  { kind: 'enum', pattern: '(enum_declaration name: (identifier) @name)' },
  { kind: 'type', pattern: '(struct_declaration name: (identifier) @name)' },
  { kind: 'type', pattern: '(record_declaration name: (identifier) @name)' },
  { kind: 'method', pattern: '(method_declaration name: (identifier) @name)' },
  { kind: 'function', pattern: '(constructor_declaration name: (identifier) @name)' },
  { kind: 'variable', pattern: '(variable_declarator (identifier) @name)' },
  { kind: 'property', pattern: '(property_declaration name: (identifier) @name)' },
];
