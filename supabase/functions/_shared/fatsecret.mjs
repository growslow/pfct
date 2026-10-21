import { asArray, normalizeServing } from './nutrition.mjs';

export class IntegrationError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function createFatSecret(env, fetcher = fetch) {
  let cachedToken;
  async function token() {
    if (cachedToken?.expires > Date.now() + 60000) return cachedToken.value;
    if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) throw new IntegrationError('服务端尚未配置 FatSecret Client ID / Secret。', 503);
    const response = await fetcher('https://oauth.fatsecret.com/connect/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'basic' }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new IntegrationError('FatSecret 授权失败，请检查服务端凭证及出口 IP 白名单。');
    cachedToken = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return cachedToken.value;
  }
  async function call(path, params) {
    const url = new URL(`https://platform.fatsecret.com/rest/${path}`);
    Object.entries({ ...params, format: 'json' }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (response.status === 401) cachedToken = null;
    if (!response.ok || data.error) throw new IntegrationError(`FatSecret 查询失败${data.error?.code ? `（代码 ${data.error.code}）` : ''}，请检查接口权限、配额和 IP 白名单。`);
    return data;
  }
  return {
    async search(query) {
      const data = await call('foods/search/v1', { search_expression: query, max_results: 12, page_number: 0 });
      return asArray(data.foods?.food).map(food => ({ id: String(food.food_id), name: food.food_name,
        brand: food.brand_name || '', description: food.food_description || '' }));
    },
    async food(id) {
      if (!/^\d{1,20}$/.test(String(id))) throw new IntegrationError('食物 ID 无效', 400);
      // v1 is deprecated upstream but remains the basic-compatible integration.
      // Do not silently switch to a Premier endpoint or localization scope.
      const data = await call('food/v1', { food_id: id });
      if (!data.food || String(data.food.food_id) !== String(id)) throw new IntegrationError('没有找到对应食物。', 404);
      const servings = [];
      for (const raw of asArray(data.food.servings?.serving)) {
        try { servings.push(normalizeServing(raw)); } catch { /* Missing nutrients are not zero. */ }
      }
      if (!servings.length) throw new IntegrationError('该食物没有完整的 PFCT 份量数据，请选择其他条目。', 422);
      return { id: String(id), name: data.food.food_name, servings };
    },
  };
}
