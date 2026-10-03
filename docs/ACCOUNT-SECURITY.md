# Account verification and password recovery

Delivery uses the **Gmail HTTPS API** because Render Free blocks SMTP ports. Gmail passwords and app passwords are not used.

## Gmail configuration

1. In your Google Cloud project, enable Gmail API and configure the OAuth consent screen. Add your sending Gmail account as a test user for initial testing.
2. Create a Web application OAuth client. For manual setup using Google's OAuth Playground, add `https://developers.google.com/oauthplayground` as an authorized redirect URI. In the Playground settings, select **Use your own OAuth credentials** and enter your client ID/secret.
3. Authorize only `https://www.googleapis.com/auth/gmail.send` using the sending Gmail account. Exchange the authorization code and obtain an offline refresh token. This grants sending access, not inbox reading. Recipient users do not need to authorize Gmail access.
4. Set these secrets on the server (Render Environment or local `.env.local`):

| Variable                      | Value                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| `EMAIL_FROM`                  | Authorized sending Gmail address or send-as alias; plain email only |
| `GMAIL_CLIENT_ID`             | OAuth client ID                                                     |
| `GMAIL_CLIENT_SECRET`         | OAuth client secret                                                 |
| `GMAIL_REFRESH_TOKEN`         | Sender's refresh token                                              |
| `EMAIL_VERIFICATION_REQUIRED` | Initially `false`; set `true` after real delivery is tested         |

Use the public HTTPS origin for `APP_URL`. Render's launcher derives it from `RENDER_EXTERNAL_URL` unless overridden. Never put secrets in client-side variables, GitHub, or chat.

OAuth apps in Testing commonly get refresh tokens expiring in seven days for Gmail scopes. Follow Google's production publishing/verification requirements for sustained use. Gmail sending limits apply.

## Rollout

Migration `003_account_security.sql` adds columns, tokens, and indexes without deleting accounts or papers. Existing accounts are not silently marked verified.

1. Deploy with verification disabled so existing passwords continue to work.
2. Configure Gmail; use **Resend verification** on the sign-in page for your own account.
3. Open the emailed link and explicitly click **Verify email**. Test **Forgot password?** with a dedicated account.
4. Enable `EMAIL_VERIFICATION_REQUIRED=true` only after delivery works. All unverified accounts, including existing sessions, then need verification to access their workspace. A completed password reset also proves mailbox ownership.
5. Registration policy remains independent: `ALLOW_REGISTRATION=false` permits existing users to verify/reset. When verification is required but Gmail credentials are missing, registration fails before creating an unusable account.

## Security and limitations

- Tokens use 32 random bytes, are purpose-bound, and are stored only as SHA-256 hashes. Verification expires after 24 hours; password reset after 30 minutes.
- Resending invalidates the previous token of that purpose. Consumption is transactional under a user lock; expired and reused tokens fail.
- Reset revokes all sessions and outstanding tokens. Session creation checks the password hash again under the same user lock, preventing a stale login from bypassing a reset.
- Recovery responses do not reveal account existence. Delivery failure logs contain only a sanitized event. Synchronous sending can still cause timing differences; a durable encrypted email outbox is a future hardening step.
- Tokens travel in URL fragments, keeping them out of HTTP access logs and referrers. Explicit POST confirmation prevents mail-scanner GETs from consuming links. Reopen the original email link if the confirmation page is refreshed after capturing the token.
- Same-origin checks, per-email/global rate limits, scrypt hashes, and a 12–128 character password policy apply.
- Actual email delivery requires user-supplied credentials and remains unverified until a live round trip succeeds.

## Database maintenance

Run `node --import tsx scripts/cleanup-auth.ts` periodically with the deployed database environment; locally add `--env-file=.env.local` before `--import`. Each run removes at most 5,000 expired rows per auth table. No schedule is created automatically. Expiry is enforced during access even before cleanup.

Indexes cover session revocation, token/limit expiry, conversation ordering, and collection membership lookup. Embedding settings and paper ingestion remain unchanged.

References: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Render Free](https://render.com/docs/free), [OWASP recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
