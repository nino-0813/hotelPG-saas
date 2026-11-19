alter table public.reservations
  add column nightly_rates jsonb,
  add constraint reservations_nightly_rates_array
    check (nightly_rates is null or jsonb_typeof(nightly_rates) = 'array');

comment on column public.reservations.nightly_rates is
  'Manually saved rate per stay date. Amount is tax-inclusive JPY with breakfast included; JSON null amount means not set. SQL NULL means legacy reservation without a saved breakdown.';
