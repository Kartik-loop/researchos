import { runApiSecurityChecks } from "./api-security";
// Run against an isolated local application/database with the ingestion worker stopped.
await runApiSecurityChecks();
