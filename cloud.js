(() => {
  const META_KEY = "cycle-journal-cloud-meta-v1";
  const config = window.CYCLE_JOURNAL_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey && window.supabase?.createClient);
  const client = configured ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  let app;
  let session;
  let couple;
  let role = "local";
  let channel;
  let syncTimer;
  let syncing = false;

  const ui = {};

  function readMeta() {
    try { return { pending: false, ...JSON.parse(localStorage.getItem(META_KEY)) }; }
    catch { return { pending: false }; }
  }

  function writeMeta(value) { localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...value })); }

  async function initialize(callbacks) {
    app = callbacks;
    bindUi();
    if (!configured) {
      setStatus("云同步尚未配置", "idle");
      ui.signedOut.hidden = false;
      ui.signIn.disabled = true;
      ui.register.disabled = true;
      ui.email.disabled = true;
      ui.password.disabled = true;
      ui.error.textContent = "需要先填写 Supabase 项目地址和公开密钥。";
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error) setError(error);
    await applySession(data?.session || null);
    client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => applySession(nextSession), 0);
    });
  }

  function bindUi() {
    ui.signedOut = document.querySelector("#signedOutSync");
    ui.signedIn = document.querySelector("#signedInSync");
    ui.email = document.querySelector("#syncEmailInput");
    ui.password = document.querySelector("#syncPasswordInput");
    ui.signIn = document.querySelector("#signInButton");
    ui.register = document.querySelector("#registerButton");
    ui.accountEmail = document.querySelector("#syncAccountEmail");
    ui.role = document.querySelector("#syncRoleLabel");
    ui.noCouple = document.querySelector("#noCoupleActions");
    ui.details = document.querySelector("#coupleDetails");
    ui.inviteCard = document.querySelector("#inviteCard");
    ui.inviteCode = document.querySelector("#inviteCodeValue");
    ui.inviteExpiry = document.querySelector("#inviteExpiry");
    ui.joinCode = document.querySelector("#inviteCodeInput");
    ui.copy = document.querySelector("#copyInviteButton");
    ui.copyText = document.querySelector("#coupleSyncCopy");
    ui.status = document.querySelector("#syncStatus");
    ui.indicator = document.querySelector("#syncIndicator");
    ui.error = document.querySelector("#syncError");
    ui.signIn.addEventListener("click", signInWithPassword);
    ui.register.addEventListener("click", registerWithPassword);
    ui.password.addEventListener("keydown", event => { if (event.key === "Enter") signInWithPassword(); });
    document.querySelector("#signOutButton").addEventListener("click", () => client.auth.signOut());
    document.querySelector("#createCoupleButton").addEventListener("click", createCouple);
    document.querySelector("#joinCoupleButton").addEventListener("click", joinCouple);
    document.querySelector("#syncNowButton").addEventListener("click", () => syncNow(true));
    ui.copy.addEventListener("click", copyInvite);
  }

  function authFields() {
    clearError();
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { ui.error.textContent = "请输入有效的邮箱地址。"; return null; }
    if (password.length < 8) { ui.error.textContent = "密码至少需要 8 位。"; return null; }
    return { email, password };
  }

  async function signInWithPassword() {
    const fields = authFields(); if (!fields) return;
    ui.signIn.disabled = true; ui.register.disabled = true;
    const { error } = await client.auth.signInWithPassword(fields);
    ui.signIn.disabled = false; ui.register.disabled = false;
    if (error) { ui.error.textContent = "邮箱或密码不正确；第一次使用请点“首次注册”。"; return; }
    app.notify("登录成功");
  }

  async function registerWithPassword() {
    const fields = authFields(); if (!fields) return;
    ui.signIn.disabled = true; ui.register.disabled = true;
    const { data, error } = await client.auth.signUp(fields);
    ui.signIn.disabled = false; ui.register.disabled = false;
    if (error || !data.session) {
      ui.error.textContent = /already|registered/i.test(error?.message || "")
        ? "该邮箱已经注册，请直接登录。"
        : "注册未完成，请稍后重试。";
      return;
    }
    app.notify("注册并登录成功");
  }

  async function applySession(nextSession) {
    if (session?.user?.id === nextSession?.user?.id && couple) return;
    session = nextSession;
    couple = null;
    await removeChannel();
    ui.signedOut.hidden = Boolean(session);
    ui.signedIn.hidden = !session;
    clearError();
    if (!session) {
      role = "local";
      setStatus("未登录，仅保存在当前设备", "idle");
      app.onRoleChange(role);
      renderCouple();
      return;
    }
    ui.accountEmail.textContent = session.user.email || "已登录";
    setStatus("正在读取云端数据", "syncing");
    const { data, error } = await client.from("couples").select("*")
      .or(`owner_id.eq.${session.user.id},partner_id.eq.${session.user.id}`).maybeSingle();
    if (error) { setError(error); setStatus("云端连接失败", "error"); return; }
    couple = data;
    role = couple ? (couple.owner_id === session.user.id ? "owner" : "partner") : "unpaired";
    app.onRoleChange(role);
    renderCouple();
    if (!couple) { setStatus("已登录，等待创建或加入空间", "ready"); return; }
    await initialSync();
    subscribe();
  }

  function renderCouple() {
    const paired = Boolean(couple);
    ui.noCouple.hidden = !session || paired;
    ui.details.hidden = !paired;
    ui.inviteCard.hidden = role !== "owner" || Boolean(couple?.partner_id);
    if (!session) return;
    ui.role.textContent = role === "owner" ? "记录者，可编辑全部数据" : role === "partner" ? "伴侣，只读查看全部记录" : "尚未加入伴侣空间";
    if (!paired) return;
    ui.inviteCode.textContent = couple.invite_code || "";
    ui.inviteExpiry.textContent = couple.invite_expires_at ? `${formatDate(couple.invite_expires_at)} 前有效` : "";
    ui.copyText.textContent = role === "owner"
      ? (couple.partner_id ? "伴侣已加入。你的每次保存都会实时同步。" : "把邀请码发给伴侣；邀请码只用于加入一次。")
      : "已连接记录者。这里会自动显示她保存的全部记录，包括同房和备注。";
  }

  async function createCouple() {
    clearError();
    const inviteCode = randomCode();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const { data, error } = await client.from("couples").insert({ owner_id: session.user.id, invite_code: inviteCode, invite_expires_at: expires }).select().single();
    if (error) { setError(error); return; }
    couple = data; role = "owner"; app.onRoleChange(role); renderCouple();
    writeMeta({ pending: true });
    await syncNow(true);
    subscribe();
  }

  async function joinCouple() {
    clearError();
    const code = ui.joinCode.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) { ui.error.textContent = "请输入 8 位邀请码。"; return; }
    const { data, error } = await client.rpc("join_couple", { supplied_code: code });
    if (error) { setError(error); return; }
    couple = data; role = "partner"; app.onRoleChange(role); renderCouple();
    await pullRemote(); subscribe(); app.notify("已加入伴侣空间");
  }

  async function initialSync() {
    if (role === "partner") { await pullRemote(); return; }
    const { count, error } = await client.from("daily_records").select("record_date", { count: "exact", head: true }).eq("couple_id", couple.id);
    if (error) { setError(error); return; }
    const localHasRecords = Object.keys(app.getSnapshot().records).length > 0;
    if (readMeta().pending || (!count && localHasRecords)) await pushRemote();
    else await pullRemote();
  }

  function schedulePush() {
    if (role === "partner") return;
    writeMeta({ pending: true });
    if (role !== "owner" || !couple) return;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(pushRemote, 700);
  }

  async function syncNow(userInitiated = false) {
    if (!couple || syncing) return;
    if (role === "owner") await pushRemote(); else await pullRemote();
    if (userInitiated && !ui.error.textContent) app.notify("同步完成");
  }

  async function pushRemote() {
    if (role !== "owner" || !couple || syncing) return;
    syncing = true; clearError(); setStatus("正在同步", "syncing");
    try {
      const records = app.getSnapshot().records;
      const rows = Object.entries(records).map(([record_date, payload]) => ({ couple_id: couple.id, record_date, payload, deleted_at: null }));
      if (rows.length) {
        const { error } = await client.from("daily_records").upsert(rows, { onConflict: "couple_id,record_date" });
        if (error) throw error;
      }
      const { data: remoteRows, error: listError } = await client.from("daily_records").select("record_date,deleted_at").eq("couple_id", couple.id);
      if (listError) throw listError;
      const stale = (remoteRows || []).filter(row => !row.deleted_at && !records[row.record_date]).map(row => row.record_date);
      if (stale.length) {
        const { error } = await client.from("daily_records").update({ deleted_at: new Date().toISOString() }).eq("couple_id", couple.id).in("record_date", stale);
        if (error) throw error;
      }
      writeMeta({ pending: false, lastSyncAt: new Date().toISOString() });
      setStatus("所有记录已同步", "ready");
    } catch (error) { setError(error); setStatus("等待网络后重试", "error"); }
    finally { syncing = false; }
  }

  async function pullRemote() {
    if (!couple || syncing) return;
    syncing = true; clearError(); setStatus("正在接收记录", "syncing");
    try {
      const { data, error } = await client.from("daily_records").select("record_date,payload,deleted_at").eq("couple_id", couple.id).order("record_date");
      if (error) throw error;
      const records = Object.fromEntries((data || []).filter(row => !row.deleted_at).map(row => [row.record_date, row.payload]));
      await app.replaceRecords(records);
      writeMeta({ pending: false, lastSyncAt: new Date().toISOString() });
      setStatus("实时同步已连接", "ready");
    } catch (error) { setError(error); setStatus("无法读取云端记录", "error"); }
    finally { syncing = false; }
  }

  function subscribe() {
    removeChannel();
    channel = client.channel(`records:${couple.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_records", filter: `couple_id=eq.${couple.id}` }, () => {
        if (!syncing) window.setTimeout(pullRemote, 120);
      }).subscribe(status => {
        if (status === "SUBSCRIBED") setStatus("实时同步已连接", "ready");
      });
  }

  async function removeChannel() {
    if (channel && client) await client.removeChannel(channel);
    channel = null;
  }

  async function copyInvite() {
    if (!couple?.invite_code) return;
    await navigator.clipboard.writeText(couple.invite_code);
    app.notify("邀请码已复制");
  }

  function setStatus(text, state) {
    ui.status.textContent = text;
    ui.indicator.dataset.state = state;
  }
  function clearError() { ui.error.textContent = ""; }
  function setError(error) {
    console.error(error);
    ui.error.textContent = friendlyError(error);
  }
  function friendlyError(error) {
    const message = String(error?.message || error || "");
    if (/expired/i.test(message)) return "邀请码已过期，请让记录者重新创建。";
    if (/already|unique/i.test(message)) return "这个账号已经加入了其他伴侣空间。";
    if (/invalid invite/i.test(message)) return "邀请码无效、已过期或已经被使用。";
    return "操作未完成，请检查网络后重试。";
  }
  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map(value => alphabet[value % alphabet.length]).join("");
  }
  function formatDate(value) { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(value)); }

  window.CloudSync = { initialize, schedulePush, syncNow, configured };
})();
