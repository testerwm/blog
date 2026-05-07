# Leo's Blog 部署说明

这是一个静态前端 + Supabase 后端的博客。前端部署在 Vercel，文章、评论、创作者登录放在 Supabase。

## 本地预览

在当前目录运行：

```bash
python3 -m http.server 5173
```

然后打开：

```text
http://localhost:5173
```

## 推荐部署位置

推荐：

1. Vercel：部署前端页面。
2. Supabase：保存文章、评论，并保护创作者后台。

## Supabase 设置

1. 创建 Supabase 项目。
2. 打开 `SQL Editor`，运行 `supabase.sql`。
3. 在 `Authentication` 里创建你的作者账号。
4. 打开 `Authentication > Users`，复制你的 user id。
5. 在 SQL Editor 运行：

```sql
insert into public.blog_creators (user_id) values ('你的 user id');
```

6. 在 Supabase `Project Settings > API` 复制 Project URL 和 anon public key。
7. 填入 `config.js`：

```js
window.LEO_BLOG_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "你的 anon public key",
};
```

## Vercel 部署

当前目录已经关联 Vercel 项目。修改 `config.js` 后运行：

```bash
npx vercel deploy --prod --yes
```

## 页面

公开页：

```text
/
```

创作者后台：

```text
/admin.html
```

后台必须登录 Supabase Auth，并且账号 user id 必须存在于 `blog_creators` 表。
