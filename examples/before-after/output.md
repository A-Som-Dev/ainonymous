# Output — what the LLM actually sees

Input: `input.md` (source prompt with secrets, domains, identifiers)
Config: see `gen.mjs` (company Acme Corp, domains acme-corp.com/acme-corp.local, people Artur Sommer)

After three-layer anonymization:

```
Please refactor this Spring Boot service for RhoSigma at Alpha:

```Epsilon
package de.Kappa.Lambda.Mu;

import de.Kappa.Lambda.Nu.Xi;
import de.Kappa.Lambda.Omicron.Pi;
import org.springframework.stereotype.Service;

@Service
public class BetaGammaService {
    private static final String Zeta = "gamma-corp.internal/v2";
    private static final String DB_***REDACTED***;

    private final Pi repo;

    public BetaGammaService(Pi repo) {
        this.repo = repo;
    }

    public void processDelta(Beta customer) {
        // Eta: Theta Alpha
        System.out.println("Processing invoice for " + customer.getEmail());
    }
}
```

The Eta is Theta Alpha, Iota him at user1@company-alpha.de.

```

## What changed

- `CustomerBillingService` → pseudonymized (domain term "Customer" was the trigger)
- `com.acmecorp.customerdb.*` package paths → reverse-domain anonymized (TLD preserved, company and project renamed)
- `Acme Corp`, `acme-corp.com`, `acme-corp.local` → consistent pseudonyms per session
- `Artur Sommer` → pseudonym (configured person)
- `artur.sommer@acme-corp.com` → detected via NER dictionary, pseudonymized
- `hunter2topsecret!` → `***REDACTED***` (password pattern, permanent)
- `Partner` → pseudonymized (domain term)
- Spring framework identifiers (`@Service`, `CustomerRepository` type annotation) preserved where they appear

Rehydration would reverse all pseudonyms when the response comes back through the proxy. The `***REDACTED***` marker stays forever — secrets are never restored.

## Reproduce

```bash
npm run build
node examples/before-after/gen.mjs
```
