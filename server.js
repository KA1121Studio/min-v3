'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET,
  PORT = 3000,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET');
  process.exit(1);
}

// service_role キーは RLS をバイパスする（サーバー側のみ）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const app = express();
app.use(express.json({ limit: '256kb' }));

/* =====================================================
   認証ミドルウェア
===================================================== */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '認証が必要です' });
  try {
    req.user = jwt.verify(token, JWT_SECRET); // { sub, username }
    next();
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user?.isAdmin)
    return res.status(403).json({ error: '管理者権限が必要です' });
  next();
}

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, username: user.username, isAdmin: !!user.isAdmin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

/* =====================================================
   POST /api/signup
   body: { username, password, avatarColor }
===================================================== */
app.post('/api/signup', async (req, res) => {
  const { username, password, avatarColor = 0 } = req.body || {};
  if (!username || username.length > 24)
    return res.status(400).json({ error: 'ユーザー名は1〜24文字です' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'パスワードは6文字以上です' });

  const email = `${username.toLowerCase()}@min3.local`;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, avatar_color: avatarColor },
  });

  if (error) {
    console.error('[signup] supabase error:', {
      message: error.message,
      status: error.status,
      code: error.code,
      name: error.name,
    });
    const msg = /already/i.test(error.message)
      ? 'このユーザー名は既に使われています'
      : 'アカウント作成に失敗しました';
    return res.status(400).json({ error: msg });
  }

  const token = signToken({ id: data.user.id, username });
  return res.json({
    token,
    user: { id: data.user.id, username, avatarColor, isAdmin: false },
  });
});

/* =====================================================
   POST /api/login
   body: { username, password }
===================================================== */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });

  const email = `${username.toLowerCase()}@min3.local`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user)
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });

  // profilesからis_admin/is_suspendedを取得
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, avatar_color, is_admin, is_suspended')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profile?.is_suspended)
    return res.status(403).json({ error: 'このアカウントは停止されています' });

  const meta = data.user.user_metadata || {};
  const user = {
    id: data.user.id,
    username: profile?.username || meta.username || username,
    avatarColor: profile?.avatar_color ?? 0,
    isAdmin: !!profile?.is_admin,
  };
  const token = signToken(user);
  return res.json({ token, user });
});
/* =====================================================
   GET /api/rooms
   自分が閲覧可能なルーム一覧 + 最終メッセージ + メンバー数
===================================================== */
app.get('/api/rooms', authRequired, async (req, res) => {
  const uid = req.user.sub;

  // global / open は全員、private は参加者のみ
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, name, type, description, ico, created_at')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'ルーム取得に失敗しました' });

  const { data: memberships } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('user_id', uid);
  const joined = new Set((memberships || []).map((m) => m.room_id));

  const visible = (rooms || []).filter(
    (r) => r.type !== 'private' || joined.has(r.id)
  );

  // 各ルームの最終メッセージとメンバー数を付与
  const enriched = await Promise.all(
    visible.map(async (r) => {
      const { data: last } = await supabase
        .from('messages')
        .select('content, created_at, profiles:user_id (username)')
        .eq('room_id', r.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count } = await supabase
        .from('room_members')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', r.id);

      return {
        ...r,
        joined: r.type === 'global' || r.type === 'open' ? true : joined.has(r.id),
        lastMessage: last
          ? { name: last.profiles?.username || '?', content: last.content, createdAt: last.created_at }
          : null,
        memberCount: (count || 0) + (r.type === 'global' ? 1 : 0),
      };
    })
  );

  return res.json({ rooms: enriched });
});

/* =====================================================
   POST /api/rooms
   body: { name, type: 'open'|'private', description }
===================================================== */
app.post('/api/rooms', authRequired, async (req, res) => {
  const { name, type, description = '' } = req.body || {};
  if (!name || name.length > 32)
    return res.status(400).json({ error: 'ルーム名は1〜32文字です' });
  if (!['open', 'private'].includes(type))
    return res.status(400).json({ error: 'ルームタイプが不正です' });

  const ico = type === 'open' ? '👥' : '🔒';
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      name,
      type,
      description,
      ico,
      created_by: req.user.sub,
    })
    .select('id, name, type, description, ico, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'ルーム作成に失敗しました' });

  // 作成者をメンバーに追加
  await supabase
    .from('room_members')
    .insert({ room_id: data.id, user_id: req.user.sub });

  return res.json({ room: { ...data, joined: true, lastMessage: null, memberCount: 1 } });
});

/* =====================================================
   GET /api/rooms/:id/messages?limit=50
===================================================== */
app.get('/api/rooms/:id/messages', authRequired, async (req, res) => {
  const roomId = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  // 閲覧権チェック（privateはメンバーのみ）
  const { data: room } = await supabase
    .from('rooms')
    .select('id, type')
    .eq('id', roomId)
    .maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });

  if (room.type === 'private') {
    const { data: m } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('room_id', roomId)
      .eq('user_id', req.user.sub)
      .maybeSingle();
    if (!m) return res.status(403).json({ error: '参加していません' });
  }

  const { data, error } = await supabase
    .from('messages')
    .select('id, content, created_at, user_id, profiles:user_id (username, avatar_color)')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: 'メッセージ取得に失敗しました' });
  const messageIds = (data || []).map((m) => m.id);
  if (!messageIds.length) return res.json({ messages: [] });

  const { data: rx } = await supabase
    .from('reactions')
    .select('message_id, emoji, user_id')
    .in('message_id', messageIds);

  const byMsg = {};
  (rx || []).forEach((r) => {
    byMsg[r.message_id] = byMsg[r.message_id] || {};
    byMsg[r.message_id][r.emoji] = byMsg[r.message_id][r.emoji] || { count: 0, mine: false };
    byMsg[r.message_id][r.emoji].count += 1;
    if (r.user_id === req.user.sub) byMsg[r.message_id][r.emoji].mine = true;
  });

  return res.json({
    messages: (data || []).map((m) => ({
      id: m.id,
      userId: m.user_id,
      name: m.profiles?.username || '?',
      avatarColor: m.profiles?.avatar_color ?? 0,
      content: m.content,
      createdAt: m.created_at,
      mine: m.user_id === req.user.sub,
      reactions: byMsg[m.id] || {},
    })),
  });
});

/* =====================================================
   POST /api/messages
   body: { roomId, content }
   ※ フロントは送信後にRealtimeで受信する
===================================================== */
app.post('/api/messages', authRequired, async (req, res) => {
  const { roomId, content } = req.body || {};
  if (!roomId) return res.status(400).json({ error: 'roomId が必要です' });
  if (!content || content.length > 800)
    return res.status(400).json({ error: 'メッセージは1〜800文字です' });

  // 投稿権チェック
  const { data: room } = await supabase
    .from('rooms')
    .select('id, type')
    .eq('id', roomId)
    .maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });

  if (room.type === 'private') {
    const { data: m } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('room_id', roomId)
      .eq('user_id', req.user.sub)
      .maybeSingle();
    if (!m) return res.status(403).json({ error: '参加していません' });
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ room_id: roomId, user_id: req.user.sub, content })
    .select('id, content, created_at, user_id')
    .single();

  if (error) return res.status(500).json({ error: '送信に失敗しました' });

  return res.json({
    message: {
      id: data.id,
      userId: data.user_id,
      name: req.user.username,
      content: data.content,
      createdAt: data.created_at,
      mine: true,
    },
  });
});

/* =====================================================
   GET /api/admin/stats
===================================================== */
app.get('/api/admin/stats', authRequired, adminRequired, async (req, res) => {
  const [{ count: users }, { count: rooms }, { count: messages }] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('rooms').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }),
  ]);
  return res.json({ users: users || 0, rooms: rooms || 0, messages: messages || 0 });
});

/* =====================================================
   GET /api/admin/users
===================================================== */
app.get('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_color, is_admin, is_suspended, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'ユーザー取得に失敗しました' });
  return res.json({ users: data || [] });
});

/* =====================================================
   PATCH /api/admin/users/:id  body: { is_suspended?, is_admin? }
===================================================== */
app.patch('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  const id = req.params.id;
  const patch = {};
  if (typeof req.body?.is_suspended === 'boolean') patch.is_suspended = req.body.is_suspended;
  if (typeof req.body?.is_admin === 'boolean') patch.is_admin = req.body.is_admin;
  if (!Object.keys(patch).length)
    return res.status(400).json({ error: '更新項目がありません' });

  // 自分自身の管理者剥奪は禁止
  if (id === req.user.sub && patch.is_admin === false)
    return res.status(400).json({ error: '自分自身の管理者権限は外せません' });

  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) return res.status(500).json({ error: '更新に失敗しました' });
  return res.json({ ok: true });
});

/* =====================================================
   GET /api/admin/rooms
===================================================== */
app.get('/api/admin/rooms', authRequired, adminRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, type, ico, created_at, created_by')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'ルーム取得に失敗しました' });
  return res.json({ rooms: data || [] });
});

/* =====================================================
   DELETE /api/admin/rooms/:id
===================================================== */
app.delete('/api/admin/rooms/:id', authRequired, adminRequired, async (req, res) => {
  const id = req.params.id;
  const { data: room } = await supabase
    .from('rooms').select('id, type').eq('id', id).maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });
  if (room.type === 'global')
    return res.status(400).json({ error: '全体チャットは削除できません' });

  const { error } = await supabase.from('rooms').delete().eq('id', id);
  if (error) return res.status(500).json({ error: '削除に失敗しました' });
  return res.json({ ok: true });
});

/* =====================================================
   GET /api/admin/reports
===================================================== */
app.get('/api/admin/reports', authRequired, adminRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('reports')
    .select(`
      id, reason, status, created_at,
      reporter:reporter_id (username),
      target:target_user (username),
      message:message_id (content, room_id)
    `)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: '通報取得に失敗しました' });
  return res.json({ reports: data || [] });
});

/* =====================================================
   PATCH /api/admin/reports/:id  body: { status }
===================================================== */
app.patch('/api/admin/reports/:id', authRequired, adminRequired, async (req, res) => {
  const id = req.params.id;
  const status = req.body?.status;
  if (!['open','resolved','dismissed'].includes(status))
    return res.status(400).json({ error: '不正なステータスです' });
  const { error } = await supabase.from('reports').update({ status }).eq('id', id);
  if (error) return res.status(500).json({ error: '更新に失敗しました' });
  return res.json({ ok: true });
});

/* =====================================================
   DELETE /api/admin/messages
   全メッセージ削除
===================================================== */
app.delete('/api/admin/messages', authRequired, adminRequired, async (req, res) => {
  // 全体チャットのメッセージも含めてすべて削除
  const { error } = await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(500).json({ error: '削除に失敗しました' });
  return res.json({ ok: true });
});
             
/* =====================================================
   GET /api/rooms/:id/members
   参加メンバー一覧
===================================================== */
app.get('/api/rooms/:id/members', authRequired, async (req, res) => {
  const roomId = req.params.id;

  const { data: room } = await supabase
    .from('rooms')
    .select('id, type')
    .eq('id', roomId)
    .maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });

  // privateはメンバーのみ閲覧可
  if (room.type === 'private') {
    const { data: m } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('room_id', roomId)
      .eq('user_id', req.user.sub)
      .maybeSingle();
    if (!m) return res.status(403).json({ error: '参加していません' });
  }

  const { data, error } = await supabase
    .from('room_members')
    .select('user_id, joined_at, profiles:user_id (username, avatar_color)')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'メンバー取得に失敗しました' });

  return res.json({
    members: (data || []).map((m) => ({
      userId: m.user_id,
      name: m.profiles?.username || '?',
      avatarColor: m.profiles?.avatar_color ?? 0,
      joinedAt: m.joined_at,
      isMe: m.user_id === req.user.sub,
    })),
  });
});

/* =====================================================
   DELETE /api/rooms/:id/members/me
   自分をルームから退出させる
===================================================== */
app.delete('/api/rooms/:id/members/me', authRequired, async (req, res) => {
  const roomId = req.params.id;

  const { data: room } = await supabase
    .from('rooms')
    .select('id, type, created_by')
    .eq('id', roomId)
    .maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });
  if (room.type === 'global') return res.status(400).json({ error: '全体チャットは退出できません' });

  // 参加していなければ何もしない
  const { data: m } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('room_id', roomId)
    .eq('user_id', req.user.sub)
    .maybeSingle();
  if (!m) return res.status(400).json({ error: '参加していません' });

  const { error } = await supabase
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', req.user.sub);

  if (error) return res.status(500).json({ error: '退出に失敗しました' });

  // プライベートルームで作成者が退出したら、ルーム自体を削除（任意）
  if (room.type === 'private' && room.created_by === req.user.sub) {
    await supabase.from('rooms').delete().eq('id', roomId);
    return res.json({ ok: true, deleted: true });
  }

  return res.json({ ok: true });
});
/* =====================================================
   POST /api/rooms/:id/invites
   body: { username }
   プライベートルームに他ユーザーを招待
===================================================== */
app.post('/api/rooms/:id/invites', authRequired, async (req, res) => {
  const roomId = req.params.id;
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'ユーザー名が必要です' });

  const { data: room } = await supabase
    .from('rooms').select('id, type').eq('id', roomId).maybeSingle();
  if (!room) return res.status(404).json({ error: 'ルームが見つかりません' });
  if (room.type !== 'private')
    return res.status(400).json({ error: 'プライベートルームのみ招待できます' });

  // 招待者がメンバーか確認
  const { data: me } = await supabase
    .from('room_members').select('room_id')
    .eq('room_id', roomId).eq('user_id', req.user.sub).maybeSingle();
  if (!me) return res.status(403).json({ error: '参加していません' });

  // 招待相手をユーザー名で検索
  const { data: target } = await supabase
    .from('profiles').select('id, username').ilike('username', username).maybeSingle();
  if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (target.id === req.user.sub)
    return res.status(400).json({ error: '自分は招待できません' });

  // 既にメンバーか
  const { data: already } = await supabase
    .from('room_members').select('room_id')
    .eq('room_id', roomId).eq('user_id', target.id).maybeSingle();
  if (already) return res.status(400).json({ error: '既に参加しています' });

  const { error } = await supabase
    .from('room_invites')
    .upsert({
      room_id: roomId,
      inviter_id: req.user.sub,
      invitee_id: target.id,
      status: 'pending',
    }, { onConflict: 'room_id,invitee_id' });

  if (error) return res.status(500).json({ error: '招待に失敗しました' });

  return res.json({ ok: true, invitee: target.username });
});

/* =====================================================
   GET /api/invites
   自分宛の保留中招待一覧
===================================================== */
app.get('/api/invites', authRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('room_invites')
    .select(`
      id, room_id, created_at, status,
      rooms:room_id (name, description, ico),
      inviter:inviter_id (username)
    `)
    .eq('invitee_id', req.user.sub)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: '招待取得に失敗しました' });

  return res.json({
    invites: (data || []).map((i) => ({
      id: i.id,
      roomId: i.room_id,
      roomName: i.rooms?.name || '?',
      roomDesc: i.rooms?.description || '',
      roomIco: i.rooms?.ico || '🔒',
      inviterName: i.inviter?.username || '?',
      createdAt: i.created_at,
    })),
  });
});

/* =====================================================
   POST /api/invites/:id/accept
   招待を承諾してルームに参加
===================================================== */
app.post('/api/invites/:id/accept', authRequired, async (req, res) => {
  const inviteId = req.params.id;

  const { data: inv } = await supabase
    .from('room_invites')
    .select('id, room_id, invitee_id, status')
    .eq('id', inviteId).maybeSingle();
  if (!inv) return res.status(404).json({ error: '招待が見つかりません' });
  if (inv.invitee_id !== req.user.sub) return res.status(403).json({ error: '権限がありません' });
  if (inv.status !== 'pending') return res.status(400).json({ error: '既に処理済みです' });

  await supabase.from('room_members').upsert(
    { room_id: inv.room_id, user_id: req.user.sub },
    { onConflict: 'room_id,user_id' }
  );
  await supabase.from('room_invites')
    .update({ status: 'accepted' }).eq('id', inviteId);

  return res.json({ ok: true, roomId: inv.room_id });
});

/* =====================================================
   POST /api/invites/:id/decline
===================================================== */
app.post('/api/invites/:id/decline', authRequired, async (req, res) => {
  const inviteId = req.params.id;
  const { data: inv } = await supabase
    .from('room_invites')
    .select('id, invitee_id, status')
    .eq('id', inviteId).maybeSingle();
  if (!inv || inv.invitee_id !== req.user.sub)
    return res.status(404).json({ error: '招待が見つかりません' });
  if (inv.status !== 'pending')
    return res.status(400).json({ error: '既に処理済みです' });

  await supabase.from('room_invites')
    .update({ status: 'declined' }).eq('id', inviteId);
  return res.json({ ok: true });
});
/* POST /api/messages/:id/reactions  body: { emoji } */
app.post('/api/messages/:id/reactions', authRequired, async (req, res) => {
  const messageId = req.params.id;
  const { emoji } = req.body || {};
  if (!emoji || emoji.length > 8)
    return res.status(400).json({ error: '絵文字が不正です' });

  // メッセージの閲覧権チェック（略：room_idからroomを引き、privateはメンバー確認）
  // 既存のPOST /api/messages と同じチェックを流用するか、簡略化して次のようにします。
  const { data: msg } = await supabase
    .from('messages').select('id, room_id').eq('id', messageId).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'メッセージが見つかりません' });

  const { error } = await supabase.from('reactions').upsert(
    { message_id: messageId, user_id: req.user.sub, emoji },
    { onConflict: 'message_id,user_id,emoji' }
  );
  if (error) return res.status(500).json({ error: 'リアクションに失敗しました' });
  return res.json({ ok: true });
});

/* DELETE /api/messages/:id/reactions  body: { emoji } */
app.delete('/api/messages/:id/reactions', authRequired, async (req, res) => {
  const messageId = req.params.id;
  const { emoji } = req.body || {};
  if (!emoji) return res.status(400).json({ error: '絵文字が必要です' });

  await supabase.from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', req.user.sub)
    .eq('emoji', emoji);

  return res.json({ ok: true });
});
/* =====================================================
   ヘルスチェック & 静的配信
===================================================== */
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));

// SPAフォールバック（index.htmlを返す）
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =====================================================
   起動（Render対応: 0.0.0.0 + PORT）
===================================================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`min3 Chat server listening on 0.0.0.0:${PORT}`);
});
