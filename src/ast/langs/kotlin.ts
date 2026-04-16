import type { QueryDef } from './typescript.js';

export const KOTLIN_QUERIES: QueryDef[] = [
  { kind: 'class', pattern: '(class_declaration (type_identifier) @name)' },
  { kind: 'object', pattern: '(object_declaration (type_identifier) @name)' },
  { kind: 'function', pattern: '(function_declaration (simple_identifier) @name)' },
  {
    kind: 'variable',
    pattern: '(property_declaration (variable_declaration (simple_identifier) @name))',
  },
];
