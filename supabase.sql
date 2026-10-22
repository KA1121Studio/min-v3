-- =====================================================
-- min3 Chat : スキーマ + RLS
-- Supabase SQL Editor で実行
-- =====================================================

-- ---------- 拡張 ----------
create extension if not exists "pgcrypto";

-- =====================================================
-- 1. profiles（Supabase Auth と連携）
-- =====================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  avatar_color int not null default 0,
  created_at  timestamptz not null default now()
);

-- 新規ユーザー作成時に profiles を自動生成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'avatar_color')::int, 0)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================
-- 2. rooms
-- =====================================================
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null check (type in ('global','open','private')),
  description text default '',
  ico         text default '👥',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- =====================================================
-- 3. room_members
-- =====================================================
create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- =====================================================
-- 4. messages
-- =====================================================
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 800),
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_room_created
  on public.messages (room_id, created_at desc);

-- =====================================================
-- 5. Realtime 有効化（messages のみ）
-- =====================================================
alter publication supabase_realtime add table public.messages;

-- =====================================================
-- 6. RLS 有効化
-- =====================================================
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
alter table public.messages     enable row level security;

-- ---------- profiles ----------
-- 誰でもプロフィール閲覧可（名前表示のため）
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

-- 本人のみ更新可
create policy "profiles_update_self"
  on public.profiles for update
  using (auth.uid() = id);

-- ---------- rooms ----------
-- global / open は全員閲覧可、private は参加者のみ
create policy "rooms_select"
  on public.rooms for select
  using (
    type in ('global','open')
    or exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id and m.user_id = auth.uid()
    )
  );

-- ログインユーザーは作成可
create policy "rooms_insert"
  on public.rooms for insert
  with check (auth.uid() = created_by);

-- 作成者のみ削除可
create policy "rooms_delete"
  on public.rooms for delete
  using (auth.uid() = created_by);

-- ---------- room_members ----------
-- 自分が参加しているルームのメンバーを閲覧可
create policy "room_members_select"
  on public.room_members for select
  using (
    exists (
      select 1 from public.room_members m
      where m.room_id = room_members.room_id and m.user_id = auth.uid()
    )
  );

-- 自分自身を追加可
create policy "room_members_insert_self"
  on public.room_members for insert
  with check (auth.uid() = user_id);

-- 自分自身を削除可（退出）
create policy "room_members_delete_self"
  on public.room_members for delete
  using (auth.uid() = user_id);

-- ---------- messages ----------
-- 参加ルーム（global/open は全員）のメッセージ閲覧可
create policy "messages_select"
  on public.messages for select
  using (
    exists (
      select 1 from public.rooms r
      where r.id = messages.room_id
        and (
          r.type in ('global','open')
          or exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = auth.uid()
          )
        )
    )
  );

-- 自分名義で、参加ルームにのみ投稿可
create policy "messages_insert"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.rooms r
      where r.id = messages.room_id
        and (
          r.type in ('global','open')
          or exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = auth.uid()
          )
        )
    )
  );

-- =====================================================
-- 7. 初期データ（全体チャット）
-- =====================================================
insert into public.rooms (name, type, description, ico, created_by)
select '全体チャット', 'global', 'すべてのユーザーが参加できる公式ルーム。', '🌐', null
where not exists (
  select 1 from public.rooms where type = 'global'
);
-- =====================================================
-- 5. room_invites（プライベートルームへの招待）
-- =====================================================
create table if not exists public.room_invites (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (room_id, invitee_id)
);

create index if not exists idx_room_invites_invitee
  on public.room_invites (invitee_id, status);

alter table public.room_invites enable row level security;

-- 自分宛の招待 or 自分が送った招待を閲覧可
create policy "room_invites_select"
  on public.room_invites for select
  using (auth.uid() = invitee_id or auth.uid() = inviter_id);

-- 自分が参加しているプライベートルームへの招待を作成可
create policy "room_invites_insert"
  on public.room_invites for insert
  with check (
    auth.uid() = inviter_id
    and exists (
      select 1 from public.room_members m
      where m.room_id = room_invites.room_id and m.user_id = auth.uid()
    )
  );

-- 招待された本人のみ承諾/辞退を更新可
create policy "room_invites_update"
  on public.room_invites for update
  using (auth.uid() = invitee_id);


-- =====================================================
-- 6. reactions（メッセージへのリアクション）
-- =====================================================
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists idx_reactions_message
  on public.reactions (message_id);

alter table public.reactions enable row level security;

-- メッセージが見えるユーザーはリアクションも閲覧可
create policy "reactions_select"
  on public.reactions for select
  using (
    exists (
      select 1 from public.messages m
      join public.rooms r on r.id = m.room_id
      where m.id = reactions.message_id
        and (
          r.type in ('global','open')
          or exists (
            select 1 from public.room_members mm
            where mm.room_id = r.id and mm.user_id = auth.uid()
          )
        )
    )
  );

-- 自分名義でのみ追加可
create policy "reactions_insert"
  on public.reactions for insert
  with check (auth.uid() = user_id);

-- 自分のリアクションは削除可
create policy "reactions_delete"
  on public.reactions for delete
  using (auth.uid() = user_id);
