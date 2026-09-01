-- Run this entire file once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  partner_id uuid unique references auth.users(id) on delete set null,
  invite_code text not null unique,
  invite_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint different_members check (partner_id is null or partner_id <> owner_id)
);

create table if not exists public.daily_records (
  couple_id uuid not null references public.couples(id) on delete cascade,
  record_date date not null,
  payload jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (couple_id, record_date)
);

create or replace function public.touch_daily_record()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_records_touch_updated_at on public.daily_records;
create trigger daily_records_touch_updated_at before update on public.daily_records
for each row execute function public.touch_daily_record();

alter table public.couples enable row level security;
alter table public.daily_records enable row level security;

drop policy if exists "members can read their couple" on public.couples;
create policy "members can read their couple" on public.couples for select to authenticated
using (auth.uid() = owner_id or auth.uid() = partner_id);

drop policy if exists "owner can create a couple" on public.couples;
create policy "owner can create a couple" on public.couples for insert to authenticated
with check (auth.uid() = owner_id and partner_id is null);

drop policy if exists "owner can update their couple" on public.couples;
create policy "owner can update their couple" on public.couples for update to authenticated
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "members can read records" on public.daily_records;
create policy "members can read records" on public.daily_records for select to authenticated
using (exists (
  select 1 from public.couples c
  where c.id = daily_records.couple_id
    and (c.owner_id = auth.uid() or c.partner_id = auth.uid())
));

drop policy if exists "owner can insert records" on public.daily_records;
create policy "owner can insert records" on public.daily_records for insert to authenticated
with check (exists (
  select 1 from public.couples c
  where c.id = daily_records.couple_id and c.owner_id = auth.uid()
));

drop policy if exists "owner can update records" on public.daily_records;
create policy "owner can update records" on public.daily_records for update to authenticated
using (exists (
  select 1 from public.couples c
  where c.id = daily_records.couple_id and c.owner_id = auth.uid()
)) with check (exists (
  select 1 from public.couples c
  where c.id = daily_records.couple_id and c.owner_id = auth.uid()
));

create or replace function public.join_couple(supplied_code text)
returns public.couples
language plpgsql
security definer
set search_path = public
as $$
declare joined public.couples;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.couples where owner_id = auth.uid() or partner_id = auth.uid()) then
    raise exception 'account already paired';
  end if;
  update public.couples
  set partner_id = auth.uid()
  where invite_code = upper(trim(supplied_code))
    and partner_id is null
    and invite_expires_at > now()
    and owner_id <> auth.uid()
  returning * into joined;
  if joined.id is null then raise exception 'invalid invite'; end if;
  return joined;
end;
$$;

revoke all on function public.join_couple(text) from public;
grant execute on function public.join_couple(text) to authenticated;
grant select, insert, update on public.couples to authenticated;
grant select, insert, update on public.daily_records to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.daily_records;
exception when duplicate_object then null;
end $$;
