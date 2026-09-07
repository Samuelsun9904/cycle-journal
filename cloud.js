(() => {
  const LEGACY_META_KEY = "cycle-journal-cloud-meta-v1";
  const META_PREFIX = "cycle-journal-cloud-meta-v2";
  const MIGRATION_OWNER_KEY = "cycle-journal-cloud-migration-owner-v2";
  const PAGE_SIZE = 500;
  const RETRY_DELAYS = [2000, 5000, 15000, 30000];
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
  let retryTimer;
  let retryAttempt = 0;
  let contextVersion = 0;
  let mutationVersion = 0;
  let syncPromise;
  let pushRequested = false;
  let pullRequested = false;
  let legacyAuthoritative = false;
  let legacyMerge = false;
  let protectEmptyRemote = false;
  let responsesAvailable = false;
  let partnerResponses = {};
  const dirtyVersions = new Map();
  const ui = {};

  function currentMetaKey() { return couple ? `${META_PREFIX}:${couple.id}` : null; }

  function readMeta() {
    const key = currentMetaKey();
    if (!key) return { pendingDates: [] };
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return { pendingDates: [], ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch { return { pendingDates: [] }; }
  }

  function writeMeta(value) {
    const key = currentMetaKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({ ...readMeta(), ...value }));
  }

  function claimLegacyData(userId) {
    const claimedBy = localStorage.getItem(MIGRATION_OWNER_KEY);
    if (claimedBy) return claimedBy === userId;
    localStorage.setItem(MIGRATION_OWNER_KEY, userId);
    return true;
  }

  function readLegacyMeta() {
    try { return JSON.parse(localStorage.getItem(LEGACY_META_KEY)) || {}; }
    catch { return {}; }
  }

  async function initialize(callbacks) {
    app = callbacks;
    bindUi();
    window.addEventListener("online", retryPendingSync);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) retryPendingSync(); });
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

  function resetSyncContext() {
    contextVersion += 1;
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    syncTimer = null;
    retryTimer = null;
    retryAttempt = 0;
    pushRequested = false;
    pullRequested = false;
    legacyAuthoritative = false;
    legacyMerge = false;
    protectEmptyRemote = false;
    responsesAvailable = false;
    partnerResponses = {};
    dirtyVersions.clear();
    app?.replacePartnerResponses?.({});
    app?.setPartnerResponseContext?.({ paired: false, available: false, enabled: false });
  }

  function notifyResponseContext() {
    app?.setPartnerResponseContext?.({
      paired: Boolean(couple),
      available: responsesAvailable,
      enabled: Boolean(couple?.responses_enabled)
    });
  }

  async function applySession(nextSession) {
    const sameUser = session?.user?.id && session.user.id === nextSession?.user?.id;
    if (sameUser && (couple || role === "unpaired")) return;
    resetSyncContext();
    session = nextSession;
    couple = null;
    await removeChannel();
    ui.signedOut.hidden = Boolean(session);
    ui.signedIn.hidden = !session;
    clearError();
    if (!session) {
      role = "local";
      await app.switchStorageScope("local");
      setStatus("未登录，仅保存在当前设备", "idle");
      app.onRoleChange(role);
      renderCouple();
      notifyResponseContext();
      return;
    }

    const activeContext = contextVersion;
    const canAdoptLegacy = claimLegacyData(session.user.id);
    const legacyMeta = canAdoptLegacy ? readLegacyMeta() : {};
    role = "unpaired";
    const userScopeResult = await app.switchStorageScope(`user:${session.user.id}`, {
      adoptCurrent: canAdoptLegacy,
      clearSource: canAdoptLegacy,
      forceClearSource: canAdoptLegacy
    });
    app.onRoleChange(role);
    ui.accountEmail.textContent = session.user.email || "已登录";
    setStatus("正在读取云端数据", "syncing");
    const { data, error } = await client.from("couples").select("*")
      .or(`owner_id.eq.${session.user.id},partner_id.eq.${session.user.id}`).maybeSingle();
    if (activeContext !== contextVersion) return;
    if (error) { setError(error); setStatus("云端连接失败，稍后重试", "error"); scheduleSessionRetry(); return; }

    couple = data;
    if (!couple) {
      renderCouple();
      notifyResponseContext();
      setStatus("已登录，等待创建或加入空间", "ready");
      if (canAdoptLegacy) localStorage.removeItem(LEGACY_META_KEY);
      return;
    }

    role = couple.owner_id === session.user.id ? "owner" : "partner";
    await app.switchStorageScope(`couple:${couple.id}`, role === "owner" ? { adoptCurrent: true, clearSource: true } : {});
    protectEmptyRemote = role === "owner";
    hydrateDirtyDates();
    app.onRoleChange(role);
    renderCouple();
    const synced = await initialSync({
      legacyPending: Boolean(canAdoptLegacy && legacyMeta.pending),
      migratedLegacy: Boolean(canAdoptLegacy && userScopeResult?.adopted)
    });
    if (canAdoptLegacy && synced) localStorage.removeItem(LEGACY_META_KEY);
    await pullPartnerResponses();
    await subscribe();
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
    resetSyncContext();
    couple = data;
    role = "owner";
    await app.switchStorageScope(`couple:${couple.id}`, { adoptCurrent: true, clearSource: true });
    markDirty(Object.keys(app.getSnapshot().records));
    app.onRoleChange(role);
    renderCouple();
    await syncNow(true);
    await pullPartnerResponses();
    await subscribe();
  }

  async function joinCouple() {
    clearError();
    const code = ui.joinCode.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) { ui.error.textContent = "请输入 8 位邀请码。"; return; }
    const { data, error } = await client.rpc("join_couple", { supplied_code: code });
    if (error) { setError(error); return; }
    resetSyncContext();
    couple = data;
    role = "partner";
    await app.switchStorageScope(`couple:${couple.id}`);
    app.onRoleChange(role);
    renderCouple();
    const synced = await syncNow();
    if (synced) app.notify("已加入伴侣空间");
    await pullPartnerResponses();
    await subscribe();
  }

  function hydrateDirtyDates() {
    dirtyVersions.clear();
    const meta = readMeta();
    const dates = Array.isArray(meta.pendingDates) ? meta.pendingDates : [];
    dates.forEach(date => dirtyVersions.set(date, ++mutationVersion));
  }

  function markDirty(dates) {
    [...new Set(dates || [])].filter(Boolean).forEach(date => dirtyVersions.set(date, ++mutationVersion));
    writeMeta({ pendingDates: [...dirtyVersions.keys()] });
  }

  async function initialSync(options = {}) {
    if (role === "partner") { pullRequested = true; return drainSync(); }
    legacyAuthoritative = Boolean(options.legacyPending);
    legacyMerge = Boolean(options.migratedLegacy && !options.legacyPending);
    pullRequested = true;
    if (dirtyVersions.size) pushRequested = true;
    return drainSync();
  }

  function schedulePush(changedDates = []) {
    if (role === "partner" || !changedDates.length) return;
    if (role !== "owner" || !couple) return;
    markDirty(changedDates);
    pushRequested = true;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => { syncTimer = null; drainSync(); }, 700);
  }

  async function syncNow(userInitiated = false) {
    if (!couple) return false;
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    syncTimer = null;
    retryTimer = null;
    if (role === "owner" && dirtyVersions.size) pushRequested = true;
    pullRequested = true;
    const success = await drainSync();
    await pullPartnerResponses();
    if (userInitiated && success) app.notify("同步完成");
    return success;
  }

  function retryPendingSync() {
    if (!couple || !navigator.onLine) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (role === "owner" && dirtyVersions.size) pushRequested = true;
    pullRequested = true;
    drainSync();
    pullPartnerResponses();
  }

  function scheduleRetry(failedOperation) {
    if (!couple || retryTimer) return;
    if (failedOperation === "push") pushRequested = true;
    else pullRequested = true;
    const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
    retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      drainSync();
    }, delay);
  }

  function scheduleSessionRetry() {
    if (!session || retryTimer) return;
    const retrySession = session;
    const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
    retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      session = null;
      applySession(retrySession);
    }, delay);
  }

  async function drainSync() {
    if (syncPromise) return syncPromise;
    const activeContext = contextVersion;
    syncPromise = (async () => {
      let success = true;
      while (activeContext === contextVersion && couple && (pushRequested || pullRequested)) {
        const operation = role === "owner" && pushRequested ? "push" : "pull";
        if (operation === "push") pushRequested = false;
        else pullRequested = false;
        clearError();
        setStatus(operation === "push" ? "正在同步" : "正在接收记录", "syncing");
        try {
          if (operation === "push") await pushRemoteOnce(activeContext);
          else await pullRemoteOnce(activeContext);
          clearTimeout(retryTimer);
          retryTimer = null;
          retryAttempt = 0;
        } catch (error) {
          if (activeContext !== contextVersion) break;
          success = false;
          setError(error);
          setStatus(operation === "push" ? "等待网络后重试" : "无法读取云端记录，稍后重试", "error");
          scheduleRetry(operation);
          break;
        }
      }
      return success && activeContext === contextVersion;
    })();
    const currentPromise = syncPromise;
    try { return await currentPromise; }
    finally {
      if (syncPromise === currentPromise) syncPromise = null;
      if ((pushRequested || pullRequested) && !retryTimer && couple) queueMicrotask(drainSync);
    }
  }

  async function pushRemoteOnce(activeContext) {
    if (role !== "owner" || !couple || !dirtyVersions.size) return;
    const coupleId = couple.id;
    const captured = new Map(dirtyVersions);
    const records = app.getSnapshot().records;
    const deletedAt = new Date().toISOString();
    const rows = [...captured.keys()].map(recordDate => ({
      couple_id: coupleId,
      record_date: recordDate,
      payload: records[recordDate] ? JSON.parse(JSON.stringify(records[recordDate])) : null,
      deleted_at: records[recordDate] ? null : deletedAt
    }));

    for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
      const { error } = await client.from("daily_records").upsert(rows.slice(offset, offset + PAGE_SIZE), { onConflict: "couple_id,record_date" });
      if (error) throw error;
    }
    if (activeContext !== contextVersion || couple?.id !== coupleId) return;
    captured.forEach((version, date) => {
      if (dirtyVersions.get(date) === version) dirtyVersions.delete(date);
    });
    writeMeta({ pendingDates: [...dirtyVersions.keys()], lastSyncAt: new Date().toISOString() });
    setStatus(dirtyVersions.size ? "还有记录等待同步" : "所有记录已同步", dirtyVersions.size ? "syncing" : "ready");
    if (dirtyVersions.size) pushRequested = true;
  }

  async function fetchAllRecords() {
    if (!couple) return [];
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from("daily_records")
        .select("record_date,payload,deleted_at,updated_at")
        .eq("couple_id", couple.id)
        .order("record_date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  async function pullRemoteOnce(activeContext) {
    if (!couple) return;
    const coupleId = couple.id;
    const rows = await fetchAllRecords();
    if (activeContext !== contextVersion || couple?.id !== coupleId) return;
    const records = Object.fromEntries(rows
      .filter(row => !row.deleted_at && row.payload && typeof row.payload === "object")
      .map(row => [row.record_date, row.payload]));

    if (role === "owner" && protectEmptyRemote && rows.length === 0) {
      const localDates = Object.keys(app.getSnapshot().records);
      if (localDates.length) markDirty(localDates);
    }
    protectEmptyRemote = false;
    if (role === "owner" && legacyAuthoritative) {
      const dates = new Set([...Object.keys(app.getSnapshot().records), ...rows.filter(row => !row.deleted_at).map(row => row.record_date)]);
      markDirty([...dates]);
      legacyAuthoritative = false;
    } else if (role === "owner" && legacyMerge) {
      markDirty(Object.keys(app.getSnapshot().records));
      legacyMerge = false;
    }
    if (role === "owner" && dirtyVersions.size) {
      const localRecords = app.getSnapshot().records;
      dirtyVersions.forEach((_version, date) => {
        if (localRecords[date]) records[date] = localRecords[date];
        else delete records[date];
      });
    }
    if (role === "owner") await sanitizeTombstones(coupleId, rows);

    await app.replaceRecords(records);
    writeMeta({ pendingDates: [...dirtyVersions.keys()], lastSyncAt: new Date().toISOString() });
    setStatus(role === "partner" ? "实时同步已连接" : dirtyVersions.size ? "还有记录等待同步" : "所有记录已同步", dirtyVersions.size ? "syncing" : "ready");
    if (role === "owner" && dirtyVersions.size) pushRequested = true;
  }

  async function sanitizeTombstones(coupleId, rows) {
    const dates = rows.filter(row => row.deleted_at && row.payload !== null).map(row => row.record_date);
    for (let offset = 0; offset < dates.length; offset += PAGE_SIZE) {
      const { error } = await client.from("daily_records")
        .update({ payload: null })
        .eq("couple_id", coupleId)
        .in("record_date", dates.slice(offset, offset + PAGE_SIZE))
        .not("deleted_at", "is", null);
      if (error) throw error;
    }
  }

  function isMissingResponseSchema(error) {
    const message = String(error?.message || error || "");
    return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code) ||
      /partner_responses|responses_enabled/i.test(message) && /does not exist|not found|schema cache|column/i.test(message);
  }

  async function fetchAllPartnerResponses() {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from("partner_responses")
        .select("response_date,response_type,response_text,updated_at")
        .eq("couple_id", couple.id)
        .order("response_date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  async function pullPartnerResponses() {
    if (!couple) { notifyResponseContext(); return false; }
    const coupleId = couple.id;
    try {
      const rows = await fetchAllPartnerResponses();
      if (couple?.id !== coupleId) return false;
      responsesAvailable = true;
      partnerResponses = Object.fromEntries(rows.map(row => [row.response_date, {
        type: row.response_type,
        text: row.response_text || "",
        updatedAt: row.updated_at
      }]));
      app.replacePartnerResponses?.(partnerResponses);
      notifyResponseContext();
      return true;
    } catch (error) {
      if (!isMissingResponseSchema(error)) console.error("Partner responses could not be loaded", error);
      responsesAvailable = false;
      partnerResponses = {};
      app.replacePartnerResponses?.({});
      notifyResponseContext();
      return false;
    }
  }

  async function setResponsesEnabled(enabled) {
    if (role !== "owner" || !couple || !responsesAvailable) return false;
    const { data, error } = await client.from("couples").update({ responses_enabled: Boolean(enabled) })
      .eq("id", couple.id).select().single();
    if (error) {
      if (isMissingResponseSchema(error)) responsesAvailable = false;
      else setError(error);
      notifyResponseContext();
      return false;
    }
    couple = data || { ...couple, responses_enabled: Boolean(enabled) };
    notifyResponseContext();
    return true;
  }

  async function setPartnerResponse(recordDate, responseType, responseText = null) {
    const allowed = new Set(["seen", "hug", "care", "prepare", "custom"]);
    if (role !== "partner" || !couple || !responsesAvailable || !couple.responses_enabled) return false;
    const normalizedText = typeof responseText === "string" ? responseText.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate) || (responseType !== null && !allowed.has(responseType))) return false;
    if (responseType === "custom" && (!normalizedText || [...normalizedText].length > 30)) return false;
    let result;
    if (responseType === null) {
      result = await client.from("partner_responses").delete()
        .eq("couple_id", couple.id).eq("response_date", recordDate);
    } else {
      result = await client.from("partner_responses").upsert({
        couple_id: couple.id,
        response_date: recordDate,
        responder_id: session.user.id,
        response_type: responseType,
        response_text: responseType === "custom" ? normalizedText : null
      }, { onConflict: "couple_id,response_date" }).select("response_date,response_type,response_text,updated_at").single();
    }
    if (result.error) {
      if (isMissingResponseSchema(result.error)) responsesAvailable = false;
      else setError(result.error);
      notifyResponseContext();
      return false;
    }
    if (responseType === null) delete partnerResponses[recordDate];
    else partnerResponses[recordDate] = {
      type: result.data?.response_type || responseType,
      text: result.data?.response_text || (responseType === "custom" ? normalizedText : ""),
      updatedAt: result.data?.updated_at || new Date().toISOString()
    };
    app.replacePartnerResponses?.({ ...partnerResponses });
    return true;
  }

  async function subscribe() {
    await removeChannel();
    if (!couple) return;
    const activeContext = contextVersion;
    channel = client.channel(`records:${couple.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_records", filter: `couple_id=eq.${couple.id}` }, () => {
        if (activeContext !== contextVersion) return;
        pullRequested = true;
        window.setTimeout(drainSync, 120);
      });
    if (responsesAvailable) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "partner_responses", filter: `couple_id=eq.${couple.id}` }, () => {
        if (activeContext === contextVersion) window.setTimeout(pullPartnerResponses, 120);
      }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "couples", filter: `id=eq.${couple.id}` }, payload => {
        if (activeContext !== contextVersion) return;
        couple = { ...couple, ...(payload.new || {}) };
        notifyResponseContext();
      });
    }
    channel.subscribe(status => {
        if (activeContext !== contextVersion) return;
        if (status === "SUBSCRIBED") {
          pullRequested = true;
          drainSync();
          pullPartnerResponses();
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          setStatus("实时连接中断，正在重连", "error");
          scheduleRetry("pull");
        }
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

  window.CloudSync = { initialize, schedulePush, syncNow, setResponsesEnabled, setPartnerResponse, configured };
})();
