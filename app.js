const postList = document.querySelector("#postList");
const reader = document.querySelector("#reader");
const postForm = document.querySelector("#postForm");
const postTitle = document.querySelector("#postTitle");
const postExcerpt = document.querySelector("#postExcerpt");
const postContent = document.querySelector("#postContent");
const seedButton = document.querySelector("#seedButton");
const resetButton = document.querySelector("#resetButton");
const commentTemplate = document.querySelector("#commentTemplate");
const loginForm = document.querySelector("#loginForm");
const loginEmail = document.querySelector("#loginEmail");
const loginPassword = document.querySelector("#loginPassword");
const authGate = document.querySelector("#authGate");
const authMessage = document.querySelector("#authMessage");
const publishMessage = document.querySelector("#publishMessage");
const logoutButton = document.querySelector("#logoutButton");
const themeToggle = document.querySelector("#themeToggle");
const creatorOnlyNodes = document.querySelectorAll(".creator-only");
const isCreator = document.body.dataset.role === "creator";
const config = window.LEO_BLOG_CONFIG ?? {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const db = hasSupabaseConfig ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

let posts = [];
let activePostId = null;
let currentUser = null;

function applyTheme(theme) {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  localStorage.setItem("leo_blog_theme", resolvedTheme);
  if (themeToggle) {
    themeToggle.textContent = resolvedTheme === "dark" ? "亮色" : "暗色";
    themeToggle.setAttribute("aria-pressed", String(resolvedTheme === "dark"));
  }
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
  if (/<(p|h2|blockquote|ul|ol|li)\b/i.test(normalized)) return normalized;

  return normalized
    .split(/\n{2,}/)
    .map((chunk) => `<p>${chunk.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = normalizeEditorHTML(html);

  const allowedTags = new Set(["A", "B", "I", "EM", "STRONG", "P", "BR", "UL", "OL", "LI", "H2", "BLOCKQUOTE"]);
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
      node.removeAttribute(attr.name);
    });
  });

  return template.innerHTML;
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

function normalizePost(row, comments = []) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt ?? "",
    content: sanitizeHTML(row.content_html ?? ""),
    createdAt: row.created_at,
    comments,
  };
}

function buildCommentTree(rows) {
  const map = new Map();
  const roots = [];

  rows.forEach((row) => {
    map.set(row.id, {
      id: row.id,
      postId: row.post_id,
      parentId: row.parent_id,
      author: row.author_name || "匿名",
      body: row.body,
      createdAt: row.created_at,
      children: [],
    });
  });

  map.forEach((comment) => {
    if (comment.parentId && map.has(comment.parentId)) {
      map.get(comment.parentId).children.push(comment);
    } else {
      roots.push(comment);
    }
  });

  return roots;
}

async function fetchPosts() {
  const { data: postRows, error: postError } = await db
    .from("posts")
    .select("id,title,excerpt,content_html,created_at")
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (postError) throw postError;

  const postIds = postRows.map((post) => post.id);
  let commentsByPost = new Map();

  if (postIds.length > 0) {
    const { data: commentRows, error: commentError } = await db
      .from("comments")
      .select("id,post_id,parent_id,author_name,body,created_at")
      .in("post_id", postIds)
      .eq("approved", true)
      .order("created_at", { ascending: true });

    if (commentError) throw commentError;

    postIds.forEach((postId) => {
      const rows = commentRows.filter((comment) => comment.post_id === postId);
      commentsByPost.set(postId, buildCommentTree(rows));
    });
  }

  posts = postRows.map((row) => normalizePost(row, commentsByPost.get(row.id) ?? []));
  activePostId = posts.some((post) => post.id === activePostId) ? activePostId : posts[0]?.id ?? null;
}

function renderPostList() {
  postList.innerHTML = "";

  if (posts.length === 0) {
    postList.innerHTML = '<p class="post-meta">暂无文章。</p>';
    return;
  }

  posts.forEach((post) => {
    const button = document.createElement("button");
    button.className = `post-item${post.id === activePostId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = post.title;
    button.querySelector("span").textContent = post.excerpt || stripTags(post.content).slice(0, 72);
    button.addEventListener("click", () => {
      activePostId = post.id;
      render();
    });
    postList.append(button);
  });
}

function renderReader() {
  const post = posts.find((item) => item.id === activePostId);

  if (!post) {
    reader.innerHTML = `
      <div class="empty-state">
        <h2>还没有文章</h2>
        <p>${isCreator ? "从下方发布第一篇内容。" : "作者还没有发布内容。"}</p>
      </div>
    `;
    return;
  }

  reader.innerHTML = `
    <header>
      <h2>${escapeHTML(post.title)}</h2>
      <p class="post-meta">${formatDate(post.createdAt)} · ${countComments(post.comments)} 条评论</p>
      ${
        isCreator && currentUser
          ? `<div class="post-actions"><button class="danger-button" id="deletePostButton" type="button">删除文章</button></div>`
          : ""
      }
    </header>
    <div class="post-content" id="postContentView"></div>
    <section class="comments" aria-label="评论">
      <h3>匿名评论</h3>
      <form class="comment-form" id="commentForm">
        <input type="text" maxlength="24" placeholder="昵称，可留空匿名" />
        <textarea rows="3" maxlength="400" placeholder="写下你的评论" required></textarea>
        <button class="primary-button" type="submit">发表评论</button>
      </form>
      <ol class="comment-tree" id="commentTree"></ol>
    </section>
  `;

  reader.querySelector("#postContentView").innerHTML = post.content;

  reader.querySelector("#deletePostButton")?.addEventListener("click", async () => {
    await deletePost(post.id, post.title);
  });

  reader.querySelector("#commentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const [nameInput, bodyInput] = event.currentTarget.elements;
    await addComment(post.id, null, nameInput.value, bodyInput.value);
    event.currentTarget.reset();
  });

  renderComments(post, reader.querySelector("#commentTree"), post.comments, true);
}

async function deletePost(postId, title) {
  if (!currentUser) return;

  const confirmed = window.confirm(`确定删除《${title}》吗？这篇文章下的评论也会一起删除。`);
  if (!confirmed) return;

  const { error } = await db.from("posts").delete().eq("id", postId);

  if (error) {
    window.alert(`删除失败：${error.message}`);
    return;
  }

  if (activePostId === postId) {
    activePostId = null;
  }

  await refresh();
}

function renderComments(post, container, comments, showEmpty = false) {
  container.innerHTML = "";

  if (comments.length === 0) {
    if (!showEmpty) return;
    const empty = document.createElement("p");
    empty.className = "post-meta";
    empty.textContent = "还没有评论，来写第一条。";
    container.append(empty);
    return;
  }

  comments.forEach((comment) => {
    const node = commentTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".comment-meta").textContent = `${comment.author || "匿名"} · ${formatDate(comment.createdAt)}`;
    node.querySelector(".comment-body").textContent = comment.body;

    const replyButton = node.querySelector(".reply-button");
    const replyForm = node.querySelector(".reply-form");
    replyButton.addEventListener("click", () => replyForm.classList.toggle("hidden"));
    node.querySelector(".cancel-reply").addEventListener("click", () => replyForm.classList.add("hidden"));
    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const [nameInput, bodyInput] = event.currentTarget.elements;
      await addComment(post.id, comment.id, nameInput.value, bodyInput.value);
    });

    renderComments(post, node.querySelector(".comment-children"), comment.children);
    container.append(node);
  });
}

async function addComment(postId, parentId, author, body) {
  if (!body.trim()) return;

  const { error } = await db.from("comments").insert({
    post_id: postId,
    parent_id: parentId,
    author_name: author.trim() || "匿名",
    body: body.trim(),
    approved: true,
  });

  if (error) {
    window.alert("评论提交失败，请稍后再试。");
    return;
  }

  await refresh();
}

function countComments(comments) {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.children), 0);
}

function render() {
  renderPostList();
  renderReader();
}

async function refresh() {
  try {
    await fetchPosts();
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
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      const value = button.dataset.value;

      if (command === "createLink") {
        const url = window.prompt("请输入链接地址，以 https:// 开头");
        if (!url) return;
        postContent.focus();
        document.execCommand(command, false, url);
        return;
      }

      postContent.focus();
      const commandValue = command === "formatBlock" && value ? `<${value}>` : value ?? null;
      document.execCommand(command, false, commandValue);
    });
  });

  document.querySelector("#clearFormatButton")?.addEventListener("click", () => {
    document.execCommand("removeFormat", false, null);
    postContent.focus();
  });

  postForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = postTitle.value.trim();
    const content = sanitizeHTML(postContent.innerHTML);

    if (!title || !stripTags(content) || !currentUser) return;

    setMessage(publishMessage, "发布中...");
    const { error } = await db.from("posts").insert({
      title,
      excerpt: postExcerpt.value.trim(),
      content_html: content,
      published: true,
      author_id: currentUser.id,
    });

    if (error) {
      setMessage(publishMessage, error.message, true);
      return;
    }

    postForm.reset();
    postContent.innerHTML = "";
    setMessage(publishMessage, "已发布。");
    await refresh();
    location.hash = "home";
  });

  resetButton?.addEventListener("click", () => {
    postForm.reset();
    postContent.innerHTML = "";
    setMessage(publishMessage, "");
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
      title: "第一篇随笔",
      excerpt: "今天把这个小小的角落整理出来，留给之后的文字。",
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

  await refresh();
}

init();
