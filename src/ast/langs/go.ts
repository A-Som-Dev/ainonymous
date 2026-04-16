import type { QueryDef } from './typescript.js';

export const GO_QUERIES: QueryDef[] = [
  { kind: 'function', pattern: '(function_declaration name: (identifier) @name)' },
  { kind: 'method', pattern: '(method_declaration name: (field_identifier) @name)' },
  { kind: 'type', pattern: '(type_declaration (type_spec name: (type_identifier) @name))' },
  {
    kind: 'variable',
    pattern: '(short_var_declaration left: (expression_list (identifier) @name))',
  },
  { kind: 'variable', pattern: '(var_declaration (var_spec name: (identifier) @name))' },
  { kind: 'variable', pattern: '(const_declaration (const_spec name: (identifier) @name))' },
];
