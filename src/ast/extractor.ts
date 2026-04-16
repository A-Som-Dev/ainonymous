import { getParser, getLanguage, initTreeSitter } from './parser.js';
import { typescriptQueries, type QueryDef } from './langs/typescript.js';
import { JAVA_QUERIES } from './langs/java.js';
import { PYTHON_QUERIES } from './langs/python.js';
import { PHP_QUERIES } from './langs/php.js';
import { KOTLIN_QUERIES } from './langs/kotlin.js';
import { GO_QUERIES } from './langs/go.js';
import { RUST_QUERIES } from './langs/rust.js';
import { CSHARP_QUERIES } from './langs/csharp.js';

export interface IdentifierInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
}

export interface FunctionBody {
  start: number;
  end: number;
}

const BUILTINS = new Set([
  // JS keywords
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'throw',
  'try',
  'catch',
  'finally',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'void',
  'this',
  'super',
  'class',
  'extends',
  'import',
  'export',
  'default',
  'from',
  'as',
  'async',
  'await',
  'yield',
  'let',
  'const',
  'var',
  'function',
  // TS keywords
  'type',
  'interface',
  'enum',
  'namespace',
  'module',
  'declare',
  'abstract',
  'implements',
  'readonly',
  'keyof',
  'infer',
  'is',
  'asserts',
  'override',
  // Standard types
  'string',
  'number',
  'boolean',
  'object',
  'symbol',
  'bigint',
  'undefined',
  'null',
  'void',
  'never',
  'unknown',
  'any',
  // Built-in objects
  'Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'JSON',
  'Math',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Function',
  'Proxy',
  'Reflect',
  'Int8Array',
  'Uint8Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Intl',
  'Iterator',
  // Common globals
  'console',
  'process',
  'global',
  'globalThis',
  'Buffer',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'queueMicrotask',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'AbortSignal',
  'fetch',
  'Headers',
  'Request',
  'Response',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'Blob',
  'File',
  'FormData',
  'Event',
  'EventTarget',
  'CustomEvent',
  // Node built-ins
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  // AInonymity secret marker — must not be pseudonymized back through code layer
  'REDACTED',
  // Standard method names
  'toString',
  'valueOf',
  'equals',
  'hashCode',
  'compareTo',
  'clone',
  'getClass',
  'notify',
  'notifyAll',
  'wait',
  'finalize',
  // Common type/interface names
  'Optional',
  'Stream',
  'List',
  'Collection',
  'Iterator',
  'Mapping',
  'Consumer',
  'Producer',
  'Supplier',
  'Function',
  'Predicate',
  // Java builtins
  'String',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'Byte',
  'Short',
  'Character',
  'Class',
  'System',
  'Thread',
  'Runnable',
  'Callable',
  'Comparable',
  'ArrayList',
  'LinkedList',
  'Map',
  'HashMap',
  'TreeMap',
  'HashSet',
  'Collections',
  'Arrays',
  'Exception',
  'RuntimeException',
  'IOException',
  'NullPointerException',
  'Override',
  'Deprecated',
  'SuppressWarnings',
  'FunctionalInterface',
  'Serializable',
  'Cloneable',
  'Iterable',
  'AutoCloseable',
  'StringBuilder',
  'StringBuffer',
  'Random',
  'Logger',
  'LoggerFactory',
  // Python builtins
  'self',
  'cls',
  'None',
  'True',
  'False',
  'print',
  'len',
  'range',
  'enumerate',
  'zip',
  'dict',
  'list',
  'tuple',
  'set',
  'frozenset',
  'str',
  'int',
  'float',
  'bool',
  'bytes',
  'type',
  'object',
  'super',
  'property',
  'staticmethod',
  'classmethod',
  'ValueError',
  'KeyError',
  'IndexError',
  'RuntimeError',
  'os',
  'sys',
  're',
  'json',
  'math',
  'datetime',
  'pathlib',
  'typing',
  '__init__',
  '__str__',
  '__repr__',
  '__eq__',
  '__hash__',
  '__len__',
  '__iter__',
  '__enter__',
  '__exit__',
  '__call__',
  '__getattr__',
  '__setattr__',
  // PHP builtins
  '$this',
  'parent',
  'static',
  'null',
  'true',
  'false',
  'array',
  'mixed',
  'never',
  'stdClass',
  'Closure',
  'Countable',
  'echo',
  'isset',
  'empty',
  'unset',
  'die',
  'exit',
  'strlen',
  'strpos',
  'substr',
  'explode',
  'implode',
  'trim',
  'array_map',
  'array_filter',
  'array_merge',
  'array_push',
  'in_array',
  'count',
  'json_encode',
  'json_decode',
  'file_get_contents',
  'preg_match',
  // Go builtins
  'main',
  'init',
  'fmt',
  'Println',
  'Printf',
  'Sprintf',
  'Fprintf',
  'error',
  'Error',
  'Stringer',
  'Reader',
  'Writer',
  'Closer',
  'context',
  'Context',
  'Background',
  'TODO',
  'WithCancel',
  'WithTimeout',
  'http',
  'Handler',
  'HandlerFunc',
  'ResponseWriter',
  'Server',
  'sync',
  'Mutex',
  'RWMutex',
  'WaitGroup',
  'Once',
  'make',
  'append',
  'cap',
  'copy',
  'panic',
  'recover',
  'close',
  'goroutine',
  'chan',
  'select',
  'defer',
  'go',
  // Rust builtins
  'main',
  'Self',
  'self',
  'impl',
  'mod',
  'pub',
  'crate',
  'use',
  'Vec',
  'Box',
  'Rc',
  'Arc',
  'Cell',
  'RefCell',
  'Mutex',
  'RwLock',
  'Option',
  'Some',
  'None',
  'Result',
  'Ok',
  'Err',
  'Display',
  'Debug',
  'Clone',
  'Copy',
  'Default',
  'Drop',
  'From',
  'Into',
  'AsRef',
  'AsMut',
  'Deref',
  'DerefMut',
  'Iterator',
  'println',
  'eprintln',
  'format',
  'panic',
  'assert',
  'todo',
  'unimplemented',
  'String',
  'str',
  'usize',
  'isize',
  'u8',
  'u16',
  'u32',
  'u64',
  'i32',
  'i64',
  'f32',
  'f64',
  // C# builtins
  'Program',
  'Main',
  'Console',
  'WriteLine',
  'ReadLine',
  'Task',
  'ValueTask',
  'CancellationToken',
  'IDisposable',
  'IAsyncDisposable',
  'IEnumerable',
  'IQueryable',
  'ICollection',
  'IList',
  'IDictionary',
  'Enumerable',
  'Queryable',
  'Linq',
  'Extensions',
  'HttpClient',
  'HttpContext',
  'ILogger',
  'IConfiguration',
  'IServiceCollection',
  'Guid',
  'DateTime',
  'TimeSpan',
  'Decimal',
  'Nullable',
  'Attribute',
  'Obsolete',
  'Serializable',
  'Required',
  'Key',
  'NotNull',
  'Action',
  'Func',
  'EventHandler',
  'Delegate',
  // Short/generic names not worth anonymizing
  'i',
  'j',
  'k',
  'x',
  'y',
  'z',
  'n',
  'e',
  'err',
  'cb',
  'fn',
  'el',
  'a',
  'b',
  'c',
  'v',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'w',
  '_',
  'id',
  'key',
  'val',
  'arg',
  'args',
  'res',
  'req',
  'ctx',
  'sum',
  'tmp',
  'acc',
  'idx',
  'len',
  'max',
  'min',
  'ref',
  'src',
  'dst',
  'ok',
  'db',
  'app',
]);

function getQueries(lang: string): QueryDef[] {
  switch (lang) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return typescriptQueries;
    case 'java':
      return JAVA_QUERIES;
    case 'python':
      return PYTHON_QUERIES;
    case 'php':
      return PHP_QUERIES;
    case 'kotlin':
      return KOTLIN_QUERIES;
    case 'go':
      return GO_QUERIES;
    case 'rust':
      return RUST_QUERIES;
    case 'c_sharp':
    case 'csharp':
      return CSHARP_QUERIES;
    default:
      return [];
  }
}

// queries that capture function/method body nodes per language
const BODY_QUERIES: Record<string, string[]> = {
  typescript: [
    '(function_declaration body: (statement_block) @body)',
    '(method_definition body: (statement_block) @body)',
    '(arrow_function body: (statement_block) @body)',
  ],
  tsx: [
    '(function_declaration body: (statement_block) @body)',
    '(method_definition body: (statement_block) @body)',
    '(arrow_function body: (statement_block) @body)',
  ],
  javascript: [
    '(function_declaration body: (statement_block) @body)',
    '(method_definition body: (statement_block) @body)',
    '(arrow_function body: (statement_block) @body)',
  ],
  java: [
    '(method_declaration body: (block) @body)',
    '(constructor_declaration body: (constructor_body) @body)',
  ],
  kotlin: ['(function_declaration (function_body) @body)'],
  python: ['(function_definition body: (block) @body)'],
  go: ['(function_declaration body: (block) @body)', '(method_declaration body: (block) @body)'],
  rust: ['(function_item body: (block) @body)'],
  c_sharp: [
    '(method_declaration body: (block) @body)',
    '(constructor_declaration body: (block) @body)',
  ],
  csharp: [
    '(method_declaration body: (block) @body)',
    '(constructor_declaration body: (block) @body)',
  ],
  php: [
    '(function_definition body: (compound_statement) @body)',
    '(method_declaration body: (compound_statement) @body)',
  ],
};

// queries that capture value expressions of top-level constants/variables
const TOP_LEVEL_VALUE_QUERIES: Record<string, string[]> = {
  typescript: [
    '(program (lexical_declaration (variable_declarator value: (_) @value)))',
    '(program (variable_declaration (variable_declarator value: (_) @value)))',
    '(program (export_statement (lexical_declaration (variable_declarator value: (_) @value))))',
  ],
  tsx: [
    '(program (lexical_declaration (variable_declarator value: (_) @value)))',
    '(program (variable_declaration (variable_declarator value: (_) @value)))',
    '(program (export_statement (lexical_declaration (variable_declarator value: (_) @value))))',
  ],
  javascript: [
    '(program (lexical_declaration (variable_declarator value: (_) @value)))',
    '(program (variable_declaration (variable_declarator value: (_) @value)))',
    '(program (export_statement (lexical_declaration (variable_declarator value: (_) @value))))',
  ],
  python: ['(module (expression_statement (assignment right: (_) @value)))'],
  kotlin: [
    '(source_file (property_declaration (line_string_literal) @value))',
    '(source_file (property_declaration (string_literal) @value))',
    '(source_file (property_declaration (integer_literal) @value))',
    '(source_file (property_declaration (boolean_literal) @value))',
    '(source_file (property_declaration (call_expression) @value))',
  ],
  go: [
    '(source_file (const_declaration (const_spec value: (expression_list (_) @value))))',
    '(source_file (var_declaration (var_spec value: (expression_list (_) @value))))',
  ],
};

export async function extractFunctionBodies(code: string, lang: string): Promise<FunctionBody[]> {
  const patterns = BODY_QUERIES[lang];
  if (!patterns?.length) return [];

  const parser = await getParser(lang);
  const language = await getLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) return [];

  const bodies: FunctionBody[] = [];

  for (const pat of patterns) {
    let query;
    try {
      query = language.query(pat);
    } catch {
      continue;
    }
    const captures = query.captures(tree.rootNode);
    for (const cap of captures) {
      bodies.push({
        start: cap.node.startIndex,
        end: cap.node.endIndex,
      });
    }
    query.delete();
  }

  tree.delete();

  // sort by start position for consistent processing
  bodies.sort((a, b) => a.start - b.start);
  return bodies;
}

export async function extractTopLevelValues(code: string, lang: string): Promise<FunctionBody[]> {
  const patterns = TOP_LEVEL_VALUE_QUERIES[lang];
  if (!patterns?.length) return [];

  const parser = await getParser(lang);
  const language = await getLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) return [];

  const values: FunctionBody[] = [];

  for (const pat of patterns) {
    let query;
    try {
      query = language.query(pat);
    } catch {
      continue;
    }
    const captures = query.captures(tree.rootNode);
    for (const cap of captures) {
      values.push({
        start: cap.node.startIndex,
        end: cap.node.endIndex,
      });
    }
    query.delete();
  }

  tree.delete();

  values.sort((a, b) => a.start - b.start);
  return dedupeRanges(values);
}

function dedupeRanges(ranges: FunctionBody[]): FunctionBody[] {
  const out: FunctionBody[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && last.start === r.start && last.end === r.end) continue;
    out.push(r);
  }
  return out;
}

export async function initParser(): Promise<void> {
  await initTreeSitter();
}

export async function extractIdentifiers(
  code: string,
  lang: string,
  preserve: string[] = [],
): Promise<IdentifierInfo[]> {
  const parser = await getParser(lang);
  const language = await getLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) return [];

  const queries = getQueries(lang);
  const preserveSet = new Set(preserve);
  const seen = new Set<string>();
  const results: IdentifierInfo[] = [];

  for (const def of queries) {
    const query = language.query(def.pattern);
    const captures = query.captures(tree.rootNode);

    for (const capture of captures) {
      const name = capture.node.text;

      if (seen.has(name)) continue;
      if (BUILTINS.has(name)) continue;
      if (preserveSet.has(name)) continue;

      seen.add(name);
      results.push({
        name,
        kind: def.kind,
        line: capture.node.startPosition.row + 1,
        column: capture.node.startPosition.column,
      });
    }

    query.delete();
  }

  tree.delete();
  return results;
}
