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

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, username: user.username },
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
  if (!password || password.length < 4)
    return res.status(400).json({ error: 'パスワードは4文字以上です' });

  // Supabase Auth のメールは username から合成（ログインには使わない）
  const email = `${username.toLowerCase()}@min3.local`;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, avatar_color: avatarColor },
  });

  if (error) {
    const msg = /already/i.test(error.message)
      ? 'このユーザー名は既に使われています'
      : 'アカウント作成に失敗しました';
    return res.status(400).json({ error: msg });
  }

  const token = signToken({ id: data.user.id, username });
  return res.json({
    token,
    user: { id: data.user.id, username, avatarColor },
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

  const meta = data.user.user_metadata || {};
  const token = signToken({ id: data.user.id, username: meta.username || username });
  return res.json({
    token,
    user: {
      id: data.user.id,
      username: meta.username || username,
      avatarColor: meta.avatar_color ?? 0,
    },
  });
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

  return res.json({
    messages: (data || []).map((m) => ({
      id: m.id,
      userId: m.user_id,
      name: m.profiles?.username || '?',
      avatarColor: m.profiles?.avatar_color ?? 0,
      content: m.content,
      createdAt: m.created_at,
      mine: m.user_id === req.user.sub,
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
