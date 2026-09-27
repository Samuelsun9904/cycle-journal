(() => {
  const LEGACY_META_KEY = "cycle-journal-cloud-meta-v1";
  const META_PREFIX = "cycle-journal-cloud-meta-v2";
  const MIGRATION_OWNER_KEY = "cycle-journal-cloud-migration-owner-v2";
  const LAST_COUPLE_PREFIX = "cycle-journal-last-couple-v1";
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
  let sessionRetryTimer;
  let reconnectTimer;
  let retryAttempt = 0;
  let sessionRetryAttempt = 0;
  let reconnectAttempt = 0;
  let contextVersion = 0;
  let subscriptionVersion = 0;
  let mutationVersion = 0;
  let syncPromise;
  let pushRequested = false;
  let pullRequested = false;
  let legacyAuthoritative = false;
  let legacyMerge = false;
  let protectEmptyRemote = false;
  let responsesAvailable = false;
  let partnerResponses = {};
  let coupleVerified = false;
  let contextLoading = false;
  let channelConnected = false;
  let authRecoveryNeeded = false;
  const dirtyVersions = new Map();
  const ui = {};

  function currentMetaKey() { return couple ? `${META_PREFIX}:${couple.id}` : null; }

  function cachedCoupleKey(userId) { return `${LAST_COUPLE_PREFIX}:${userId}`; }

  function readCachedCouple(userId) {
    try {
      const value = JSON.parse(localStorage.getItem(cachedCoupleKey(userId)));
      if (!value?.couple?.id || !["owner", "partner"].includes(value.role)) return null;
      return value;
    } catch { return null; }
  }

  function writeCachedCouple() {
    if (!session?.user?.id || !couple || !["owner", "partner"].includes(role)) return;
    try { localStorage.setItem(cachedCoupleKey(session.user.id), JSON.stringify({ couple, role })); }
    catch (error) { console.warn("Cloud context could not be cached", error); }
  }

  function clearCachedCouple(userId) {
    try { localStorage.removeItem(cachedCoupleKey(userId)); }
    catch (error) { console.warn("Cloud context cache could not be cleared", error); }
  }

  async function withTimeout(value, milliseconds, label) {
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve(value),
        new Promise((_, reject) => {
          timeout = window.setTimeout(() => {
            const error = new Error(`${label} timed out`); error.code = "NETWORK_TIMEOUT"; reject(error);
          }, milliseconds);
        })
      ]);
    } finally { clearTimeout(timeout); }
  }

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
    try { localStorage.setItem(key, JSON.stringify({ ...readMeta(), ...value })); }
    catch (error) { console.warn("Sync queue metadata could not be stored", error); }
  }

  function claimLegacyData(userId) {
    const claimedBy = localStorage.getItem(MIGRATION_OWNER_KEY);
    if (claimedBy) return claimedBy === userId;
    try { localStorage.setItem(MIGRATION_OWNER_KEY, userId); }
    catch (error) { console.warn("Migration ownership could not be stored", error); return false; }
    return true;
  }

  function readLegacyMeta() {
    try { return JSON.parse(localStorage.getItem(LEGACY_META_KEY)) || {}; }
    catch { return {}; }
  }

  async function initialize(callbacks) {
    app = callbacks;
    bindUi();
    window.addEventListener("online", recoverConnectivity);
    window.addEventListener("offline", () => {
      setStatus(couple ? "当前离线，显示上次同步内容" : "当前离线", "error");
      if (session) ui.retry.hidden = false;
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) recoverConnectivity(); });
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
    try {
      const { data, error } = await withTimeout(client.auth.getSession(), 10000, "session");
      if (error) setError(error);
      await applySession(data?.session || null);
    } catch (error) {
      authRecoveryNeeded = true;
      setError(error); setStatus("无法恢复登录，请检查网络", "error"); ui.signedOut.hidden = false;
    }
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
    ui.create = document.querySelector("#createCoupleButton");
    ui.join = document.querySelector("#joinCoupleButton");
    ui.copyText = document.querySelector("#coupleSyncCopy");
    ui.status = document.querySelector("#syncStatus");
    ui.indicator = document.querySelector("#syncIndicator");
    ui.error = document.querySelector("#syncError");
    ui.retry = document.querySelector("#retryConnectionButton");
    ui.signIn.addEventListener("click", signInWithPassword);
    ui.register.addEventListener("click", registerWithPassword);
    ui.password.addEventListener("keydown", event => { if (event.key === "Enter") signInWithPassword(); });
    document.querySelector("#signOutButton").addEventListener("click", () => client.auth.signOut());
    ui.create.addEventListener("click", createCouple);
    ui.join.addEventListener("click", joinCouple);
    document.querySelector("#syncNowButton").addEventListener("click", () => syncNow(true));
    ui.retry.addEventListener("click", recoverConnectivity);
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
    setStatus("正在登录", "syncing");
    try {
      const { error } = await withTimeout(client.auth.signInWithPassword(fields), 15000, "sign in");
      if (error) {
        const message = String(error.message || "");
        ui.error.textContent = /invalid.*credential|email.*password/i.test(message)
          ? "邮箱或密码不正确；第一次使用请点“首次注册”。" : friendlyError(error);
        setStatus("登录未完成", "error"); return;
      }
      ui.password.value = ""; app.notify("账号验证成功，正在恢复空间");
    } catch (error) {
      setError(error); setStatus("网络连接失败，可以重试", "error");
    } finally { ui.signIn.disabled = false; ui.register.disabled = false; }
  }

  async function registerWithPassword() {
    const fields = authFields(); if (!fields) return;
    ui.signIn.disabled = true; ui.register.disabled = true;
    try {
      const { data, error } = await withTimeout(client.auth.signUp(fields), 15000, "register");
      if (error || !data.session) {
        ui.error.textContent = /already|registered/i.test(error?.message || "")
          ? "该邮箱已经注册，请直接登录。" : friendlyError(error || new Error("registration incomplete"));
        return;
      }
      ui.password.value = ""; app.notify("注册成功，正在准备空间");
    } catch (error) { setError(error); }
    finally { ui.signIn.disabled = false; ui.register.disabled = false; }
  }

  function resetSyncContext() {
    contextVersion += 1;
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    clearTimeout(reconnectTimer);
    syncTimer = null;
    retryTimer = null;
    reconnectTimer = null;
    retryAttempt = 0;
    reconnectAttempt = 0;
    subscriptionVersion += 1;
    channelConnected = false;
    coupleVerified = false;
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

  async function applySession(nextSession, options = {}) {
    const sameUser = session?.user?.id && session.user.id === nextSession?.user?.id;
    if (sameUser && contextLoading) return;
    if (!options.force && sameUser && coupleVerified) return;
    if (!nextSession || (session?.user?.id && session.user.id !== nextSession.user?.id)) {
      clearTimeout(sessionRetryTimer); sessionRetryTimer = null; sessionRetryAttempt = 0;
    }
    contextLoading = true;
    let cachedContext = null;
    try {
      resetSyncContext();
      authRecoveryNeeded = false;
      session = nextSession;
      couple = null;
      await removeChannel();
      ui.signedOut.hidden = Boolean(session);
      ui.signedIn.hidden = !session;
      ui.retry.hidden = true;
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
      const userId = session.user.id;
      const canAdoptLegacy = claimLegacyData(userId);
      const legacyMeta = canAdoptLegacy ? readLegacyMeta() : {};
      let userScopeResult = { adopted: false };
      cachedContext = readCachedCouple(userId);
      const cachedRole = cachedContext?.couple?.owner_id === userId ? "owner"
        : cachedContext?.couple?.partner_id === userId ? "partner" : null;
      if (cachedContext && cachedRole) {
        couple = cachedContext.couple;
        role = cachedRole;
        await app.switchStorageScope(`couple:${couple.id}`);
        hydrateDirtyDates();
        app.onRoleChange(role);
        setStatus(navigator.onLine ? "正在确认伴侣空间" : "当前离线，显示上次同步内容", navigator.onLine ? "syncing" : "error");
      } else {
        cachedContext = null;
        role = "unpaired";
        userScopeResult = await app.switchStorageScope(`user:${userId}`, {
          adoptCurrent: canAdoptLegacy,
          clearSource: canAdoptLegacy,
          forceClearSource: canAdoptLegacy
        });
        app.onRoleChange(role);
        setStatus("正在读取云端空间", "syncing");
      }
      ui.accountEmail.textContent = session.user.email || "已登录";
      renderCouple();
      notifyResponseContext();

      const { data, error } = await withTimeout(client.from("couples").select("*")
        .or(`owner_id.eq.${userId},partner_id.eq.${userId}`).maybeSingle(), 12000, "couple lookup");
      if (activeContext !== contextVersion) return;
      if (error) throw error;
      coupleVerified = true;
      sessionRetryAttempt = 0;
      clearTimeout(sessionRetryTimer); sessionRetryTimer = null;
      ui.retry.hidden = true;

      if (!data) {
        clearCachedCouple(userId);
        couple = null;
        role = "unpaired";
        await app.switchStorageScope(`user:${userId}`);
        app.onRoleChange(role);
        renderCouple();
        notifyResponseContext();
        setStatus("已登录，等待创建或加入空间", "ready");
        if (canAdoptLegacy) localStorage.removeItem(LEGACY_META_KEY);
        return;
      }

      const previousCoupleId = couple?.id;
      couple = data;
      role = couple.owner_id === userId ? "owner" : "partner";
      if (previousCoupleId !== couple.id) {
        const adopt = role === "owner" && !cachedContext;
        await app.switchStorageScope(`couple:${couple.id}`, adopt ? { adoptCurrent: true, clearSource: true } : {});
      }
      protectEmptyRemote = role === "owner";
      hydrateDirtyDates();
      app.onRoleChange(role);
      writeCachedCouple();
      renderCouple();
      const synced = await initialSync({
        legacyPending: Boolean(canAdoptLegacy && legacyMeta.pending),
        migratedLegacy: Boolean(canAdoptLegacy && userScopeResult?.adopted)
      });
      if (canAdoptLegacy && synced) localStorage.removeItem(LEGACY_META_KEY);
      await pullPartnerResponses();
      await subscribe();
    } catch (error) {
      setError(error);
      ui.retry.hidden = !session;
      if (couple) {
        setStatus("连接失败，正在显示上次同步内容", "error");
        renderCouple();
      } else setStatus("空间加载失败，本地数据未删除，请重新连接", "error");
      scheduleSessionRetry();
    } finally { contextLoading = false; }
  }

  function renderCouple() {
    const paired = Boolean(couple);
    ui.noCouple.hidden = !session || paired || !coupleVerified;
    ui.details.hidden = !paired;
    ui.retry.hidden = !session || (coupleVerified && navigator.onLine);
    ui.inviteCard.hidden = role !== "owner" || Boolean(couple?.partner_id);
    if (!session) return;
    ui.role.textContent = role === "owner" ? `记录者，可编辑全部数据${coupleVerified ? "" : "（离线）"}` : role === "partner" ? `伴侣，只读查看全部记录${coupleVerified ? "" : "（离线）"}` : "尚未加入伴侣空间";
    if (!paired) return;
    ui.inviteCode.textContent = couple.invite_code || "";
    ui.inviteExpiry.textContent = couple.invite_expires_at ? `${formatDate(couple.invite_expires_at)} 前有效` : "";
    ui.copyText.textContent = role === "owner"
      ? (couple.partner_id ? "伴侣已加入。你的每次保存都会实时同步。" : "把邀请码发给伴侣；邀请码只用于加入一次。")
      : "已连接记录者。这里会自动显示她保存的全部记录，包括同房和备注。";
  }

  async function createCouple() {
    clearError();
    ui.create.disabled = true; ui.join.disabled = true;
    const inviteCode = randomCode();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    let result;
    try { result = await withTimeout(client.from("couples").insert({ owner_id: session.user.id, invite_code: inviteCode, invite_expires_at: expires }).select().single(), 12000, "create couple"); }
    catch (error) { setError(error); ui.create.disabled = false; ui.join.disabled = false; return; }
    const { data, error } = result;
    if (error) { setError(error); ui.create.disabled = false; ui.join.disabled = false; return; }
    resetSyncContext();
    couple = data;
    role = "owner";
    coupleVerified = true;
    await app.switchStorageScope(`couple:${couple.id}`, { adoptCurrent: true, clearSource: true });
    markDirty(Object.keys(app.getSnapshot().records));
    app.onRoleChange(role);
    writeCachedCouple();
    renderCouple();
    await syncNow(true);
    await pullPartnerResponses();
    await subscribe();
    ui.create.disabled = false; ui.join.disabled = false;
  }

  async function joinCouple() {
    clearError();
    const code = ui.joinCode.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) { ui.error.textContent = "请输入 8 位邀请码。"; return; }
    ui.create.disabled = true; ui.join.disabled = true;
    let result;
    try { result = await withTimeout(client.rpc("join_couple", { supplied_code: code }), 12000, "join couple"); }
    catch (error) { setError(error); ui.create.disabled = false; ui.join.disabled = false; return; }
    const { data, error } = result;
    if (error) { setError(error); ui.create.disabled = false; ui.join.disabled = false; return; }
    resetSyncContext();
    couple = data;
    role = "partner";
    coupleVerified = true;
    await app.switchStorageScope(`couple:${couple.id}`);
    app.onRoleChange(role);
    writeCachedCouple();
    renderCouple();
    const synced = await syncNow();
    if (synced) app.notify("已加入伴侣空间");
    await pullPartnerResponses();
    await subscribe();
    ui.create.disabled = false; ui.join.disabled = false;
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
    const responsesSuccess = await pullPartnerResponses();
    if (userInitiated) app.notify(success && responsesSuccess ? "同步完成" : success ? "记录已同步，伴侣回应暂未更新" : "同步未完成，将在网络恢复后重试");
    return success && responsesSuccess;
  }

  async function recoverConnectivity() {
    if (!navigator.onLine) {
      setStatus(couple ? "当前离线，显示上次同步内容" : "当前离线", "error");
      if (session) ui.retry.hidden = false;
      return;
    }
    if (authRecoveryNeeded) {
      try {
        const { data, error } = await withTimeout(client.auth.getSession(), 10000, "session");
        if (error) throw error;
        authRecoveryNeeded = false;
        await applySession(data?.session || null, { force: true });
      } catch (error) { setError(error); setStatus("无法恢复登录，请重新连接", "error"); }
      return;
    }
    if (session && (!coupleVerified || !couple)) {
      await applySession(session, { force: true });
      return;
    }
    retryPendingSync();
    if (couple && !channelConnected) subscribe();
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
    if (!session || sessionRetryTimer) return;
    const retrySession = session;
    const delay = RETRY_DELAYS[Math.min(sessionRetryAttempt, RETRY_DELAYS.length - 1)];
    sessionRetryAttempt += 1;
    sessionRetryTimer = window.setTimeout(() => {
      sessionRetryTimer = null;
      applySession(retrySession, { force: true });
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
          setStatus(operation === "push" ? `${dirtyVersions.size || 1} 条记录等待网络后同步` : "无法读取云端记录，稍后重试", "error");
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
    const activeSubscription = ++subscriptionVersion;
    channel = client.channel(`records:${couple.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_records", filter: `couple_id=eq.${couple.id}` }, () => {
        if (activeContext !== contextVersion || activeSubscription !== subscriptionVersion) return;
        pullRequested = true;
        window.setTimeout(drainSync, 120);
      });
    if (responsesAvailable) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "partner_responses", filter: `couple_id=eq.${couple.id}` }, () => {
        if (activeContext === contextVersion && activeSubscription === subscriptionVersion) window.setTimeout(pullPartnerResponses, 120);
      }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "couples", filter: `id=eq.${couple.id}` }, payload => {
        if (activeContext !== contextVersion || activeSubscription !== subscriptionVersion) return;
        couple = { ...couple, ...(payload.new || {}) };
        writeCachedCouple();
        notifyResponseContext();
      });
    }
    channel.subscribe(status => {
        if (activeContext !== contextVersion || activeSubscription !== subscriptionVersion) return;
        if (status === "SUBSCRIBED") {
          channelConnected = true;
          reconnectAttempt = 0;
          clearTimeout(reconnectTimer); reconnectTimer = null;
          pullRequested = true;
          drainSync();
          pullPartnerResponses();
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          channelConnected = false;
          setStatus("实时连接中断，正在重连", "error");
          scheduleRealtimeReconnect();
        }
      });
  }

  async function removeChannel() {
    subscriptionVersion += 1;
    channelConnected = false;
    if (channel && client) await client.removeChannel(channel);
    channel = null;
  }

  function scheduleRealtimeReconnect() {
    if (!couple || reconnectTimer || !navigator.onLine) return;
    const delay = RETRY_DELAYS[Math.min(reconnectAttempt, RETRY_DELAYS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(async () => {
      reconnectTimer = null;
      if (!couple || !navigator.onLine) return;
      await subscribe();
      retryPendingSync();
    }, delay);
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
    if (error?.code === "NETWORK_TIMEOUT" || /timed out|fetch|network|offline/i.test(message)) return "网络连接超时，请检查网络后重试。";
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
