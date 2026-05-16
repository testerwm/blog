const postList = document.querySelector("#postList");
const reader = document.querySelector("#reader");
const postForm = document.querySelector("#postForm");
const postContent = document.querySelector("#postContent");
const fontSizeSelect = document.querySelector("#fontSizeSelect");
const seedButton = document.querySelector("#seedButton");
const resetButton = document.querySelector("#resetButton");
const loginForm = document.querySelector("#loginForm");
const loginEmail = document.querySelector("#loginEmail");
const loginPassword = document.querySelector("#loginPassword");
const authGate = document.querySelector("#authGate");
const authMessage = document.querySelector("#authMessage");
const publishMessage = document.querySelector("#publishMessage");
const logoutButton = document.querySelector("#logoutButton");
const themeToggle = document.querySelector("#themeToggle");
const emailSubscribeButton = document.querySelector("#emailSubscribeButton");
const subscribeDialog = document.querySelector("#subscribeDialog");
const subscribeForm = document.querySelector("#subscribeForm");
const closeSubscribeButton = document.querySelector("#closeSubscribeButton");
const subscriberEmail = document.querySelector("#subscriberEmail");
const subscribeMessage = document.querySelector("#subscribeMessage");
const creatorOnlyNodes = document.querySelectorAll(".creator-only");
const isCreator = document.body.dataset.role === "creator";
const config = window.LEO_BLOG_CONFIG ?? {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const db = hasSupabaseConfig ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
const POSTS_PAGE_SIZE = 20;
const OUTLINE_LIMIT = 5;

let posts = [];
let activePostId = null;
let currentUser = null;
let hasMorePosts = true;
let isLoadingMorePosts = false;
let scrollFrame = null;
let savedEditorRange = null;
let editingPostId = null;
const ALLOWED_FONT_SIZES = new Set(["14px", "16px", "18px", "22px", "28px"]);
const ALLOWED_COLORS = new Set(["#d97706", "#15803d", "#2563eb", "#b42318", "#25636a"]);
const SAFE_IMAGE_SRC = /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

function applyTheme(theme) {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  localStorage.setItem("leo_blog_theme", resolvedTheme);
  if (themeToggle) {
    themeToggle.innerHTML = getThemeIcon(resolvedTheme);
    themeToggle.setAttribute("aria-label", resolvedTheme === "dark" ? "切换到亮色主题" : "切换到暗色主题");
    themeToggle.setAttribute("title", resolvedTheme === "dark" ? "切换到亮色主题" : "切换到暗色主题");
    themeToggle.setAttribute("aria-pressed", String(resolvedTheme === "dark"));
  }
}

function getThemeIcon(theme) {
  if (theme === "dark") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path>
        <path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path>
        <path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path>
        <path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path>
        <path d="m19.07 4.93-1.41 1.41"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.99 13.1A8.5 8.5 0 0 1 10.9 3.01 8.5 8.5 0 1 0 20.99 13.1Z"></path>
    </svg>
  `;
}

function initTheme() {
  const savedTheme = localStorage.getItem("leo_blog_theme");
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme ?? (prefersDark ? "dark" : "light"));

  themeToggle?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isFallbackTitle(title) {
  return title?.startsWith("未命名文章 ·");
}

function getDisplayTitle(post) {
  if (!isFallbackTitle(post.title)) return post.title;
  return "";
}

function getListTitle(post) {
  if (!isFallbackTitle(post.title)) return post.title;
  return "";
}

function getPostPreview(post, maxLength = 120) {
  const preview = post.excerpt || stripTags(post.content) || formatDate(post.createdAt);
  return preview.length > maxLength ? `${preview.slice(0, maxLength)}...` : preview;
}

function stripTags(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent?.trim() ?? "";
}

function normalizeEditorHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("div").forEach((div) => {
    const p = document.createElement("p");
    while (div.firstChild) p.append(div.firstChild);
    div.replaceWith(p);
  });

  template.content.querySelectorAll("p").forEach((p) => {
    if (p.innerHTML.trim() === "<br>") p.remove();
  });

  const normalized = template.innerHTML.trim();
  if (!normalized) return "";
  if (/<(p|h2|blockquote|ul|ol|li|pre|code|img)\b/i.test(normalized)) return normalized;

  return normalized
    .split(/\n{2,}/)
    .map((chunk) => `<p>${chunk.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = normalizeEditorHTML(html);

  const allowedTags = new Set([
    "A",
    "B",
    "I",
    "EM",
    "STRONG",
    "SPAN",
    "P",
    "BR",
    "UL",
    "OL",
    "LI",
    "H2",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "IMG",
  ]);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const nodes = [];

  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    [...node.attributes].forEach((attr) => {
      if (node.tagName === "A" && attr.name === "href") {
        const href = attr.value.trim();
        const isSafe = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
        if (isSafe) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        } else {
          node.removeAttribute("href");
        }
        return;
      }
      if (node.tagName === "SPAN" && attr.name === "style") {
        sanitizeSpanStyle(node);
        return;
      }
      if (node.tagName === "IMG" && attr.name === "src") {
        const src = attr.value.trim();
        if (SAFE_IMAGE_SRC.test(src)) {
          node.setAttribute("loading", "lazy");
          node.setAttribute("decoding", "async");
        } else {
          node.removeAttribute("src");
        }
        return;
      }
      if (node.tagName === "IMG" && attr.name === "alt") {
        node.setAttribute("alt", attr.value.slice(0, 120));
        return;
      }
      node.removeAttribute(attr.name);
    });

    if (node.tagName === "IMG" && !node.getAttribute("src")) node.remove();
  });

  return template.innerHTML;
}

function sanitizeSpanStyle(node) {
  const color = node.style.color;
  const fontSize = node.style.fontSize;
  node.removeAttribute("style");

  const normalizedColor = normalizeColor(color);

  if (normalizedColor && ALLOWED_COLORS.has(normalizedColor)) node.style.color = normalizedColor;
  if (ALLOWED_FONT_SIZES.has(fontSize)) node.style.fontSize = fontSize;
}

function normalizeColor(value) {
  if (!value) return "";
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const rgb = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return value.toLowerCase();
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function setMessage(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error-text", isError);
}

function bindPublicSubscribe() {
  emailSubscribeButton?.addEventListener("click", () => {
    setMessage(subscribeMessage, "");
    subscribeDialog?.showModal();
  });

  closeSubscribeButton?.addEventListener("click", () => {
    subscribeDialog?.close();
  });

  subscribeDialog?.addEventListener("click", (event) => {
    if (event.target === subscribeDialog) subscribeDialog.close();
  });

  subscribeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!db) {
      setMessage(subscribeMessage, "订阅服务暂不可用，请稍后再试。", true);
      return;
    }

    const email = subscriberEmail.value.trim().toLowerCase();
    if (!email) {
      setMessage(subscribeMessage, "请输入 Email。", true);
      return;
    }

    const submitButton = subscribeForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    setMessage(subscribeMessage, "订阅中...");

    const { error } = await db.from("email_subscribers").insert({ email });
    submitButton.disabled = false;

    if (error) {
      if (error.code === "23505") {
        setMessage(subscribeMessage, "这个 Email 已经订阅过了。");
        return;
      }

      if (error.code === "PGRST205" || error.message.includes("email_subscribers")) {
        setMessage(subscribeMessage, "订阅表还未初始化，请先在 Supabase 执行最新 SQL。", true);
        return;
      }

      setMessage(subscribeMessage, error.message, true);
      return;
    }

    subscribeForm.reset();
    setMessage(subscribeMessage, "订阅成功。");
  });
}

async function notifySubscribers(post) {
  const {
    data: { session },
  } = await db.auth.getSession();

  if (!session?.access_token) return;

  try {
    const response = await fetch("/api/notify-subscribers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: post.id,
        title: post.title,
        contentHtml: post.content_html,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(publishMessage, `文章已发布，邮件通知失败：${data.error || "未知错误"}`, true);
      return;
    }

    if (data.sent > 0) {
      setMessage(publishMessage, `文章已发布，已通知 ${data.sent} 个订阅邮箱。`);
    }
  } catch (error) {
    setMessage(publishMessage, `文章已发布，邮件通知失败：${error.message}`, true);
  }
}

function showSetupState() {
  postList.innerHTML = '<p class="post-meta">请先完成 Supabase 配置。</p>';
  reader.innerHTML = `
    <div class="empty-state">
      <h2>需要配置云端数据库</h2>
      <p>请在 config.js 填入 Supabase URL 和 anon key，然后运行 supabase.sql 初始化数据库。</p>
    </div>
  `;
  if (isCreator) {
    setMessage(authMessage, "后台已锁定：请先配置 Supabase。", true);
  }
}

function normalizePost(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt ?? "",
    content: sanitizeHTML(row.content_html ?? ""),
    createdAt: row.created_at,
  };
}

async function fetchPosts({ append = false } = {}) {
  const from = append ? posts.length : 0;
  const to = from + POSTS_PAGE_SIZE - 1;
  const { data: postRows, error: postError } = await db
    .from("posts")
    .select("id,title,excerpt,content_html,created_at,updated_at")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (postError) throw postError;
  hasMorePosts = postRows.length === POSTS_PAGE_SIZE;

  const nextPosts = postRows.map((row) => normalizePost(row));
  posts = append ? [...posts, ...nextPosts] : nextPosts;
  activePostId = posts.some((post) => post.id === activePostId) ? activePostId : posts[0]?.id ?? null;
}

function renderPostList() {
  postList.innerHTML = "";

  if (posts.length === 0) {
    postList.innerHTML = '<p class="post-meta">暂无文章。</p>';
    return;
  }

  posts.slice(0, OUTLINE_LIMIT).forEach((post) => {
    const button = document.createElement("button");
    button.className = `post-item${post.id === activePostId ? " active" : ""}`;
    button.type = "button";
    button.dataset.postId = post.id;
    const listTitle = getListTitle(post);
    button.classList.toggle("untitled", !listTitle);
    button.innerHTML = listTitle ? `<strong></strong><span></span>` : `<span class="post-preview-only"></span>`;
    if (listTitle) {
      button.querySelector("strong").textContent = listTitle;
      button.querySelector("span").textContent = getPostPreview(post, 72);
    } else {
      button.querySelector(".post-preview-only").textContent = getPostPreview(post);
    }
    button.addEventListener("click", () => {
      activePostId = post.id;
      renderPostList();
      scrollToPost(post.id);
    });
    postList.append(button);
  });
}

function scrollToPost(postId) {
  const target = document.querySelector(`#post-${postId}`);
  if (!target) return;

  const headerOffset = document.querySelector(".site-header")?.offsetHeight ?? 0;
  const targetTop = target.getBoundingClientRect().top + window.scrollY - headerOffset - 18;
  window.scrollTo({ top: Math.max(targetTop, 0), behavior: "smooth" });
}

function renderReader() {
  if (posts.length === 0) {
    reader.innerHTML = `
      <div class="empty-state">
        <h2>还没有文章</h2>
        <p>${isCreator ? "从上方发布第一篇内容。" : "作者还没有发布内容。"}</p>
      </div>
    `;
    return;
  }

  reader.innerHTML = posts.map((post) => renderPostArticle(post)).join("");

  posts.forEach((post) => {
    const article = reader.querySelector(`#post-${post.id}`);
    article.querySelector(".post-content").innerHTML = post.content;

    article.querySelector(".delete-post-button")?.addEventListener("click", async () => {
      await deletePost(post.id, post.title);
    });

    article.querySelector(".edit-post-button")?.addEventListener("click", () => {
      startEditingPost(post.id);
    });
  });

  updateActivePostFromScroll();
}

function renderPostArticle(post) {
  const displayTitle = getDisplayTitle(post);
  const titleMarkup = displayTitle ? `<h2>${escapeHTML(displayTitle)}</h2>` : "";

  return `
    <section class="post-entry" id="post-${post.id}" data-post-id="${post.id}">
      <header>
        ${titleMarkup}
        <p class="post-meta">${formatDate(post.createdAt)}</p>
        ${
          isCreator && currentUser
            ? `<div class="post-actions">
                <button class="ghost-button small edit-post-button" type="button">编辑文章</button>
                <button class="danger-button small delete-post-button" type="button">删除文章</button>
              </div>`
            : ""
        }
      </header>
      <div class="post-content"></div>
    </section>
  `;
}

function updateActivePostFromScroll() {
  const entries = reader.querySelectorAll(".post-entry");
  if (entries.length === 0) return;

  const headerOffset = document.querySelector(".site-header")?.offsetHeight ?? 0;
  const marker = window.scrollY + headerOffset + 36;
  let current = entries[0];

  entries.forEach((entry) => {
    if (entry.offsetTop <= marker) {
      current = entry;
    }
  });

  if (current?.dataset.postId && current.dataset.postId !== activePostId) {
    activePostId = current.dataset.postId;
    renderPostList();
  }
}

function bindScrollHandlers() {
  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(async () => {
        scrollFrame = null;
        updateActivePostFromScroll();
        await maybeLoadMorePosts();
      });
    },
    { passive: true },
  );
}

async function maybeLoadMorePosts() {
  if (!hasMorePosts || isLoadingMorePosts || posts.length === 0) return;

  const distanceToBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  if (distanceToBottom > 700) return;

  isLoadingMorePosts = true;
  try {
    await fetchPosts({ append: true });
    render();
  } finally {
    isLoadingMorePosts = false;
  }
}

async function deletePost(postId, title) {
  if (!currentUser) return;

  const displayTitle = title && !isFallbackTitle(title) ? `《${title}》` : "这篇文章";
  const confirmed = window.confirm(`确定删除${displayTitle}吗？`);
  if (!confirmed) return;

  const { error } = await db.from("posts").delete().eq("id", postId);

  if (error) {
    window.alert(`删除失败：${error.message}`);
    return;
  }

  if (activePostId === postId) {
    activePostId = null;
  }
  if (editingPostId === postId) {
    resetEditor();
  }

  await refresh();
}

function hasPostContent(html) {
  if (stripTags(html)) return true;

  const template = document.createElement("template");
  template.innerHTML = html;
  return Boolean(template.content.querySelector("img[src]"));
}

function render() {
  renderPostList();
  renderReader();
}

function isRangeInsideEditor(range) {
  return Boolean(range && postContent?.contains(range.commonAncestorContainer));
}

function saveEditorSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (isRangeInsideEditor(range)) savedEditorRange = range.cloneRange();
}

function restoreEditorSelection() {
  if (!savedEditorRange || !postContent) return false;

  postContent.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorRange);
  return true;
}

function applyInlineStyle(property, value) {
  if (!postContent || !value) return;
  restoreEditorSelection();

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (!isRangeInsideEditor(range) || range.collapsed) {
    postContent.focus();
    return;
  }

  const span = document.createElement("span");
  span.style[property] = value;

  try {
    range.surroundContents(span);
  } catch {
    span.append(range.extractContents());
    range.insertNode(span);
  }

  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(span);
  selection.addRange(nextRange);
  savedEditorRange = nextRange.cloneRange();
  postContent.focus();
}

function placeCaretAtEnd(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  savedEditorRange = range.cloneRange();
}

function applyBlockFormat(value) {
  if (!postContent || !value) return;

  const isEmpty = !stripTags(postContent.innerHTML);
  if (isEmpty) {
    postContent.innerHTML = `<${value}><br></${value}>`;
    postContent.focus();
    placeCaretAtEnd(postContent.querySelector(value));
    return;
  }

  restoreEditorSelection();
  postContent.focus();
  document.execCommand("formatBlock", false, value);
  saveEditorSelection();
}

function insertHTMLAtEditor(html) {
  if (!postContent || !html) return;
  restoreEditorSelection();
  postContent.focus();

  const selection = window.getSelection();
  const range =
    selection && selection.rangeCount > 0 && isRangeInsideEditor(selection.getRangeAt(0))
      ? selection.getRangeAt(0)
      : document.createRange();

  if (!selection?.rangeCount || !isRangeInsideEditor(range)) {
    range.selectNodeContents(postContent);
    range.collapse(false);
  }

  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = sanitizeHTML(html);
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  const nextRange = document.createRange();
  if (lastNode) {
    nextRange.setStartAfter(lastNode);
  } else {
    nextRange.selectNodeContents(postContent);
    nextRange.collapse(false);
  }
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  savedEditorRange = nextRange.cloneRange();
}

function isCodeLikePaste(text) {
  const value = text.trim();
  if (!value.includes("\n")) return false;

  const lines = value.split("\n");
  const indentedLines = lines.filter((line) => /^(\s{2,}|\t)/.test(line)).length;
  const codeSignals = [
    /```/,
    /<\/?[a-z][\s\S]*>/i,
    /\b(function|const|let|var|return|class|import|export|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|mysql|python3?|npm|curl|git)\b/,
    /[{};=()[\]<>]/,
    /(^|\n)\s*(if|for|while|switch|try|catch|def|class)\b/,
  ];

  return indentedLines >= 2 || codeSignals.some((pattern) => pattern.test(value));
}

function insertCodeBlock(text) {
  const code = text.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "");
  insertHTMLAtEditor(`<pre><code>${escapeHTML(code)}</code></pre><p><br></p>`);
}

function insertImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      insertHTMLAtEditor(`<p><img src="${reader.result}" alt="粘贴的图片"></p><p><br></p>`);
      resolve();
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function handleEditorPaste(event) {
  if (!postContent) return;

  const clipboard = event.clipboardData;
  if (!clipboard) return;

  const imageFiles = [...clipboard.files].filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length > 0) {
    event.preventDefault();
    for (const file of imageFiles) {
      await insertImageFile(file);
    }
    saveEditorSelection();
    return;
  }

  const text = clipboard.getData("text/plain");
  const html = clipboard.getData("text/html");
  if (text && isCodeLikePaste(text)) {
    event.preventDefault();
    insertCodeBlock(text);
    saveEditorSelection();
    return;
  }

  if (html) {
    event.preventDefault();
    insertHTMLAtEditor(html);
    saveEditorSelection();
  }
}

function unwrapNode(node) {
  const parent = node.parentNode;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  node.remove();
}

function getPlainTextFromRange(range) {
  const fragment = range.cloneContents();
  const container = document.createElement("div");
  container.append(fragment);
  return container.textContent ?? "";
}

function clearEditorFormatting() {
  const restored = restoreEditorSelection();
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

  if (restored && isRangeInsideEditor(range) && !range.collapsed) {
    const text = getPlainTextFromRange(range);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    const nextRange = document.createRange();
    nextRange.setStartAfter(textNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedEditorRange = nextRange.cloneRange();
    postContent.focus();
    return;
  }

  postContent.querySelectorAll("span, font").forEach(unwrapNode);
  postContent.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
  postContent.focus();
}

function updateEditorMode() {
  const submitButton = postForm?.querySelector("button[type='submit']");
  if (submitButton) submitButton.textContent = editingPostId ? "保存修改" : "发布文章";
  if (resetButton) resetButton.textContent = editingPostId ? "取消编辑" : "清空";
}

function resetEditor() {
  postForm?.reset();
  if (postContent) postContent.innerHTML = "";
  editingPostId = null;
  savedEditorRange = null;
  updateEditorMode();
  setMessage(publishMessage, "");
}

function startEditingPost(postId) {
  const post = posts.find((item) => item.id === postId);
  if (!post || !postContent) return;

  editingPostId = post.id;
  postContent.innerHTML = post.content;
  savedEditorRange = null;
  updateEditorMode();
  setMessage(publishMessage, "正在编辑已发布文章。");

  document.querySelector("#editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    postContent.focus();
    placeCaretAtEnd(postContent);
  }, 260);
}

async function refresh() {
  try {
    await fetchPosts({ append: false });
    render();
  } catch (error) {
    reader.innerHTML = `
      <div class="empty-state">
        <h2>数据加载失败</h2>
        <p>${escapeHTML(error.message)}</p>
      </div>
    `;
  }
}

function setCreatorUI(isSignedIn) {
  authGate?.classList.toggle("hidden", isSignedIn);
  logoutButton?.classList.toggle("hidden", !isSignedIn);
  creatorOnlyNodes.forEach((node) => node.classList.toggle("hidden", !isSignedIn));
}

async function verifyCreator(userId) {
  const { data, error } = await db.from("blog_creators").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function initAuth() {
  const {
    data: { session },
  } = await db.auth.getSession();

  currentUser = session?.user ?? null;

  if (!currentUser) {
    setCreatorUI(false);
    return;
  }

  const isAllowed = await verifyCreator(currentUser.id);
  if (!isAllowed) {
    await db.auth.signOut();
    currentUser = null;
    setCreatorUI(false);
    setMessage(authMessage, "这个账号不是创作者账号。请在 blog_creators 表里加入你的 user_id。", true);
    return;
  }

  setCreatorUI(true);
  await refresh();
}

function bindEditor() {
  updateEditorMode();

  postContent?.addEventListener("keyup", saveEditorSelection);
  postContent?.addEventListener("mouseup", saveEditorSelection);
  postContent?.addEventListener("input", saveEditorSelection);
  postContent?.addEventListener("paste", handleEditorPaste);

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      const value = button.dataset.value;

      if (command === "createLink") {
        const url = window.prompt("请输入链接地址，以 https:// 开头");
        if (!url) return;
        restoreEditorSelection();
        document.execCommand(command, false, url);
        saveEditorSelection();
        return;
      }

      if (command === "formatBlock") {
        applyBlockFormat(value);
        return;
      }

      restoreEditorSelection();
      const commandValue = command === "formatBlock" && value ? `<${value}>` : value ?? null;
      document.execCommand(command, false, commandValue);
      saveEditorSelection();
    });
  });

  document.querySelectorAll("[data-inline-style]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      applyInlineStyle(button.dataset.inlineStyle, button.dataset.value);
    });
  });

  fontSizeSelect?.addEventListener("focus", saveEditorSelection);
  fontSizeSelect?.addEventListener("change", () => {
    applyInlineStyle("fontSize", fontSizeSelect.value);
    fontSizeSelect.value = "";
  });

  const clearFormatButton = document.querySelector("#clearFormatButton");
  clearFormatButton?.addEventListener("mousedown", (event) => event.preventDefault());
  clearFormatButton?.addEventListener("click", () => {
    clearEditorFormatting();
  });

  postForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = sanitizeHTML(postContent.innerHTML);

    if (!hasPostContent(content) || !currentUser) {
      setMessage(publishMessage, "请先写正文内容。", true);
      return;
    }

    if (editingPostId) {
      setMessage(publishMessage, "保存中...");
      const savedPostId = editingPostId;
      const { error } = await db
        .from("posts")
        .update({
          content_html: content,
        })
        .eq("id", savedPostId);

      if (error) {
        setMessage(publishMessage, error.message, true);
        return;
      }

      activePostId = savedPostId;
      resetEditor();
      setMessage(publishMessage, "已保存修改。");
      await refresh();
      location.hash = "home";
      return;
    }

    setMessage(publishMessage, "发布中...");
    const { data: insertedPost, error } = await db
      .from("posts")
      .insert({
        title: "",
        excerpt: "",
        content_html: content,
        published: true,
        author_id: currentUser.id,
      })
      .select("id,title,content_html")
      .single();

    if (error) {
      setMessage(publishMessage, error.message, true);
      return;
    }

    resetEditor();
    await refresh();
    await notifySubscribers(insertedPost);
    location.hash = "home";
  });

  resetButton?.addEventListener("click", () => {
    resetEditor();
  });

  seedButton?.addEventListener("click", async () => {
    if (!currentUser) return;
    const sampleContent = sanitizeHTML(`
      <p>今天把这个小小的角落整理出来，留给之后的文字、观察和一些未必完整的想法。</p>
      <h2>新的开始</h2>
      <p>我希望这里保持简单，打开就能读，写下也不费力。</p>
      <blockquote>记录不一定宏大，但它会慢慢留下一个人的轮廓。</blockquote>
      <ul><li>读过的书</li><li>走过的地方</li><li>突然冒出来的念头</li></ul>
    `);

    const { error } = await db.from("posts").insert({
      title: "",
      excerpt: "",
      content_html: sampleContent,
      published: true,
      author_id: currentUser.id,
    });

    if (error) {
      setMessage(publishMessage, error.message, true);
      return;
    }

    await refresh();
  });
}

function bindAuth() {
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(authMessage, "登录中...");

    const { data, error } = await db.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value,
    });

    if (error) {
      setMessage(authMessage, error.message, true);
      return;
    }

    currentUser = data.user;
    const isAllowed = await verifyCreator(currentUser.id);

    if (!isAllowed) {
      await db.auth.signOut();
      currentUser = null;
      setMessage(authMessage, `请先把这个 user_id 加到 blog_creators：${data.user.id}`, true);
      return;
    }

    setMessage(authMessage, "");
    setCreatorUI(true);
    await refresh();
  });

  logoutButton?.addEventListener("click", async () => {
    await db.auth.signOut();
    currentUser = null;
    setCreatorUI(false);
  });
}

async function init() {
  initTheme();
  bindScrollHandlers();

  if (!hasSupabaseConfig || !db) {
    showSetupState();
    return;
  }

  if (isCreator) {
    setCreatorUI(false);
    bindAuth();
    bindEditor();
    await initAuth();
    return;
  }

  bindPublicSubscribe();
  await refresh();
}

init();
