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

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  author_name text not null default '匿名' check (char_length(author_name) <= 32),
  body text not null check (char_length(body) <= 800),
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists comments_post_id_idx on public.comments(post_id, created_at asc);
create index if not exists comments_parent_id_idx on public.comments(parent_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ensure_comment_parent_matches_post()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null and not exists (
    select 1
    from public.comments parent
    where parent.id = new.parent_id
    and parent.post_id = new.post_id
  ) then
    raise exception 'parent comment must belong to the same post';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists comments_parent_matches_post on public.comments;
create trigger comments_parent_matches_post
before insert or update on public.comments
for each row execute function public.ensure_comment_parent_matches_post();

alter table public.blog_creators enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;

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

drop policy if exists "Everyone can read approved comments" on public.comments;
create policy "Everyone can read approved comments"
on public.comments for select
to anon, authenticated
using (
  approved = true
  and exists (
    select 1 from public.posts
    where posts.id = comments.post_id
    and posts.published = true
  )
);

drop policy if exists "Visitors can create comments" on public.comments;
create policy "Visitors can create comments"
on public.comments for insert
to anon, authenticated
with check (
  approved = true
  and exists (
    select 1 from public.posts
    where posts.id = comments.post_id
    and posts.published = true
  )
);

drop policy if exists "Creators can manage comments" on public.comments;
create policy "Creators can manage comments"
on public.comments for all
to authenticated
using (exists (select 1 from public.blog_creators where user_id = auth.uid()))
with check (exists (select 1 from public.blog_creators where user_id = auth.uid()));

-- After creating your Supabase Auth user, run this once with that user's id:
-- insert into public.blog_creators (user_id) values ('YOUR_AUTH_USER_ID');
