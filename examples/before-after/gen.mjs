// Regenerate output.md from input.md using the current build.
// Usage: node examples/before-after/gen.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../../dist/pipeline/pipeline.js';
import { getDefaults } from '../../dist/config/loader.js';
import { initParser } from '../../dist/ast/extractor.js';

const here = dirname(fileURLToPath(import.meta.url));

await initParser();

const pipeline = new Pipeline({
  ...getDefaults(),
  identity: {
    company: 'Acme Corp',
    domains: ['acme-corp.com', 'acme-corp.local'],
    people: ['Artur Sommer'],
  },
  code: {
    ...getDefaults().code,
    language: 'java',
    domainTerms: ['Partner', 'Customer', 'Invoice', 'Billing'],
    preserve: ['Spring', 'Service', 'Autowired'],
  },
});

const input = readFileSync(resolve(here, 'input.md'), 'utf-8');
const result = await pipeline.anonymize(input);

const body = `# Output — what the LLM actually sees

Input: \`input.md\` (source prompt with secrets, domains, identifiers)
Config: see \`gen.mjs\` (company Acme Corp, domains acme-corp.com/acme-corp.local, people Artur Sommer)

After three-layer anonymization:

\`\`\`
${result.text}
\`\`\`

## What changed

- \`CustomerBillingService\` → pseudonymized (domain term "Customer" was the trigger)
- \`com.acmecorp.customerdb.*\` package paths → reverse-domain anonymized (TLD preserved, company and project renamed)
- \`Acme Corp\`, \`acme-corp.com\`, \`acme-corp.local\` → consistent pseudonyms per session
- \`Artur Sommer\` → pseudonym (configured person)
- \`artur.sommer@acme-corp.com\` → detected via NER dictionary, pseudonymized
- \`hunter2topsecret!\` → \`***REDACTED***\` (password pattern, permanent)
- \`Partner\` → pseudonymized (domain term)
- Spring framework identifiers (\`@Service\`, \`CustomerRepository\` type annotation) preserved where they appear

Rehydration would reverse all pseudonyms when the response comes back through the proxy. The \`***REDACTED***\` marker stays forever — secrets are never restored.

## Reproduce

\`\`\`bash
npm run build
node examples/before-after/gen.mjs
\`\`\`
`;

writeFileSync(resolve(here, 'output.md'), body, 'utf-8');
console.log('Wrote', resolve(here, 'output.md'));
