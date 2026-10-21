export const nutrientKeys = ['protein_g', 'fat_g', 'carbs_g', 'calories_kcal'];
export const methodVersion = 'manual-portions-v1';
export function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
export function number(value, label, max = 100000) {
  if (value === '' || value == null || typeof value === 'boolean') throw new Error(`${label}缺失`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label}无效`);
  return n;
}
export function normalizeServing(raw) {
  return { id: String(raw.serving_id), description: raw.serving_description || '标准份',
    metric_amount: raw.metric_serving_amount ? number(raw.metric_serving_amount, '标准份量') : null,
    metric_unit: raw.metric_serving_unit || null,
    protein_g: number(raw.protein, '蛋白质'), fat_g: number(raw.fat, '脂肪'),
    carbs_g: number(raw.carbohydrate, '碳水'), calories_kcal: number(raw.calories, '热量') };
}
export function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new Error('请选择 1–30 项食物');
  return items.map(item => {
    if (!/^\d{1,20}$/.test(String(item.food_id)) || !/^\d{1,20}$/.test(String(item.serving_id))) throw new Error('食物或份量 ID 无效');
    const quantity = number(item.quantity, '食用数量', 10000);
    if (quantity <= 0 || !['servings', 'g', 'ml'].includes(item.measure)) throw new Error('食用份量无效');
    return { food_id: String(item.food_id), serving_id: String(item.serving_id), quantity, measure: item.measure };
  });
}
export function scaleServing(serving, quantity, measure) {
  const amount = number(quantity, '食用数量', 10000);
  if (amount <= 0) throw new Error('食用数量必须大于零');
  let factor;
  if (measure === 'servings') factor = amount; // A multiple of the WHOLE selected serving.
  else if (['g', 'ml'].includes(measure) && serving.metric_unit === measure && serving.metric_amount > 0) factor = amount / serving.metric_amount;
  else throw new Error('该标准份无法换算为所选单位；克与毫升不能直接互换');
  return Object.fromEntries(nutrientKeys.map(k => [k, number(serving[k], k) * factor]));
}
export function totalNutrition(items) {
  const totals = Object.fromEntries(nutrientKeys.map(k => [k, 0]));
  for (const item of items) for (const key of nutrientKeys) totals[key] += number(item[key], key);
  for (const key of nutrientKeys) totals[key] = Math.round(number(totals[key], key, key === 'calories_kcal' ? 100000 : 10000) * 100) / 100;
  return totals;
}
export function compareNutrition(guess, reference) {
  return Object.fromEntries(nutrientKeys.map(key => {
    const g = number(guess[key], key); const r = number(reference[key], key);
    const delta = Math.round((g - r) * 100) / 100;
    return [key, { delta, relative_percent: r === 0 ? null : Math.round(delta / r * 1000) / 10 }];
  }));
}
