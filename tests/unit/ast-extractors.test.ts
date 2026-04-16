import { describe, it, expect, beforeAll } from 'vitest';
import { extractIdentifiers, initParser } from '../../src/ast/extractor.js';

interface ExtractCase {
  title: string;
  code: string;
  contains?: string[];
  excludes?: string[];
  // some langs accept multiple aliases (c_sharp vs csharp) - override the describe-level lang
  langOverride?: string;
}

interface LangSuite {
  label: string;
  lang: string;
  cases: ExtractCase[];
}

const suites: LangSuite[] = [
  {
    label: 'C#',
    lang: 'c_sharp',
    cases: [
      {
        title: 'extracts class names',
        code: `public class CustomerService { public void Process() {} }`,
        contains: ['CustomerService'],
      },
      {
        title: 'extracts interface names',
        code: `public interface IOrderRepository { Order FindById(int id); }`,
        contains: ['IOrderRepository'],
      },
      {
        title: 'extracts method names',
        code: `public class Svc { public async Task<List<Payment>> GetPayments() { return null; } }`,
        contains: ['GetPayments'],
      },
      {
        title: 'filters builtins',
        code: `using System; public class Svc { public void Main() { Console.WriteLine("hi"); } }`,
        excludes: ['Console', 'Main'],
      },
      {
        title: 'works with csharp alias (not just c_sharp)',
        code: `public class InvoiceProcessor { public void Run() {} }`,
        contains: ['InvoiceProcessor'],
        langOverride: 'csharp',
      },
    ],
  },
  {
    label: 'Go',
    lang: 'go',
    cases: [
      {
        title: 'extracts function names',
        code: `package main\nfunc ProcessCustomer() {}`,
        contains: ['ProcessCustomer'],
      },
      {
        title: 'extracts struct names',
        code: `package main\ntype OrderService struct { db *DB }`,
        contains: ['OrderService'],
      },
      {
        title: 'filters builtins',
        code: `package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }`,
        excludes: ['main', 'fmt'],
      },
      {
        title: 'extracts constants',
        code: `package main\nconst MaxRetries = 3`,
        contains: ['MaxRetries'],
      },
    ],
  },
  {
    label: 'Java',
    lang: 'java',
    cases: [
      {
        title: 'extracts class names',
        code: `public class CustomerService { public void getCustomer() {} }`,
        contains: ['CustomerService'],
      },
      {
        title: 'extracts method names',
        code: `public class Svc { public List<Order> findAllOrders() { return null; } }`,
        contains: ['findAllOrders'],
      },
      {
        title: 'filters builtins',
        code: `import java.util.List; public class Svc { private String name; }`,
        excludes: ['String', 'List'],
      },
      {
        title: 'extracts interface names',
        code: `public interface OrderRepository { Order findById(int id); }`,
        contains: ['OrderRepository'],
      },
      {
        title: 'extracts enum names',
        code: `public enum PaymentStatus { PENDING, COMPLETED, FAILED }`,
        contains: ['PaymentStatus'],
      },
      {
        title: 'extracts constructor names',
        code: `public class AccountManager { public AccountManager(String name) {} }`,
        contains: ['AccountManager'],
      },
    ],
  },
  {
    label: 'Python',
    lang: 'python',
    cases: [
      {
        title: 'extracts class names',
        code: `class CustomerManager:\n    def get_customer(self, id):\n        pass`,
        contains: ['CustomerManager'],
      },
      {
        title: 'extracts function names',
        code: `def calculate_discount(price, rate):\n    return price * rate`,
        contains: ['calculate_discount'],
      },
      {
        title: 'filters builtins',
        code: `class Svc:\n    def __init__(self):\n        self.name = "test"`,
        excludes: ['self', '__init__'],
      },
      {
        title: 'extracts assignment targets',
        code: `order_total = calculate_price(items)`,
        contains: ['order_total'],
      },
      {
        title: 'extracts nested class methods',
        code: `class InvoiceService:\n    def generate_invoice(self, order):\n        pass\n    def send_notification(self, user):\n        pass`,
        contains: ['InvoiceService', 'generate_invoice', 'send_notification'],
      },
    ],
  },
  {
    label: 'Rust',
    lang: 'rust',
    cases: [
      {
        title: 'extracts function names',
        code: `fn process_order(id: u32) -> Result<(), String> { Ok(()) }`,
        contains: ['process_order'],
      },
      {
        title: 'extracts struct names',
        code: `struct CustomerAccount { name: String, balance: f64 }`,
        contains: ['CustomerAccount'],
      },
      {
        title: 'extracts enum names',
        code: `enum PaymentStatus { Pending, Completed, Failed }`,
        contains: ['PaymentStatus'],
      },
      {
        title: 'filters builtins',
        code: `fn main() { let x: Vec<String> = Vec::new(); println!("{}", x.len()); }`,
        excludes: ['main', 'Vec'],
      },
    ],
  },
];

describe.each(suites)('$label AST extraction', ({ lang, cases }) => {
  beforeAll(async () => {
    await initParser();
  });

  it.each(cases)('$title', async ({ code, contains, excludes, langOverride }) => {
    const ids = await extractIdentifiers(code, langOverride ?? lang);
    const names = ids.map((i) => i.name);

    for (const expected of contains ?? []) {
      expect(names).toContain(expected);
    }
    for (const forbidden of excludes ?? []) {
      expect(names).not.toContain(forbidden);
    }
  });
});
