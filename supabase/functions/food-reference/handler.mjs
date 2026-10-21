import { createFatSecret, IntegrationError } from '../_shared/fatsecret.mjs';
import { validateItems, scaleServing, totalNutrition, compareNutrition, methodVersion } from '../_shared/nutrition.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createHandler(env, fetcher = fetch) {
  const fatsecret = createFatSecret(env, fetcher);
  const origins = (env.ALLOWED_ORIGINS || 'http://127.0.0.1:8080,http://localhost:8080,http://localhost:3000').split(',').map(x => x.trim());
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.includes(origin)) return json({ message: '此页面来源未获允许。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ message: '仅支持 POST。' }, 405);
    try {
      const bearer = request.headers.get('authorization');
      if (!bearer?.startsWith('Bearer ')) throw new IntegrationError('请先登录。', 401);
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new IntegrationError('Supabase 服务端配置缺失。', 503);
      const base = env.SUPABASE_URL.replace(/\/$/, '');
      async function supa(path, options = {}, admin = false) {
        const key = admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
        if (!key) throw new IntegrationError('服务端数据库密钥尚未配置。', 503);
        const response = await fetcher(base + path, { ...options, signal: AbortSignal.timeout(15000), headers: {
          apikey: key, Authorization: admin ? `Bearer ${key}` : bearer, 'Content-Type': 'application/json', ...options.headers,
        } });
        if (!response.ok) throw new IntegrationError(path === '/auth/v1/user' ? '登录已失效，请重新登录。' : '数据库操作失败，请确认迁移已应用。', path === '/auth/v1/user' ? 401 : 502);
        return response.json();
      }
      // The JWT is verified by Auth, not merely decoded; every action requires a user.
      const user = await supa('/auth/v1/user');
      if (!user?.id) throw new IntegrationError('登录已失效。', 401);
      const text = await request.text();
      if (text.length > 32768) throw new IntegrationError('请求内容过大。', 413);
      let body; try { body = JSON.parse(text); } catch { throw new IntegrationError('请求必须是 JSON。', 400); }
      if (!body || typeof body !== 'object') throw new IntegrationError('请求内容无效。', 400);
      if (body.action === 'search') {
        const query = typeof body.query === 'string' ? body.query.trim() : '';
        if (query.length < 2 || query.length > 100) throw new IntegrationError('请输入 2–100 个字符的食物名称。', 400);
        return json({ foods: await fatsecret.search(query) });
      }
      if (body.action === 'servings') return json({ food: await fatsecret.food(body.food_id) });
      if (!['confirm', 'review'].includes(body.action)) throw new IntegrationError('未知操作。', 400);
      let items, mealId, guessId, confirmationId;
      if (body.action === 'review') {
        if (!uuid.test(body.confirmation_id)) throw new IntegrationError('确认记录 ID 无效。', 400);
        const rows = await supa(`/rest/v1/food_confirmations?id=eq.${body.confirmation_id}&select=*`);
        if (!rows.length) throw new IntegrationError('找不到本人的确认记录。', 404);
        const row = rows[0]; items = validateItems(row.items); mealId = row.meal_id; guessId = row.guess_id; confirmationId = row.id;
      } else {
        if (![body.meal_id, body.guess_id, body.request_id].every(id => uuid.test(id))) throw new IntegrationError('餐食或猜测 ID 无效。', 400);
        items = validateItems(body.items); mealId = body.meal_id; guessId = body.guess_id; confirmationId = body.request_id;
      }
      // RLS checks ownership BEFORE any external queries or service-role writes.
      const guesses = await supa(`/rest/v1/guesses?id=eq.${guessId}&meal_id=eq.${mealId}&select=*`);
      if (guesses.length !== 1) throw new IntegrationError('找不到本人的餐食猜测。', 404);
      const foods = new Map();
      const scaled = [];
      for (const item of items) {
        if (!foods.has(item.food_id)) foods.set(item.food_id, await fatsecret.food(item.food_id));
        const food = foods.get(item.food_id);
        const serving = food.servings.find(s => s.id === item.serving_id);
        if (!serving) throw new IntegrationError('食物与标准份量不匹配。', 422);
        scaled.push(scaleServing(serving, item.quantity, item.measure));
      }
      const reference = totalNutrition(scaled);
      if (body.action === 'confirm') await supa('/rest/v1/rpc/save_food_confirmation', {
        method: 'POST', body: JSON.stringify({ p_id: confirmationId, p_actor: user.id, p_meal: mealId, p_guess: guessId, p_items: items }),
      }, true);
      return json({ confirmation_id: confirmationId, reference, differences: compareNutrition(guesses[0], reference),
        source: 'fatsecret', method_version: methodVersion, calculated_at: new Date().toISOString(),
        recalculated: body.action === 'review', persisted_nutrients: false,
        message: '依据你确认的食物与份量实时估算。结果不是称重检测值；未完整记录的油、酱料和饮料也会影响结果。' });
    } catch (error) {
      const status = error instanceof IntegrationError ? error.status : 400;
      // Never log upstream responses, credentials, JWTs, or food data.
      return json({ message: error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name) ? error.message : '服务暂时不可用，请稍后重试。' }, status);
    }
  };
}
