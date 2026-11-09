-- 일본어 공부방 · Supabase 설정
-- Supabase 대시보드 > SQL Editor > New query 에 전체를 붙여넣고 Run 하세요. 한 번만 실행하면 됩니다.

-- 1) 학습 기록 저장 테이블 (모든 기록을 path 단위 JSON 문서로 저장)
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  path       text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- 2) 본인만 읽고 쓸 수 있게 잠그기 (Row Level Security)
alter table public.docs enable row level security;

drop policy if exists "docs: read own"   on public.docs;
drop policy if exists "docs: insert own" on public.docs;
drop policy if exists "docs: update own" on public.docs;
drop policy if exists "docs: delete own" on public.docs;

create policy "docs: read own"   on public.docs for select to authenticated using (auth.uid() = user_id);
create policy "docs: insert own" on public.docs for insert to authenticated with check (auth.uid() = user_id);
create policy "docs: update own" on public.docs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "docs: delete own" on public.docs for delete to authenticated using (auth.uid() = user_id);

-- 3) 수업 사진 저장소 (비공개 버킷, 본인 폴더만 접근)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos: read own"   on storage.objects;
drop policy if exists "photos: insert own" on storage.objects;
drop policy if exists "photos: delete own" on storage.objects;

create policy "photos: read own" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
