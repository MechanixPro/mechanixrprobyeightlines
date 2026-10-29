-- A booking can have more than one invoice document. 'A' is the main invoice (revisions R2, R3 ... replace it). Extra work is a separate document 'B', 'C' ... with its own number.
alter table public.invoices add column if not exists doc_key text not null default 'A' check (doc_key ~ '^[A-Z]$');
alter table public.invoices add column if not exists note text check (char_length(note) <= 200);
alter table public.invoices drop constraint if exists invoices_lead_id_revision_key;
create unique index if not exists invoices_lead_doc_rev_uq on public.invoices (lead_id, doc_key, revision);
