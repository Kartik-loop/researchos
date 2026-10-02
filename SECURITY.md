# Security policy

Security fixes target the latest `main` branch. This project has not undergone an independent security audit.

Report vulnerabilities privately to the repository owner, or use GitHub's **Report a vulnerability** option when available. Do not open a public issue containing credentials, paper contents, or exploit details affecting a live deployment.

Include affected versions, reproduction steps, expected impact, and a minimal sanitized example. Never include a real API key or user database. If credentials are exposed, revoke them at the provider and replace them in the deployment secret store.

See [deployment guidance](docs/DEPLOYMENT.md) for HTTPS, database permissions, backups, registration policy, and known production limitations.
