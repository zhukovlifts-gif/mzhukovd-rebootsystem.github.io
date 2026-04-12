/**
 * ╔══════════════════════════════════════════════════════╗
 * ║   REBOOT SYSTEM — Cloudflare Worker                 ║
 * ║   Secure Telegram Bot proxy                         ║
 * ║                                                      ║
 * ║   Secrets (встановити в Cloudflare Dashboard):      ║
 * ║     BOT_TOKEN  — токен Telegram бота                ║
 * ║     CHAT_ID    — ID чату для отримання заявок        ║
 * ║     ALLOWED_ORIGIN — твій домен (напр. https://reboot-system.com.ua) ║
 * ╚══════════════════════════════════════════════════════╝
 */

export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204, env);
    }

    // ── Тільки POST ────────────────────────────────────
    if (request.method !== 'POST') {
      return corsResponse(JSON.stringify({ ok: false, description: 'Method not allowed' }), 405, env);
    }

    // ── Origin check — захист від сторонніх сайтів ─────
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    if (allowed && origin !== allowed) {
      return corsResponse(JSON.stringify({ ok: false, description: 'Forbidden' }), 403, env);
    }

    // ── Rate limiting — не більше 5 заявок за 10 хвилин з одного IP ──
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `rl:${ip}`;
    if (env.RATE_LIMIT_KV) {
      const count = parseInt(await env.RATE_LIMIT_KV.get(rateLimitKey) || '0');
      if (count >= 5) {
        return corsResponse(
          JSON.stringify({ ok: false, description: 'Забагато запитів. Спробуй через 10 хвилин.' }),
          429, env
        );
      }
      await env.RATE_LIMIT_KV.put(rateLimitKey, String(count + 1), { expirationTtl: 600 });
    }

    // ── Парсимо тіло ───────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ ok: false, description: 'Invalid JSON' }), 400, env);
    }

    // ── Валідація обов'язкових полів ───────────────────
    const required = ['name', 'age', 'phone', 'social', 'goal', 'plan', 'desc', 'time'];
    for (const field of required) {
      if (!body[field] || String(body[field]).trim() === '') {
        return corsResponse(
          JSON.stringify({ ok: false, description: `Відсутнє поле: ${field}` }),
          400, env
        );
      }
    }

    // ── Sanitize — видаляємо потенційно небезпечні символи ──
    const s = (v) => String(v).replace(/[<>]/g, '').substring(0, 500);

    // ── Формуємо повідомлення ──────────────────────────
    const text =
      '🔔 НОВА ЗАЯВКА — REBOOT SYSTEM\n\n' +
      `👤 Ім'я: ${s(body.name)}\n` +
      `🎂 Вік: ${s(body.age)}\n` +
      `📞 Телефон: ${s(body.phone)}\n` +
      `💬 ${s(body.social)}\n` +
      `🎯 Мета: ${s(body.goal)}\n` +
      `⭐ Рівень: ${s(body.plan)}\n\n` +
      `📝 Ситуація:\n${s(body.desc)}\n\n` +
      `🕐 Час: ${s(body.time)}`;

    // ── Відправляємо в Telegram ─────────────────────────
    const tgUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    let tgRes;
    try {
      tgRes = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: text
        })
      });
    } catch (err) {
      console.error('Telegram fetch error:', err);
      return corsResponse(
        JSON.stringify({ ok: false, description: 'Telegram недоступний. Спробуй пізніше.' }),
        502, env
      );
    }

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('Telegram API error:', JSON.stringify(tgData));
      return corsResponse(
        JSON.stringify({ ok: false, description: tgData.description || 'Telegram error' }),
        500, env
      );
    }

    // ── Успіх ───────────────────────────────────────────
    return corsResponse(JSON.stringify({ ok: true }), 200, env);
  }
};

// ── Хелпер: відповідь з CORS заголовками ─────────────────
function corsResponse(body, status, env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
