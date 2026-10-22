(() => {
  'use strict';

  /* =====================================================
     設定
  ===================================================== */
  // Render 同一オリジンなので相対パス。Supabase は Realtime 購読のみに使用。
  const API_BASE = '';
  const SUPABASE_URL = window.__SUPABASE_URL__ || '';       // index.html で注入
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';

  // supabase-js は index.html で CDN 読み込み済み（window.supabase）
  const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  const COLORS = [
    'linear-gradient(135deg,#4a5ad0,#7a4ad0)',
    'linear-gradient(135deg,#2f8f6b,#4cd38a)',
    'linear-gradient(135deg,#c04a6a,#ff5b6e)',
    'linear-gradient(135deg,#c08a2f,#ffd35b)',
    'linear-gradient(135deg,#4a8fd0,#4ad0d3)',
    'linear-gradient(135deg,#8a4ad0,#c04ad0)',
  ];
  const ADMIN_PASSWORD = 'admin';

  const state = {
    me: null,          // { id, name, initials, colorIdx }
    token: null,
    rooms: [],
    activeRoomId: null,
    filter: 'all',
    search: '',
    detailsOpen: false,
    messages: [],      // アクティブルームのメッセージ
    channel: null,     // Realtime チャンネル
  };

  const uid = () => Math.random().toString(36).slice(2, 9);
  const now = () => new Date();
  const timeStr = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const colorOf = (idx) => COLORS[idx % COLORS.length] || COLORS[0];

  /* =====================================================
     要素
  ===================================================== */
  const $ = id => document.getElementById(id);
  const el = {
    authScreen: $('authScreen'),
    appScreen: $('appScreen'),
    adminScreen: $('adminScreen'),

    loginForm: $('loginForm'),
    signupForm: $('signupForm'),
    loginName: $('loginName'),
    loginPass: $('loginPass'),
    loginErr: $('loginErr'),
    loginBtn: $('loginBtn'),
    toAdminLogin: $('toAdminLogin'),

    sidebarToggle: $('sidebarToggle'),

    signupName: $('signupName'),
    signupPass: $('signupPass'),
    signupPass2: $('signupPass2'),
    signupErr: $('signupErr'),
    signupBtn: $('signupBtn'),
    signupCancel: $('signupCancel'),
    avatarPicker: $('avatarPicker'),

    meAvatar: $('meAvatar'),
    meName: $('meName'),
    openAdmin: $('openAdmin'),
    logoutBtn: $('logoutBtn'),
    roomSearch: $('roomSearch'),
    tabs: $('tabs'),
    roomList: $('roomList'),
    fabCreate: $('fabCreate'),

    chatIco: $('chatIco'),
    chatTitle: $('chatTitle'),
    chatSub: $('chatSub'),
    messages: $('messages'),
    typingBar: $('typingBar'),
    composerInput: $('composerInput'),
    sendBtn: $('sendBtn'),
    toggleDetails: $('toggleDetails'),
    backBtn: $('backBtn'),
    details: $('details'),
    closeDetails: $('closeDetails'),
    detailsDesc: $('detailsDesc'),
    memberList: $('memberList'),
    leaveRoom: $('leaveRoom'),
    sidebar: $('sidebar'),
    scrim: $('scrim'),

    createModal: $('createModal'),
    newRoomName: $('newRoomName'),
    newRoomDesc: $('newRoomDesc'),
    createRoomBtn: $('createRoomBtn'),

    adminLoginModal: $('adminLoginModal'),
    adminPass: $('adminPass'),
    adminErr: $('adminErr'),
    adminLoginBtn: $('adminLoginBtn'),
    adminExit: $('adminExit'),
    statUsers: $('statUsers'),
    statRooms: $('statRooms'),
    statMsgs: $('statMsgs'),
    adminRoomList: $('adminRoomList'),
    adminUserList: $('adminUserList'),
    adminReports: $('adminReports'),
    clearAll: $('clearAll'),

    toast: $('toast'),
    leaveModal: $('leaveModal'),
    leaveModalDesc: $('leaveModalDesc'),
    leaveConfirmBtn: $('leaveConfirmBtn'),

    inviteModal: $('inviteModal'),
    inviteName: $('inviteName'),
    inviteErr: $('inviteErr'),
    inviteSendBtn: $('inviteSendBtn'),
    inviteMemberBtn: $('inviteMemberBtn'),
    openInvites: $('openInvites'),
    inviteBadge: $('inviteBadge'),    
    invitesModal: $('invitesModal'),
    invitesList: $('invitesList'),
  };

  let selectedAvatar = 0;
  let createType = 'open';

  el.inviteMemberBtn.addEventListener('click', () => {
  const r = activeRoom();
  if(!r){ return; }
  if(r.type !== 'private'){ showToast('プライベートルームのみ招待できます'); return; }
  el.inviteName.value = '';
  setErr(el.inviteErr, '');
  openModal('inviteModal');
  setTimeout(() => el.inviteName.focus(), 50);
});

el.inviteSendBtn.addEventListener('click', async () => {
  const r = activeRoom();
  const name = el.inviteName.value.trim();
  setErr(el.inviteErr, '');
  if(!name){ setErr(el.inviteErr, 'ユーザー名を入力してください'); return; }

  el.inviteSendBtn.disabled = true;
  try {
    const { invitee } = await api(`/api/rooms/${r.id}/invites`, {
      method: 'POST', body: { username: name },
    });
    closeModal('inviteModal');
    showToast(`${invitee} さんを招待しました`);
  } catch (e) {
    setErr(el.inviteErr, e.message);
  } finally {
    el.inviteSendBtn.disabled = false;
  }
});

  /* =====================================================
     共通ユーティリティ
  ===================================================== */
  function showToast(msg, ms = 2000){
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove('show'), ms);
  }
  function switchScreen(id){
    ['authScreen','appScreen','adminScreen'].forEach(s => $(s).classList.remove('active'));
    $(id).classList.add('active');
  }
  function openModal(id){ $(id).classList.add('show'); }
  function closeModal(id){ $(id).classList.remove('show'); }
  function setErr(node, msg){ node.textContent = msg || ''; }

  /* =====================================================
     API ラッパー
  ===================================================== */
  async function api(path, { method = 'GET', body, auth = true } = {}){
    const headers = { 'Content-Type': 'application/json' };
    if(auth && state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || '通信に失敗しました');
    return data;
  }

  /* =====================================================
     セッション（JWT + ユーザー情報）
  ===================================================== */
  const TOKEN_KEY = 'min3_token';
  const USER_KEY  = 'min3_user';

  function saveSession(token, user){
    state.token = token;
    state.me = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function loadSession(){
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    if(!token || !user) return null;
    try {
      state.token = token;
      state.me = JSON.parse(user);
      return state.me;
    } catch { return null; }
  }
  function clearSession(){
    state.token = null;
    state.me = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /* =====================================================
     認証UI
  ===================================================== */
  function showLogin(){
    el.loginForm.classList.remove('hidden');
    el.signupForm.classList.add('hidden');
    document.querySelectorAll('.auth-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.auth === 'login'));
    setErr(el.loginErr, '');
    setTimeout(() => el.loginName.focus(), 50);
  }
  function showSignup(){
    el.loginForm.classList.add('hidden');
    el.signupForm.classList.remove('hidden');
    document.querySelectorAll('.auth-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.auth === 'signup'));
    setErr(el.signupErr, '');
    setTimeout(() => el.signupName.focus(), 50);
  }
  function buildAvatarPicker(){
    el.avatarPicker.innerHTML = '';
    COLORS.forEach((c, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'av-opt' + (i === selectedAvatar ? ' selected' : '');
      d.style.background = c;
      d.textContent = '?';
      d.addEventListener('click', () => {
        selectedAvatar = i;
        buildAvatarPicker();
      });
      el.avatarPicker.appendChild(d);
    });
  }

function enterApp(user){
  state.me = {
    id: user.id,
    name: user.username,
    initials: user.username.slice(0,2).toUpperCase(),
    colorIdx: user.avatarColor ?? 0,
    isAdmin: !!user.isAdmin,
  };
  el.meName.textContent = state.me.name;
  el.meAvatar.textContent = state.me.initials;
  el.meAvatar.style.background = colorOf(state.me.colorIdx);
  switchScreen('appScreen');
  loadRooms();
  refreshInvites();
}

  async function doLogin(){
    const name = el.loginName.value.trim();
    const pass = el.loginPass.value;
    setErr(el.loginErr, '');
    if(!name || !pass){ setErr(el.loginErr, 'ユーザー名とパスワードを入力してください'); return; }
    el.loginBtn.disabled = true;
    try {
      const { token, user } = await api('/api/login', {
        method: 'POST', auth: false, body: { username: name, password: pass },
      });
      saveSession(token, user);
      enterApp(user);
      showToast(`${user.username} としてログインしました`);
    } catch (e) {
      setErr(el.loginErr, e.message);
    } finally {
      el.loginBtn.disabled = false;
    }
  }

  async function doSignup(){
    const name = el.signupName.value.trim();
    const pass = el.signupPass.value;
    const pass2 = el.signupPass2.value;
    setErr(el.signupErr, '');

    if(!name){ setErr(el.signupErr, 'ユーザー名を入力してください'); return; }
    if(name.length > 24){ setErr(el.signupErr, 'ユーザー名は24文字以内です'); return; }
    if(!pass || pass.length < 4){ setErr(el.signupErr, 'パスワードは4文字以上で設定してください'); return; }
    if(pass !== pass2){ setErr(el.signupErr, 'パスワードが一致しません'); return; }

    el.signupBtn.disabled = true;
    try {
      const { token, user } = await api('/api/signup', {
        method: 'POST', auth: false,
        body: { username: name, password: pass, avatarColor: selectedAvatar },
      });
      saveSession(token, user);
      showToast('アカウントを作成しました');
      enterApp(user);
    } catch (e) {
      setErr(el.signupErr, e.message);
    } finally {
      el.signupBtn.disabled = false;
    }
  }

  function doLogout(){
    unsubscribeRoom();
    clearSession();
    state.rooms = [];
    state.activeRoomId = null;
    state.messages = [];
    el.loginPass.value = '';
    switchScreen('authScreen');
    showLogin();
    showToast('ログアウトしました');
  }

  /* =====================================================
     ルーム一覧
  ===================================================== */
  async function loadRooms(){
    try {
      const { rooms } = await api('/api/rooms');
      state.rooms = rooms.map(r => ({
        id: r.id,
        type: r.type,
        name: r.name,
        ico: r.ico || '💬',
        desc: r.description || '',
        joined: r.joined,
        memberCount: r.memberCount,
        lastMessage: r.lastMessage,
      }));
      if(!state.activeRoomId && state.rooms.length){
        state.activeRoomId = state.rooms[0].id;
      }
      renderRoomList();
      if(state.activeRoomId) openRoom(state.activeRoomId);
    } catch (e) {
      showToast(e.message);
    }
  }

  function filteredRooms(){
    return state.rooms.filter(r => {
      if(state.filter !== 'all' && r.type !== state.filter) return false;
      if(state.search && !r.name.toLowerCase().includes(state.search.toLowerCase())) return false;
      return true;
    });
  }
  function roomIconClass(type){
    return type === 'global' ? 'global' : type === 'open' ? 'open' : 'private';
  }

  function renderRoomList(){
    el.roomList.innerHTML = '';
    const rooms = filteredRooms();
    if(!rooms.length){
      el.roomList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">ルームがありません</div>';
      return;
    }
    const groups = [
      { key:'global', label:'全体' },
      { key:'open', label:'オープンチャット' },
      { key:'private', label:'プライベート' },
    ];
    groups.forEach(g => {
      const list = rooms.filter(r => r.type === g.key);
      if(!list.length) return;
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = g.label;
      el.roomList.appendChild(label);
      list.forEach(r => el.roomList.appendChild(renderRoomItem(r)));
    });
  }

  function renderRoomItem(r){
    const item = document.createElement('div');
    item.className = 'room-item' + (r.id === state.activeRoomId ? ' active' : '');
    item.dataset.id = r.id;

    const ico = document.createElement('div');
    ico.className = `room-ico ${roomIconClass(r.type)}`;
    ico.textContent = r.ico;

    const body = document.createElement('div');
    body.className = 'room-body';
    const name = document.createElement('div');
    name.className = 'room-name';
    name.textContent = r.name;
    if(r.type === 'private'){
      const lock = document.createElement('span');
      lock.className = 'room-lock';
      lock.textContent = '🔒';
      name.appendChild(lock);
    }
    const preview = document.createElement('div');
    preview.className = 'room-preview';
    preview.textContent = r.lastMessage
      ? `${r.lastMessage.name}: ${r.lastMessage.content}`
      : 'メッセージはまだありません';
    body.append(name, preview);

    const side = document.createElement('div');
    side.className = 'room-side';
    const time = document.createElement('div');
    time.className = 'room-time';
    time.textContent = r.lastMessage ? timeStr(r.lastMessage.createdAt) : '';
    side.appendChild(time);

    item.append(ico, body, side);
    item.addEventListener('click', () => {
      openRoom(r.id);
      if(window.innerWidth <= 820) closeSidebar();
    });
    return item;
  }

  /* =====================================================
     チャット本体
  ===================================================== */
  function activeRoom(){ return state.rooms.find(r => r.id === state.activeRoomId); }

  async function openRoom(id){
    if(state.activeRoomId !== id) state.messages = [];
    state.activeRoomId = id;
    const r = activeRoom();
    if(!r) return;
    el.chatIco.textContent = r.ico;
    el.chatIco.className = `room-ico ${roomIconClass(r.type)}`;
    el.chatTitle.textContent = r.name;
    el.chatSub.textContent =
      r.type === 'global' ? `全員が参加 · メンバー ${r.memberCount}` :
      r.type === 'open'   ? `オープン · メンバー ${r.memberCount}` :
                            `プライベート · メンバー ${r.memberCount}`;
    renderRoomList();
    renderDetails(r);
    await loadMessages(id);
    subscribeRoom(id);
  }

  async function loadMessages(roomId){
    try {
      const { messages } = await api(`/api/rooms/${roomId}/messages`);
      state.messages = messages.map(m => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        initials: (m.name || '?').slice(0,2).toUpperCase(),
        colorIdx: m.avatarColor ?? 0,
        text: m.content,
        time: timeStr(m.createdAt),
        createdAt: m.createdAt,
        mine: m.mine,
        reactions: m.reactions || {},
        readBy: [],
      }));
      renderMessages();
    } catch (e) {
      showToast(e.message);
    }
  }

  function renderMessages(){
    el.messages.innerHTML = '';
    const divider = document.createElement('div');
    divider.className = 'day-divider';
    divider.textContent = '今日';
    el.messages.appendChild(divider);
    state.messages.forEach(m => el.messages.appendChild(renderMessage(m)));
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderMessage(m){
    const wrap = document.createElement('div');
    wrap.className = 'msg' + (m.mine ? ' self' : '');

    const av = document.createElement('div');
    av.className = 'avatar sm';
    av.textContent = m.initials;
    av.style.background = colorOf(m.colorIdx);

    const col = document.createElement('div');
    col.className = 'msg-col';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = m.name;
    const tm = document.createElement('span');
    tm.textContent = m.time;
    meta.append(nm, document.createTextNode('•'), tm);

    const tail = document.createElement('div');
    tail.className = 'msg-tail';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;
    tail.appendChild(bubble);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    ['👍','❤️','😂','😮'].forEach(rx => {
      const b = document.createElement('button');
      b.className = 'react-btn';
      b.textContent = rx;
      b.addEventListener('click', () => toggleReaction(m, rx, false));
      actions.appendChild(b);
    });
    tail.appendChild(actions);

if(m.reactions && Object.keys(m.reactions).length){
  const bar = document.createElement('div');
  bar.className = 'reactions';
  Object.entries(m.reactions).forEach(([rx, obj]) => {
    const chip = document.createElement('button');
    chip.className = 'react-chip' + (obj.mine ? ' mine' : '');
    chip.textContent = `${rx} ${obj.count}`;
    chip.addEventListener('click', () => toggleReaction(m, rx, obj.mine));
    bar.appendChild(chip);
  });
  tail.appendChild(bar);
}

    col.append(meta, tail);

    if(m.mine){
      const rr = document.createElement('div');
      rr.className = 'read-receipt';
      rr.textContent = '送信済み';
      col.appendChild(rr);
    }

    wrap.append(av, col);
    return wrap;
  }

async function toggleReaction(m, rx, isMine){
  try {
    if(isMine){
      await api(`/api/messages/${m.id}/reactions`, { method: 'DELETE', body: { emoji: rx } });
    } else {
      await api(`/api/messages/${m.id}/reactions`, { method: 'POST', body: { emoji: rx } });
    }
    // 反映はRealtime購読に任せる（即時性のため楽観的更新を入れてもよい）
  } catch (e) {
    showToast(e.message);
  }
}

  /* =====================================================
     Realtime 購読（Supabase）
  ===================================================== */
  function unsubscribeRoom(){
    if(state.channel && sb){
      sb.removeChannel(state.channel);
    }
    state.channel = null;
  }

function subscribeRoom(roomId){
  unsubscribeRoom();
  if(!sb) return;

  state.channel = sb
    .channel(`room:${roomId}`)
    // メッセージ追加
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `room_id=eq.${roomId}`,
    }, payload => {
      const row = payload.new;
      if(row.user_id === state.me.id) return;
      if(state.messages.some(m => m.id === row.id)) return;

      state.messages.push({
        id: row.id,
        userId: row.user_id,
        name: '...',
        initials: '?',
        colorIdx: 0,
        text: row.content,
        time: timeStr(row.created_at),
        createdAt: row.created_at,
        mine: false,
        reactions: {},
        readBy: [],
      });
      renderMessages();
      refreshMessagesSoon(roomId);
    })
    // リアクション追加
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'reactions',
    }, payload => {
      applyReactionChange(payload.new.message_id, payload.new.emoji, +1, payload.new.user_id === state.me.id);
    })
    // リアクション削除
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'reactions',
    }, payload => {
      const old = payload.old;
      if(!old || !old.message_id) return;
      applyReactionChange(old.message_id, old.emoji, -1, old.user_id === state.me.id);
    })
    .subscribe();
}

/* ローカルのメッセージ配列にリアクション増減を反映 */
function applyReactionChange(messageId, emoji, delta, isMine){
  const msg = state.messages.find(m => m.id === messageId);
  if(!msg) return;                       // 表示中のルームに無いメッセージは無視
  msg.reactions = msg.reactions || {};
  const cur = msg.reactions[emoji] || { count: 0, mine: false };
  const next = {
    count: Math.max(0, cur.count + delta),
    mine: isMine ? (delta > 0) : cur.mine,
  };
  if(next.count === 0){
    delete msg.reactions[emoji];
  } else {
    msg.reactions[emoji] = next;
  }
  renderMessages();
}

  let refreshTimer = null;
  function refreshMessagesSoon(roomId){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if(state.activeRoomId === roomId) loadMessages(roomId);
    }, 300);
  }

  /* =====================================================
     送信
  ===================================================== */
  function updateSendState(){ el.sendBtn.disabled = !el.composerInput.value.trim(); }
  function autoResize(){
    const ta = el.composerInput;
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  }

  async function sendMessage(){
    const text = el.composerInput.value.trim();
    if(!text) return;
    const r = activeRoom();
    if(!r) return;

    // 楽観的更新
    const temp = {
      id: 'tmp-' + uid(),
      userId: state.me.id,
      name: state.me.name,
      initials: state.me.initials,
      colorIdx: state.me.colorIdx,
      text,
      time: timeStr(),
      createdAt: new Date().toISOString(),
      mine: true,
      reactions: {},
      readBy: [],
    };
    state.messages.push(temp);
    el.composerInput.value = '';
    autoResize();
    updateSendState();
    renderMessages();

    try {
      const { message } = await api('/api/messages', {
        method: 'POST',
        body: { roomId: r.id, content: text },
      });
      // 仮IDを本IDに差し替え
      const idx = state.messages.findIndex(m => m.id === temp.id);
      if(idx >= 0){
        state.messages[idx] = {
          ...state.messages[idx],
          id: message.id,
          createdAt: message.createdAt,
        };
      }
      renderRoomList();
    } catch (e) {
      // 失敗したら仮メッセージを除去
      state.messages = state.messages.filter(m => m.id !== temp.id);
      renderMessages();
      showToast(e.message);
    }
  }

  /* =====================================================
     詳細パネル
  ===================================================== */
  async function renderDetails(r){
  if(!r) return;
  el.detailsDesc.textContent = r.desc || '説明はありません。';
  el.memberList.innerHTML = '<div style="font-size:12px;color:var(--muted-2)">読み込み中...</div>';

  try {
    const { members } = await api(`/api/rooms/${r.id}/members`);
    el.memberList.innerHTML = '';
    if(!members.length){
      el.memberList.innerHTML = '<div style="font-size:12px;color:var(--muted-2)">メンバーがいません</div>';
      return;
    }
    members.forEach(u => {
      const row = document.createElement('div');
      row.className = 'member-row';

      const av = document.createElement('div');
      av.className = 'avatar sm';
      av.textContent = (u.name || '?').slice(0,2).toUpperCase();
      av.style.background = colorOf(u.avatarColor);

      const nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = u.name + (u.isMe ? '（あなた）' : '');

      const dot = document.createElement('span');
      dot.className = 'online-dot';

      row.append(av, nm, dot);
      el.memberList.appendChild(row);
    });
  } catch (e) {
    el.memberList.innerHTML = `<div style="font-size:12px;color:var(--danger)">${e.message}</div>`;
  }
}
function toggleDetails(force){
  const open = force !== undefined ? force : !state.detailsOpen;
  state.detailsOpen = open;
  if(window.innerWidth <= 1100){
    el.details.classList.toggle('open', open);
  } else {
    el.details.classList.toggle('collapsed', !open);
  }
}

  function openSidebar(){ el.sidebar.classList.add('open'); el.scrim.classList.add('show'); }
  function closeSidebar(){ el.sidebar.classList.remove('open'); el.scrim.classList.remove('show'); }

  /* =====================================================
     ルーム作成
  ===================================================== */
  function openCreateModal(){
    el.newRoomName.value = '';
    el.newRoomDesc.value = '';
    createType = 'open';
    document.querySelectorAll('.choice').forEach(c =>
      c.classList.toggle('selected', c.dataset.type === 'open'));
    openModal('createModal');
    setTimeout(() => el.newRoomName.focus(), 50);
  }

  async function createRoom(){
    const name = el.newRoomName.value.trim();
    if(!name){ showToast('ルーム名を入力してください'); return; }
    el.createRoomBtn.disabled = true;
    try {
      const { room } = await api('/api/rooms', {
        method: 'POST',
        body: { name, type: createType, description: el.newRoomDesc.value.trim() },
      });
      closeModal('createModal');
      state.rooms.unshift({
        id: room.id, type: room.type, name: room.name, ico: room.ico,
        desc: room.description, joined: true, memberCount: room.memberCount,
        lastMessage: null,
      });
      openRoom(room.id);
      renderRoomList();
      showToast(`${createType === 'open' ? 'オープンチャット' : 'プライベートルーム'}「${name}」を作成しました`);
    } catch (e) {
      showToast(e.message);
    } finally {
      el.createRoomBtn.disabled = false;
    }
  }

  /* =====================================================
     管理画面（デモ・ローカル表示のみ）
  ===================================================== */
function openAdminLogin(){
  if(!state.me?.isAdmin){
    showToast('管理者権限がありません');
    return;
  }
  renderAdmin();
  switchScreen('adminScreen');
}
async function renderAdmin(){
  // サマリー
  try {
    const s = await api('/api/admin/stats');
    el.statUsers.textContent = s.users;
    el.statRooms.textContent = s.rooms;
    el.statMsgs.textContent = s.messages;
  } catch (e) { showToast(e.message); }

  // ルーム一覧
  el.adminRoomList.innerHTML = '<div class="table-row"><div class="grow">読み込み中...</div></div>';
  try {
    const { rooms } = await api('/api/admin/rooms');
    el.adminRoomList.innerHTML = '';
    rooms.forEach(r => {
      const row = document.createElement('div');
      row.className = 'table-row';
      const nm = document.createElement('div');
      nm.className = 'grow';
      nm.textContent = `${r.ico || '💬'} ${r.name}`;
      const type = document.createElement('span');
      type.className = 'pill ' + (r.type === 'private' ? 'warn' : 'ok');
      type.textContent = r.type === 'global' ? '全体' : r.type === 'open' ? 'オープン' : '非公開';
      const del = document.createElement('button');
      del.className = 'btn ghost';
      del.textContent = '削除';
      del.disabled = r.type === 'global';
      del.addEventListener('click', async () => {
        if(!await confirmAction(`「${r.name}」を削除しますか？`)) return;
        try {
          await api(`/api/admin/rooms/${r.id}`, { method: 'DELETE' });
          showToast('ルームを削除しました');
          renderAdmin();
        } catch (e) { showToast(e.message); }
      });
      row.append(nm, type, del);
      el.adminRoomList.appendChild(row);
    });
  } catch (e) {
    el.adminRoomList.innerHTML = `<div class="table-row"><div class="grow">${e.message}</div></div>`;
  }

  // ユーザー一覧
  el.adminUserList.innerHTML = '<div class="table-row"><div class="grow">読み込み中...</div></div>';
  try {
    const { users } = await api('/api/admin/users');
    el.adminUserList.innerHTML = '';
    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'table-row';
      const nm = document.createElement('div');
      nm.className = 'grow';
      nm.textContent = u.username + (u.is_admin ? ' 👑' : '');
      const st = document.createElement('span');
      st.className = 'pill ' + (u.is_suspended ? 'danger' : 'ok');
      st.textContent = u.is_suspended ? '停止中' : 'active';
      const act = document.createElement('button');
      act.className = 'btn ghost';
      act.textContent = u.is_suspended ? '再開' : '停止';
      act.addEventListener('click', async () => {
        try {
          await api(`/api/admin/users/${u.id}`, {
            method: 'PATCH', body: { is_suspended: !u.is_suspended },
          });
          renderAdmin();
        } catch (e) { showToast(e.message); }
      });
      row.append(nm, st, act);
      el.adminUserList.appendChild(row);
    });
  } catch (e) {
    el.adminUserList.innerHTML = `<div class="table-row"><div class="grow">${e.message}</div></div>`;
  }

  // 通報一覧
  el.adminReports.innerHTML = '<div class="table-row"><div class="grow">読み込み中...</div></div>';
  try {
    const { reports } = await api('/api/admin/reports');
    el.adminReports.innerHTML = '';
    if(!reports.length){
      el.adminReports.innerHTML = '<div class="table-row"><div class="grow">通報はありません</div></div>';
    } else {
      reports.forEach(rp => {
        const row = document.createElement('div');
        row.className = 'table-row';
        const txt = document.createElement('div');
        txt.className = 'grow';
        txt.textContent = `${rp.reporter?.username || '?'} → ${rp.target?.username || '?'} : ${rp.reason}`;
        const st = document.createElement('span');
        st.className = 'pill ' + (rp.status === 'open' ? 'danger' : 'ok');
        st.textContent = rp.status === 'open' ? '要対応' : rp.status === 'resolved' ? '解決済み' : '却下';
        const res = document.createElement('button');
        res.className = 'btn ghost';
        res.textContent = '解決';
        res.disabled = rp.status !== 'open';
        res.addEventListener('click', async () => {
          try {
            await api(`/api/admin/reports/${rp.id}`, { method: 'PATCH', body: { status: 'resolved' } });
            renderAdmin();
          } catch (e) { showToast(e.message); }
        });
        row.append(txt, st, res);
        el.adminReports.appendChild(row);
      });
    }
  } catch (e) {
    el.adminReports.innerHTML = `<div class="table-row"><div class="grow">${e.message}</div></div>`;
  }
}

  /* =====================================================
     イベント登録
  ===================================================== */
  buildAvatarPicker();

  document.querySelectorAll('.auth-tab').forEach(t => {
    t.addEventListener('click', () => {
      if(t.dataset.auth === 'login') showLogin();
      else showSignup();
    });
  });

  document.querySelectorAll('.pw-toggle').forEach(b => {
    b.addEventListener('click', () => {
      const inp = $(b.dataset.pw);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });

  el.loginBtn.addEventListener('click', doLogin);
  el.loginPass.addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
  el.loginName.addEventListener('keydown', e => { if(e.key === 'Enter') el.loginPass.focus(); });
  el.toAdminLogin.addEventListener('click', openAdminLogin);

  el.signupBtn.addEventListener('click', doSignup);
  el.signupCancel.addEventListener('click', showLogin);
  el.signupPass2.addEventListener('keydown', e => { if(e.key === 'Enter') doSignup(); });

  el.logoutBtn.addEventListener('click', doLogout);

  el.roomSearch.addEventListener('input', () => {
    state.search = el.roomSearch.value;
    renderRoomList();
  });
  el.tabs.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if(!btn) return;
    state.filter = btn.dataset.filter;
    el.tabs.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === btn));
    renderRoomList();
  });
  el.fabCreate.addEventListener('click', openCreateModal);

  document.querySelectorAll('.choice').forEach(c => {
    c.addEventListener('click', () => {
      createType = c.dataset.type;
      document.querySelectorAll('.choice').forEach(x => x.classList.toggle('selected', x === c));
    });
  });
  el.createRoomBtn.addEventListener('click', createRoom);

  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(mb => {
    mb.addEventListener('click', e => { if(e.target === mb) mb.classList.remove('show'); });
  });

  el.composerInput.addEventListener('input', () => { updateSendState(); autoResize(); });
  el.composerInput.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
  });
  el.sendBtn.addEventListener('click', sendMessage);

  el.toggleDetails.addEventListener('click', () => toggleDetails());
  el.closeDetails.addEventListener('click', () => toggleDetails(false));
el.leaveRoom.addEventListener('click', () => {
  const r = activeRoom();
  if(!r || r.type === 'global'){ showToast('全体チャットは退出できません'); return; }
  el.leaveModalDesc.textContent = `「${r.name}」を退出しますか？`;
  openModal('leaveModal');
});

el.leaveConfirmBtn.addEventListener('click', async () => {
  const r = activeRoom();
  if(!r) return;
  closeModal('leaveModal');

  try {
    const result = await api(`/api/rooms/${r.id}/members/me`, { method: 'DELETE' });
    state.activeRoomId = null;
    state.messages = [];
    toggleDetails(false);
    await loadRooms();           // サーバーから再取得
    showToast(result.deleted ? 'ルームを退出し、削除しました' : 'ルームを退出しました');
  } catch (e) {
    showToast(e.message);
  }
});
  /* サイドバー開閉（PC・モバイル共通） */
el.sidebarToggle.addEventListener('click', () => {
  if(window.innerWidth <= 820){
    // モバイル：オーバーレイ表示のトグル
    el.sidebar.classList.toggle('open');
    el.scrim.classList.toggle('show');
  } else {
    // PC：幅を畳む
    el.sidebar.classList.toggle('collapsed');
  }
});

/* 既存の backBtn は削除（sidebarToggle に統合） */
// el.backBtn.addEventListener('click', openSidebar); ← 削除

el.scrim.addEventListener('click', () => {
  el.sidebar.classList.remove('open');
  el.scrim.classList.remove('show');
});
  el.scrim.addEventListener('click', closeSidebar);

  el.openAdmin.addEventListener('click', openAdminLogin);
  el.adminLoginBtn.addEventListener('click', tryEnterAdmin);
  el.adminPass.addEventListener('keydown', e => { if(e.key === 'Enter') tryEnterAdmin(); });
  el.adminExit.addEventListener('click', () => switchScreen('appScreen'));

el.clearAll.addEventListener('click', async () => {
  if(!state.me?.isAdmin){ showToast('管理者権限がありません'); return; }
  if(!await confirmAction('全メッセージを削除しますか？この操作は取り消せません。')) return;
  try {
    await api('/api/admin/messages', { method: 'DELETE' });
    showToast('全メッセージを削除しました');
    renderAdmin();
  } catch (e) { showToast(e.message); }
});



async function refreshInvites(){
  try {
    const { invites } = await api('/api/invites');
    const badge = el.inviteBadge;
    if(badge){
      badge.style.display = invites.length ? 'inline-flex' : 'none';
      badge.textContent = String(invites.length);
    }
    el.invitesList.innerHTML = '';
    if(!invites.length){
      el.invitesList.innerHTML = '<div style="font-size:13px;color:var(--muted)">招待はありません</div>';
      return;
    }
    invites.forEach(inv => {
      const row = document.createElement('div');
      row.className = 'table-row';
      const info = document.createElement('div');
      info.className = 'grow';
      info.innerHTML = `<b>${inv.roomIco} ${inv.roomName}</b><div style="font-size:11px;color:var(--muted)">${inv.inviterName} さんから</div>`;
      const acc = document.createElement('button');
      acc.className = 'btn primary';
      acc.textContent = '参加';
      acc.addEventListener('click', async () => {
        try {
          await api(`/api/invites/${inv.id}/accept`, { method: 'POST' });
          showToast(`「${inv.roomName}」に参加しました`);
          await refreshInvites();
          await loadRooms();
        } catch (e) { showToast(e.message); }
      });
      const dec = document.createElement('button');
      dec.className = 'btn ghost';
      dec.textContent = '辞退';
      dec.addEventListener('click', async () => {
        try {
          await api(`/api/invites/${inv.id}/decline`, { method: 'POST' });
          await refreshInvites();
        } catch (e) { showToast(e.message); }
      });
      row.append(info, acc, dec);
      el.invitesList.appendChild(row);
    });
  } catch (e) { /* 未ログイン時など */ }
}

el.openInvites.addEventListener('click', async () => {
  await refreshInvites();
  openModal('invitesModal');
});

  /* =====================================================
     起動
  ===================================================== */
  (async () => {
    const me = loadSession();
    if(me){
      enterApp(me);
      return;
    }
    showLogin();
  })();
})();
