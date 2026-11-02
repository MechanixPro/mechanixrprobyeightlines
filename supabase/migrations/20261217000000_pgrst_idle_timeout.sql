-- Keep the API from jamming: a PostgREST connection left idle inside a transaction is closed after 60 seconds,
-- so a stuck request can no longer hold one of the few pool connections until the server is restarted.
alter role authenticator set idle_in_transaction_session_timeout = '60s';
