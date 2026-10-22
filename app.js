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
  };

  let selectedAvatar = 0;
  let createType = 'open';

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
    // user: { id, username, avatarColor }
    state.me = {
      id: user.id,
      name: user.username,
      initials: user.username.slice(0,2).toUpperCase(),
      colorIdx: user.avatarColor ?? 0,
    };
    el.meName.textContent = state.me.name;
    el.meAvatar.textContent = state.me.initials;
    el.meAvatar.style.background = colorOf(state.me.colorIdx);
    switchScreen('appScreen');
    loadRooms();
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
        reactions: {},
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
      b.addEventListener('click', () => addReaction(m, rx));
      actions.appendChild(b);
    });
    tail.appendChild(actions);

    if(m.reactions && Object.keys(m.reactions).length){
      const bar = document.createElement('div');
      bar.className = 'reactions';
      Object.entries(m.reactions).forEach(([rx, cnt]) => {
        const chip = document.createElement('button');
        chip.className = 'react-chip';
        chip.textContent = `${rx} ${cnt}`;
        chip.addEventListener('click', () => addReaction(m, rx));
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

  function addReaction(m, rx){
    // ローカル表示のみ（永続化は将来対応）
    m.reactions = m.reactions || {};
    m.reactions[rx] = (m.reactions[rx] || 0) + 1;
    renderMessages();
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
    if(!sb) return; // Supabase未設定ならRealtimeなしで動作

    state.channel = sb
      .channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        const row = payload.new;
        // 自分の送信分は楽観的更新済みなのでスキップ
        if(row.user_id === state.me.id) return;
        if(state.messages.some(m => m.id === row.id)) return;

        state.messages.push({
          id: row.id,
          userId: row.user_id,
          name: '...',              // Realtime payloadには join 結果が無いので仮表示
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
        // 名前解決のため軽く再取得（頻繁すぎるならデバウンス）
        refreshMessagesSoon(roomId);
      })
      .subscribe();
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
  function renderDetails(r){
    el.detailsDesc.textContent = r.desc || '説明はありません。';
    el.memberList.innerHTML = '';
    // メンバー一覧APIは未実装のため、自分だけ表示（将来 /api/rooms/:id/members を追加）
    const u = state.me;
    if(u){
      const row = document.createElement('div');
      row.className = 'member-row';
      const av = document.createElement('div');
      av.className = 'avatar sm';
      av.textContent = u.initials;
      av.style.background = colorOf(u.colorIdx);
      const nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = u.name + '（あなた）';
      const dot = document.createElement('span');
      dot.className = 'online-dot';
      row.append(av, nm, dot);
      el.memberList.appendChild(row);
    }
  }
  function toggleDetails(force){
    const open = force !== undefined ? force : !state.detailsOpen;
    state.detailsOpen = open;
    el.details.classList.toggle('open', open);
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
    el.adminPass.value = '';
    setErr(el.adminErr, '');
    openModal('adminLoginModal');
    setTimeout(() => el.adminPass.focus(), 50);
  }
  function tryEnterAdmin(){
    if(el.adminPass.value !== ADMIN_PASSWORD){
      setErr(el.adminErr, 'パスワードが違います');
      return;
    }
    closeModal('adminLoginModal');
    renderAdmin();
    switchScreen('adminScreen');
  }
  function renderAdmin(){
    el.statUsers.textContent = state.rooms.reduce((a, r) => a + (r.memberCount || 0), 0);
    el.statRooms.textContent = state.rooms.length;
    el.statMsgs.textContent = state.messages.length;

    el.adminRoomList.innerHTML = '';
    state.rooms.forEach(r => {
      const row = document.createElement('div');
      row.className = 'table-row';
      const nm = document.createElement('div');
      nm.className = 'grow';
      nm.textContent = `${r.ico} ${r.name}`;
      const type = document.createElement('span');
      type.className = 'pill ' + (r.type === 'private' ? 'warn' : 'ok');
      type.textContent = r.type === 'global' ? '全体' : r.type === 'open' ? 'オープン' : '非公開';
      row.append(nm, type);
      el.adminRoomList.appendChild(row);
    });

    el.adminUserList.innerHTML = '<div class="table-row"><div class="grow">（ユーザー一覧APIは未実装）</div></div>';
    el.adminReports.innerHTML = '<div class="table-row"><div class="grow">通報はありません</div></div>';
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
  el.leaveRoom.addEventListener('click', async () => {
    const r = activeRoom();
    if(!r || r.type === 'global'){ showToast('全体チャットは退出できません'); return; }
    // 退出APIは未実装。ローカルから除去のみ。
    state.rooms = state.rooms.filter(x => x.id !== r.id);
    state.activeRoomId = state.rooms[0]?.id || null;
    if(state.activeRoomId) openRoom(state.activeRoomId);
    renderRoomList();
    toggleDetails(false);
    showToast('ルームを退出しました');
  });

  el.backBtn.addEventListener('click', openSidebar);
  el.scrim.addEventListener('click', closeSidebar);

  el.openAdmin.addEventListener('click', openAdminLogin);
  el.adminLoginBtn.addEventListener('click', tryEnterAdmin);
  el.adminPass.addEventListener('keydown', e => { if(e.key === 'Enter') tryEnterAdmin(); });
  el.adminExit.addEventListener('click', () => switchScreen('appScreen'));

  el.clearAll.addEventListener('click', () => {
    state.messages = [];
    renderMessages();
    showToast('表示中メッセージをクリアしました（デモ）');
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
