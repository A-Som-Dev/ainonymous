import type { QueryDef } from './typescript.js';

export const RUST_QUERIES: QueryDef[] = [
  { kind: 'function', pattern: '(function_item name: (identifier) @name)' },
  { kind: 'type', pattern: '(struct_item name: (type_identifier) @name)' },
  { kind: 'type', pattern: '(enum_item name: (type_identifier) @name)' },
  { kind: 'type', pattern: '(trait_item name: (type_identifier) @name)' },
  { kind: 'type', pattern: '(type_item name: (type_identifier) @name)' },
  { kind: 'variable', pattern: '(let_declaration pattern: (identifier) @name)' },
  { kind: 'variable', pattern: '(const_item name: (identifier) @name)' },
  { kind: 'variable', pattern: '(static_item name: (identifier) @name)' },
];
