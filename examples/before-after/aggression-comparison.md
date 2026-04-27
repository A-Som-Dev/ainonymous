# Aggression modes compared

Same Java input, three different `behavior.aggression` settings. This is the single most important knob introduced in v1.2. it decides how much semantic context the upstream LLM still gets after anonymization.

## Config common to all three runs

```yaml
identity:
  company: 'Acme Corp'
  domains: ['acme-corp.com', 'acme-corp.local']
  people: ['Artur Sommer']

code:
  language: java
  domain_terms: ['Customer', 'Invoice', 'Billing']
  preserve: ['Spring', 'Service', 'Autowired', 'Repository']
```

The only thing that changes between runs is `behavior.aggression`.

## Input (`CustomerService.java`)

```java
package com.acmecorp.customerdb.service;

import com.acmecorp.customerdb.model.Customer;
import org.springframework.stereotype.Service;

@Service
public class CustomerBillingService {
    private static final String API = "https://api.acme-corp.local/v2";
    private static final String DB_PASSWORD = "hunter2topsecret!"; // ainonymous:allow

    private final CustomerRepository repo;

    public CustomerBillingService(CustomerRepository repo) { this.repo = repo; }

    public void processInvoice(Customer customer) {
        // author: Artur Sommer, contact: artur.sommer@acme-corp.com
        System.out.println("Billing " + customer.getEmail());
    }
}
```

## `aggression: low`. conservative, max LLM context

```java
package com.acmecorp.customerdb.service;

import com.acmecorp.customerdb.model.AlphaEntity;
import org.springframework.stereotype.Service;

@Service
public class AlphaBillingService {
    private static final String API = "https://api.company-alpha.local/v2";
    private static final String DB_PASSWORD = ***REDACTED***;

    private final AlphaRepository repo;

    public AlphaBillingService(AlphaRepository repo) { this.repo = repo; }

    public void processInvoice(AlphaEntity customer) {
        // author: Person Alpha, contact: user1@company-alpha.com
        System.out.println("Billing " + customer.getEmail());
    }
}
```

**What got rewritten**: only the explicit domain terms (`Customer` → `Alpha`), identity (`Artur Sommer`, email, `acme-corp.local`), and secrets. Package path, method names, framework annotations, and most identifiers stay untouched. The LLM can still reason about the class being a Spring service that processes invoices.

**When to use**: code reviews, refactoring suggestions, small trusted repos.

## `aggression: medium` (default). balanced

```java
package com.acmecorp.customerdb.service;

import com.acmecorp.customerdb.model.AlphaEntity;
import org.springframework.stereotype.Service;

@Service
public class AlphaBetaService {
    private static final String API = "https://api.company-alpha.local/v2";
    private static final String DB_PASSWORD = ***REDACTED***;

    private final AlphaRepository repo;

    public AlphaBetaService(AlphaRepository repo) { this.repo = repo; }

    public void processBeta(AlphaEntity customer) {
        // author: Person Alpha, contact: user1@company-alpha.com
        System.out.println("Billing " + customer.getEmail());
    }
}
```

**What changed vs. low**: compound identifiers containing a domain term now get rewritten too. `CustomerBillingService` → `AlphaBetaService` (both `Customer` and `Billing` are in `domain_terms`). `processInvoice` → `processBeta` (because `Invoice` is a domain term). `Service` suffix preserved because it is on `preserve`.

**When to use**: default for most teams. Keeps framework semantics, hides project nouns.

## `aggression: high`. paranoid, pre-v1.2 default

```java
package de.Kappa.Lambda.Mu;

import de.Kappa.Lambda.Nu.AlphaEntity;
import org.springframework.stereotype.Service;

@Service
public class AlphaBetaService {
    private static final String Xi = "https://api.company-alpha.local/v2";
    private static final String Omicron = ***REDACTED***;

    private final AlphaRepository Pi;

    public AlphaBetaService(AlphaRepository Pi) { this.Pi = Pi; }

    public void processBeta(AlphaEntity Rho) {
        // Sigma: Person Alpha, Tau: user1@company-alpha.com
        System.out.println("Billing " + Rho.getEmail());
    }
}
```

**What changed vs. medium**: every AST identifier that is not on `preserve` becomes a Greek-alphabet pseudonym. Parameter names (`repo`, `customer`), the local constant names (`API`, `DB_PASSWORD`), even the comment words `author` and `contact` get pseudonymized. The package path reverses too.

**When to use**: heavily sensitive repos (cryptography, proprietary algorithms, defense), or file globs in `code.sensitive_paths` (which force `high` regardless of the global setting).

**Tradeoff**: the LLM loses a lot of semantic context. Expect worse refactoring suggestions and flat-out wrong answers on domain questions. Benchmark on your own prompts before shipping this as a default.

## Rule of thumb

| Repo type                                         | Recommended mode                         |
| ------------------------------------------------- | ---------------------------------------- |
| Internal CRUD, web apps, typical SaaS backend     | `medium`                                 |
| Open-source libraries, public docs, tutorials     | `low`                                    |
| Payment, auth, cryptography, compliance-sensitive | `high` (or `medium` + `sensitive_paths`) |

Measure before switching. `ainonymous scan` shows exactly which identifiers each mode would rewrite in your repo without running a real session.
