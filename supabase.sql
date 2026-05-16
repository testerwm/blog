create extension if not exists pgcrypto;

create table if not exists public.blog_creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  excerpt text check (char_length(excerpt) <= 240),
  content_html text not null,
  published boolean not null default true,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (
    char_length(email) <= 254
    and email like '%@%.%'
    and email not like '% %'
  ),
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create unique index if not exists email_subscribers_email_key on public.email_subscribers(lower(email));
create index if not exists email_subscribers_created_at_idx on public.email_subscribers(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

alter table public.blog_creators enable row level security;
alter table public.posts enable row level security;
alter table public.email_subscribers enable row level security;

drop policy if exists "Creators can read creators" on public.blog_creators;
create policy "Creators can read creators"
on public.blog_creators for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Everyone can read published posts" on public.posts;
create policy "Everyone can read published posts"
on public.posts for select
to anon, authenticated
using (published = true);

drop policy if exists "Creators can manage posts" on public.posts;
create policy "Creators can manage posts"
on public.posts for all
to authenticated
using (exists (select 1 from public.blog_creators where user_id = auth.uid()))
with check (
  author_id = auth.uid()
  and exists (select 1 from public.blog_creators where user_id = auth.uid())
);

drop policy if exists "Visitors can subscribe by email" on public.email_subscribers;
create policy "Visitors can subscribe by email"
on public.email_subscribers for insert
to anon, authenticated
with check (status = 'active');

drop policy if exists "Creators can read subscribers" on public.email_subscribers;
create policy "Creators can read subscribers"
on public.email_subscribers for select
to authenticated
using (exists (select 1 from public.blog_creators where user_id = auth.uid()));

drop policy if exists "Creators can manage subscribers" on public.email_subscribers;
create policy "Creators can manage subscribers"
on public.email_subscribers for update
to authenticated
using (exists (select 1 from public.blog_creators where user_id = auth.uid()))
with check (exists (select 1 from public.blog_creators where user_id = auth.uid()));

-- After creating your Supabase Auth user, run this once with that user's id:
-- insert into public.blog_creators (user_id) values ('YOUR_AUTH_USER_ID');
