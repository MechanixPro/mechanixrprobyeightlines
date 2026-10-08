# Admin login code email

Login codes are not sent through Supabase's SMTP settings. Supabase Auth calls our function instead
(Authentication -> Hooks -> Send Email), and the function sends the code through Resend from
`no-reply@mechanixpro.in` with the same key that sends booking emails.

- Function: `supabase/functions/auth-email` (public, but it only accepts messages signed with the hook secret).
- Signature check and mail builder: `supabase/functions/_shared/auth-hook.ts`.
- Secret: `SEND_EMAIL_HOOK_SECRET` (a Supabase function secret). It is also stored by Supabase Auth.
  It never lives in this repo. `[auth.hook.send_email]` is intentionally not in `supabase/config.toml`
  because declaring it makes every CLI command demand the secret.

## If you ever need to set it up again
1. Make a secret: `v1,whsec_` followed by 32 random bytes in base64 (`openssl rand -base64 32`).
2. `npx supabase secrets set SEND_EMAIL_HOOK_SECRET=<the whole value>`
3. `npx supabase functions deploy auth-email --use-api`
4. In the Supabase dashboard: Authentication -> Hooks -> Send Email -> HTTPS, URL
   `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/auth-email`, paste the same secret, enable.

Check it: ask for a code on the admin login page; the `email_log` table gets a `login_code` row.
