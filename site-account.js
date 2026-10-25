(() => {
  const config = window.GAME_SITE_SUPABASE;
  const defaultAvatar = "🟢";
  const avatars = ["🟢", "🦊", "🐼", "🐸", "🐱", "🐧", "🐙", "🐲"];
  const storageKey = "night-arcade-session";
  const configured = Boolean(config && config.url && config.anonKey && config.anonKey !== "PASTE_SUPABASE_ANON_KEY_HERE");
  let session = loadSession();
  let profile = null;
  let modal;
  let onAuthChanged = () => {};

  for (const trigger of document.querySelectorAll(".account-trigger")) {
    trigger.type = "button";
    trigger.setAttribute("aria-label", "打开个人信息中心");
    trigger.title = "个人信息中心";
    trigger.textContent = defaultAvatar;
    trigger.addEventListener("click", openAccount);
  }

  window.gameSite = {
    get user() { return session && session.user ? session.user : null; },
    get isConfigured() { return configured; },
    onAuthChanged(callback) {
      onAuthChanged = callback;
      callback(session ? session.user : null);
    },
    refreshScores: (gameSlug) => getScores(gameSlug, "global", 10),
    getScores,
    submitScore
  };

  if (configured && session) {
    loadProfile().catch((error) => {
      console.error("Unable to load player profile.", error);
    });
  }

  function loadSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      return saved && saved.access_token && saved.user ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function saveSession(value) {
    if (value && value.expires_in && !value.expires_at) {
      value.expires_at = Math.floor(Date.now() / 1000) + value.expires_in;
    }
    session = value;
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
    onAuthChanged(session ? session.user : null);
    updateTriggers();
  }

  function updateTriggers() {
    const avatar = profile && profile.avatar ? profile.avatar : defaultAvatar;
    for (const trigger of document.querySelectorAll(".account-trigger")) {
      trigger.textContent = avatar;
      trigger.setAttribute("aria-label", session ? "打开个人信息中心" : "登录或注册");
    }
  }

  function apiUrl(path) {
    return `${config.url.replace(/\/+$/, "")}${path}`;
  }

  async function request(path, options = {}, authenticated = true) {
    if (!configured) throw new Error("尚未配置 Supabase，请先在 supabase-config.js 中填写 anon/public key。");
    if (authenticated && session && session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 30) {
      if (!session.refresh_token) throw new Error("登录已过期，请重新登录。");
      const refreshed = await authRequest("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession(refreshed);
    }
    const headers = new Headers(options.headers || {});
    headers.set("apikey", config.anonKey);
    headers.set("Content-Type", "application/json");
    if (authenticated && session) headers.set("Authorization", `Bearer ${session.access_token}`);
    else headers.set("Authorization", `Bearer ${config.anonKey}`);
    const response = await fetch(apiUrl(path), { ...options, headers });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch (error) { throw new Error("服务返回了无法识别的响应。"); }
    }
    if (!response.ok) {
      const message = data && (data.msg || data.message || data.error_description || data.error);
      throw new Error(message || `请求失败（${response.status}）。`);
    }
    return data;
  }

  async function authRequest(path, body) {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || "认证请求失败。");
    return data;
  }

  async function loadProfile() {
    if (!session || !session.user) return;
    const rows = await request(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id,nickname,avatar`);
    profile = rows[0] || {
      user_id: session.user.id,
      nickname: session.user.user_metadata && session.user.user_metadata.nickname || "玩家",
      avatar: defaultAvatar
    };
    updateTriggers();
  }

  function openAccount() {
    ensureModal();
    if (!configured) {
      renderSignedOut();
      showMessage("请先在 supabase-config.js 中填写 anon/public key，并执行 supabase-schema.sql。", true);
    } else if (session) {
      renderProfile();
      loadProfile().then(renderProfile).catch((error) => showMessage(error.message, true));
    } else {
      renderAuth("login");
    }
    modal.hidden = false;
    const firstField = modal.querySelector("input");
    if (firstField) firstField.focus();
  }

  function ensureModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "account-backdrop";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
        <div class="account-dialog-head">
          <div><h2 id="accountTitle"></h2><p class="account-dialog-subtitle" id="accountSubtitle"></p></div>
          <button class="account-close" type="button" aria-label="关闭">×</button>
        </div>
        <div id="accountContent"></div>
        <p class="account-message" id="accountMessage" aria-live="polite"></p>
      </section>`;
    document.body.append(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".account-close")) modal.hidden = true;
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") modal.hidden = true;
    });
  }

  function setDialog(title, subtitle, content) {
    modal.querySelector("#accountTitle").textContent = title;
    modal.querySelector("#accountSubtitle").textContent = subtitle;
    modal.querySelector("#accountContent").replaceChildren(content);
    showMessage("");
  }

  function showMessage(text, isError = false) {
    const message = modal.querySelector("#accountMessage");
    message.textContent = text;
    if (isError) message.dataset.error = "true";
    else delete message.dataset.error;
  }

  function renderSignedOut() {
    const content = document.createElement("div");
    content.className = "account-form";
    const note = document.createElement("p");
    note.className = "account-dialog-subtitle";
    note.textContent = "开启账号后即可保存个人资料，并将成绩提交到全站排行榜。";
    content.append(note);
    setDialog("个人信息中心", "账号与游戏记录", content);
  }

  function renderAuth(mode) {
    const registering = mode === "register";
    const form = document.createElement("form");
    form.className = "account-form";
    form.innerHTML = `
      ${registering ? '<label class="account-field">昵称<input name="nickname" maxlength="24" autocomplete="nickname" required value="玩家"></label>' : ""}
      <label class="account-field">邮箱<input name="email" type="email" autocomplete="email" required></label>
      <label class="account-field">密码<input name="password" type="password" minlength="6" autocomplete="${registering ? "new-password" : "current-password"}" required></label>
      ${registering ? `<div class="account-field"><span>选择头像</span><div class="account-avatar-choices" role="group" aria-label="选择头像">${avatars.map((avatar, index) => `<button class="account-avatar-choice" type="button" data-avatar="${avatar}" aria-pressed="${index === 0}">${avatar}</button>`).join("")}</div></div>` : ""}
      <button class="account-submit" type="submit">${registering ? "创建账号" : "登录"}</button>`;
    if (registering) {
      form.querySelectorAll("[data-avatar]").forEach((button) => button.addEventListener("click", () => {
        form.querySelectorAll("[data-avatar]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
      }));
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector(".account-submit");
      submit.disabled = true;
      try {
        const values = new FormData(form);
        const email = String(values.get("email")).trim();
        const password = String(values.get("password"));
        if (registering) {
          const nickname = String(values.get("nickname")).trim();
          const avatar = form.querySelector('[aria-pressed="true"]')?.dataset.avatar || defaultAvatar;
          const result = await authRequest("/auth/v1/signup", { email, password, data: { nickname, avatar } });
          if (result.access_token) {
            saveSession(result);
            await loadProfile();
            renderProfile();
          } else {
            renderAuth("login");
            showMessage("注册成功。请先通过邮箱验证账号，再返回登录。");
          }
        } else {
          const result = await authRequest("/auth/v1/token?grant_type=password", { email, password });
          saveSession(result);
          await loadProfile();
          renderProfile();
        }
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
    setDialog(registering ? "创建玩家账号" : "欢迎回来", "账号用于同步资料与排行榜成绩", form);
    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "account-switch";
    switchButton.textContent = registering ? "已有账号？立即登录" : "还没有账号？创建一个";
    switchButton.addEventListener("click", () => renderAuth(registering ? "login" : "register"));
    modal.querySelector("#accountContent").append(switchButton);
  }

  function renderProfile() {
    if (!session) return;
    profile = profile || { nickname: "玩家", avatar: defaultAvatar };
    const content = document.createElement("div");
    const current = document.createElement("div");
    current.className = "account-current";
    current.innerHTML = `<span class="account-current-avatar"></span><div style="min-width:0"><div class="account-current-name"></div><div class="account-current-email"></div></div>`;
    current.querySelector(".account-current-avatar").textContent = profile.avatar || defaultAvatar;
    current.querySelector(".account-current-name").textContent = profile.nickname || "玩家";
    current.querySelector(".account-current-email").textContent = session.user.email || "";
    const form = document.createElement("form");
    form.className = "account-form";
    form.innerHTML = `
      <label class="account-field">昵称<input name="nickname" maxlength="24" autocomplete="nickname" required></label>
      <div class="account-field"><span>头像</span><div class="account-avatar-choices" role="group" aria-label="选择头像">${avatars.map((avatar) => `<button class="account-avatar-choice" type="button" data-avatar="${avatar}">${avatar}</button>`).join("")}</div></div>
      <button class="account-submit" type="submit">保存个人资料</button>`;
    form.elements.nickname.value = profile.nickname || "玩家";
    form.querySelectorAll("[data-avatar]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.avatar === (profile.avatar || defaultAvatar)));
      button.addEventListener("click", () => form.querySelectorAll("[data-avatar]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button))));
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector(".account-submit");
      submit.disabled = true;
      try {
        const nickname = String(new FormData(form).get("nickname")).trim();
        const avatar = form.querySelector('[aria-pressed="true"]')?.dataset.avatar || defaultAvatar;
        await request("/rest/v1/profiles?on_conflict=user_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: session.user.id, nickname, avatar })
        });
        profile = { user_id: session.user.id, nickname, avatar };
        updateTriggers();
        onAuthChanged(session.user);
        renderProfile();
        showMessage("个人资料已保存。");
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "account-signout";
    signOut.textContent = "退出登录";
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        await request("/auth/v1/logout", { method: "POST" });
        profile = null;
        saveSession(null);
        modal.hidden = true;
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        signOut.disabled = false;
      }
    });
    content.append(current, form, signOut);
    setDialog("个人信息中心", "修改昵称与头像", content);
  }

  async function getScores(gameSlug, scope, limit) {
    if (!configured) throw new Error("排行榜服务尚未配置。");
    const filters = new URLSearchParams({
      select: "id,score,created_at,user_id,profiles(nickname,avatar)",
      game_slug: `eq.${gameSlug}`,
      order: "score.desc,created_at.asc",
      limit: String(limit)
    });
    if (scope === "personal") {
      if (!session) return [];
      filters.set("user_id", `eq.${session.user.id}`);
    }
    return request(`/rest/v1/game_scores?${filters.toString()}`, {}, false);
  }

  async function submitScore(gameSlug, score) {
    if (!configured) throw new Error("排行榜服务尚未配置。");
    if (!session) throw new Error("登录后才能将成绩提交到全站排行榜。");
    const value = Number(score);
    if (!Number.isInteger(value) || value < 0 || value > 5720) throw new Error("成绩超出有效范围。");
    await request("/rest/v1/game_scores", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ game_slug: gameSlug, user_id: session.user.id, score: value })
    });
  }
})();
