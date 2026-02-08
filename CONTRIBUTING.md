# Contributing to AgentGuard

Thanks for your interest in making AI agents safer! 🛡️

## Quick Start

```bash
git clone https://github.com/0xAxiom/agentguard.git
cd agentguard
npm install
npm test        # Run 242 tests
npm run demo    # See it in action
```

## Development

```bash
npm run build   # TypeScript → dist/
npm test        # Vitest (all tests)
npm run lint    # ESLint
```

## Project Structure

```
src/
├── guard.ts           # Main AgentGuard orchestrator
├── firewall/          # Transaction Firewall (spending limits, allowlists)
├── sanitizer/         # Prompt Sanitizer (injection detection)
├── isolator/          # Secret Isolator (key/seed redaction)
├── audit/             # Audit Logger (local + on-chain)
└── wrapper/           # Solana Agent Kit integration
programs/
└── agentguard-audit/  # Anchor program (on-chain audit trail)
tests/                 # Vitest test suites
examples/              # Demo scripts and integration examples
```

## Adding a Security Pattern

1. Add the pattern to `src/sanitizer/patterns.ts`
2. Add tests in `tests/sanitizer.test.ts`
3. Run `npm test` to verify
4. Update the pattern count in README if needed

## Adding a Firewall Rule

1. Implement in `src/firewall/`
2. Add tests in `tests/firewall.test.ts`
3. Ensure the rule integrates with `AgentGuard.checkTransaction()`

## Pull Requests

- Keep PRs focused on a single change
- Include tests for new features
- Run `npm test && npm run build` before submitting
- Follow existing code style

## Reporting Security Issues

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

MIT — see [LICENSE](LICENSE).
