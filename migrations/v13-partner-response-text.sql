-- v13: add optional, length-limited custom partner responses.
-- This migration does not update or delete daily_records or existing responses.
alter table public.partner_responses
  add column if not exists response_text text;

alter table public.partner_responses
  drop constraint if exists partner_responses_response_type_check;
alter table public.partner_responses
  add constraint partner_responses_response_type_check
  check (response_type in ('seen', 'hug', 'care', 'prepare', 'custom'));

alter table public.partner_responses
  drop constraint if exists partner_responses_content_check;
alter table public.partner_responses
  add constraint partner_responses_content_check check (
    (response_type = 'custom' and nullif(trim(response_text), '') is not null and char_length(response_text) <= 30)
    or (response_type <> 'custom' and response_text is null)
  );
