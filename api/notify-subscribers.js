const SUPABASE_URL = process.env.SUPABASE_URL || "https://ckqryhmuvkeesfeuwytu.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcXJ5aG11dmtlZXNmZXV3eXR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjIyOTEsImV4cCI6MjA5MzczODI5MX0.CJUqI_soaUauB1_AXGZnsgnHzNoj3b0-RjW9siIauAw";
const SITE_URL = process.env.SITE_URL || "https://blog-two-hazel-16.vercel.app";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Leo Wang's Blog <onboarding@resend.dev>";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function supabaseFetch(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.error_description || "Supabase request failed";
    throw new Error(message);
  }
  return data;
}

function stripTags(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function createEmailPayloads(emails, post) {
  const postUrl = `${SITE_URL}/#post-${post.id}`;
  const title = post.title || "Leo Wang's Blog 更新了新文章";
  const preview = stripTags(post.contentHtml).slice(0, 180);

  return emails.map((email) => ({
    from: FROM_EMAIL,
    to: email,
    subject: title,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #20201e;">
        <p>Leo Wang's Blog 发布了新内容。</p>
        ${preview ? `<p>${preview}</p>` : ""}
        <p><a href="${postUrl}">点击阅读</a></p>
      </div>
    `,
    text: `Leo Wang's Blog 发布了新内容。\n\n${preview}\n\n${postUrl}`,
  }));
}

async function sendWithResend(payloads) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  let sent = 0;
  for (const batch of chunk(payloads, 100)) {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || "Resend request failed");
    }
    sent += batch.length;
  }
  return sent;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      sendJson(response, 401, { error: "Missing creator token" });
      return;
    }

    const body = await readBody(request);
    const post = {
      id: String(body.id || ""),
      title: String(body.title || ""),
      contentHtml: String(body.contentHtml || ""),
    };

    if (!post.id || !post.contentHtml) {
      sendJson(response, 400, { error: "Missing post payload" });
      return;
    }

    const user = await supabaseFetch("/auth/v1/user", token);
    const creatorRows = await supabaseFetch(
      `/rest/v1/blog_creators?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token,
    );

    if (!creatorRows.length) {
      sendJson(response, 403, { error: "Not allowed" });
      return;
    }

    const subscribers = await supabaseFetch(
      "/rest/v1/email_subscribers?select=email&status=eq.active&order=created_at.desc",
      token,
    );
    const emails = subscribers.map((subscriber) => subscriber.email).filter(Boolean);

    if (emails.length === 0) {
      sendJson(response, 200, { sent: 0 });
      return;
    }

    const sent = await sendWithResend(createEmailPayloads(emails, post));
    sendJson(response, 200, { sent });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
};
