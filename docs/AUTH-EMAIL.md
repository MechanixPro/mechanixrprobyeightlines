# Admin password-reset email

The admin signs in with an email and a password only. There are no login codes and no magic links.
The one email Auth may send is the password-reset link. It is not sent through Supabase's SMTP settings: Supabase Auth calls our function instead
(Authentication -> Hooks -> Send Email), and the function sends the link through Resend from
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

Check it: press Forgot password on the admin login page; the `email_log` table gets a `password_reset` row, and the email's button opens the "Choose a new password" form. Any other kind of Auth email (login code, magic link, sign-up) is refused by the function, so code login cannot be used.

The reset link opens `https://admin.mechanixpro.in/`. That address must be the Auth Site URL or in the redirect list (Authentication -> URL configuration).
