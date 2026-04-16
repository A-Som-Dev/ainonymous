export interface QueryDef {
  kind: string;
  pattern: string;
}

export const typescriptQueries: QueryDef[] = [
  { kind: 'class', pattern: '(class_declaration name: (type_identifier) @name)' },
  { kind: 'interface', pattern: '(interface_declaration name: (type_identifier) @name)' },
  { kind: 'enum', pattern: '(enum_declaration name: (identifier) @name)' },
  { kind: 'type', pattern: '(type_alias_declaration name: (type_identifier) @name)' },
  { kind: 'function', pattern: '(function_declaration name: (identifier) @name)' },
  { kind: 'method', pattern: '(method_definition name: (property_identifier) @name)' },
  { kind: 'variable', pattern: '(variable_declarator name: (identifier) @name)' },
];
