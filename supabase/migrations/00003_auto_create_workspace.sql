-- =========================
-- Auto-create workspace on user signup
-- =========================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  -- Build a slug from the email prefix, fallback to user id
  base_slug := coalesce(
    regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'gi'),
    NEW.id::text
  );
  base_slug := lower(trim(both '-' from base_slug));

  if base_slug = '' then
    base_slug := NEW.id::text;
  end if;

  final_slug := base_slug;

  -- Handle slug collisions
  while exists (select 1 from public.workspace where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.workspace (name, slug, owner_id)
  values ('Mon espace', final_slug, NEW.id);

  return NEW;
end;
$$;

-- Trigger on auth.users insert
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
