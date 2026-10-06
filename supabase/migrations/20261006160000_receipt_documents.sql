-- Issued receipt snapshots and private download tokens.
create table if not exists public.receipt_documents (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  receipt_number text not null unique,
  access_token uuid not null default gen_random_uuid() unique,
  reissue_number integer not null default 0 check (reissue_number >= 0),
  recipient_name text not null,
  description text not null default '宿泊代として',
  amount integer not null check (amount > 0),
  taxable_amount integer not null default 0 check (taxable_amount >= 0),
  tax_amount integer not null default 0 check (tax_amount >= 0),
  non_taxable_amount integer not null default 0 check (non_taxable_amount >= 0),
  payment_method text not null check (payment_method in ('online', 'onsite', 'accounts_receivable')),
  guest_name text not null,
  guest_email text,
  property_name text,
  room_number text,
  check_in_date date,
  check_out_date date,
  issuer_name text not null,
  issuer_address text not null,
  issuer_phone text,
  invoice_registration_number text,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.staff(id) on delete set null,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_receipt_documents_reservation
  on public.receipt_documents(reservation_id, issued_at desc);

alter table public.receipt_documents enable row level security;

drop policy if exists receipt_documents_admin_all on public.receipt_documents;
create policy receipt_documents_admin_all on public.receipt_documents
  for all to authenticated
  using (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid() and staff.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.staff
      where staff.id = auth.uid() and staff.role = 'admin'
    )
  );

comment on table public.receipt_documents is
  'Immutable receipt snapshots. Public downloads are served only through the tokenized application route.';

