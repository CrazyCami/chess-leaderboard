-- Keep existing audit rows intact while requiring a nonblank reason for
-- every new review decision.
alter table public.admin_decisions
  add constraint admin_decisions_reason_required
  check (reason is not null and length(trim(reason)) > 0)
  not valid;
