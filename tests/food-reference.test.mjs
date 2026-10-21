import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaleServing, totalNutrition, compareNutrition, normalizeServing, validateItems } from '../supabase/functions/_shared/nutrition.mjs';
import { createHandler } from '../supabase/functions/food-reference/handler.mjs';

// Synthetic fixtures only: these values are not a food database or user-facing samples.
const serving = { id: '2', metric_amount: 100, metric_unit: 'g', protein_g: 10, fat_g: 4, carbs_g: 20, calories_kcal: 156 };
test('grams scale against the entire standard serving, without multiplying number_of_units twice', () => {
  assert.deepEqual(scaleServing(serving, 150, 'g'), { protein_g: 15, fat_g: 6, carbs_g: 30, calories_kcal: 234 });
  assert.equal(scaleServing({ ...serving, number_of_units: 2 }, 2, 'servings').protein_g, 20);
});
test('ml is supported only with an ml baseline; invalid and missing values fail', () => {
  assert.equal(scaleServing({ ...serving, metric_unit: 'ml' }, 250, 'ml').protein_g, 25);
  assert.throws(() => scaleServing(serving, 100, 'ml'));
  assert.throws(() => scaleServing({ ...serving, metric_amount: 0 }, 100, 'g'));
  for (const n of [0, -1, Infinity, NaN, '']) assert.throws(() => scaleServing(serving, n, 'servings'));
  assert.throws(() => normalizeServing({ serving_id: '2', protein: null }));
});
test('multi-food totals retain fractions until final rounding; zero reference has no percentage', () => {
  assert.equal(totalNutrition([scaleServing(serving, 125, 'g'), scaleServing(serving, 75, 'g')]).protein_g, 20);
  const comparison = compareNutrition({ ...serving, fat_g: 0 }, { ...serving, fat_g: 0, protein_g: 20 });
  assert.equal(comparison.fat_g.relative_percent, null);
  assert.equal(comparison.protein_g.delta, -10);
  assert.equal(comparison.protein_g.relative_percent, -50);
});
test('selection payload strips nutrient values and rejects bad identifiers or empty meals', () => {
  const item = { food_id: '1', serving_id: '2', quantity: 150, measure: 'g' };
  assert.deepEqual(validateItems([{ ...item, protein_g: 999 }]), [item]);
  assert.throws(() => validateItems([]));
  assert.throws(() => validateItems([{ ...item, food_id: '1&select=*' }]));
});
test('browser and service use the exact same calculation module', () => {
  assert.equal(readFileSync(new URL('../web/nutrition.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../supabase/functions/_shared/nutrition.mjs', import.meta.url), 'utf8'));
});

const ids = { meal: '20000000-0000-4000-8000-000000000001', guess: '30000000-0000-4000-8000-000000000001', request: '40000000-0000-4000-8000-000000000001' };
const env = { SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'server-test', FATSECRET_CLIENT_ID: 'id-test', FATSECRET_CLIENT_SECRET: 'secret-test' };
function harness({ owned = true, credentials = true } = {}) {
  const calls = []; let saved;
  const fetcher = async (input, options = {}) => {
    const url = new URL(input); calls.push(url);
    const reply = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/auth/v1/user') return reply({ id: 'user-a' });
    if (url.pathname === '/rest/v1/guesses') return reply(owned ? [{ ...serving, id: ids.guess }] : []);
    if (url.pathname === '/rest/v1/rpc/save_food_confirmation') { saved = JSON.parse(options.body); return reply(ids.request); }
    if (url.hostname === 'oauth.fatsecret.com') { assert.equal(options.body.get('scope'), 'basic'); return reply({ access_token: 'token-test', expires_in: 3600 }); }
    if (url.pathname === '/rest/foods/search/v1') return reply({ foods: { food: { food_id: '1', food_name: 'Synthetic test food' } } });
    if (url.pathname === '/rest/food/v1') return reply({ food: { food_id: '1', food_name: 'Synthetic test food', servings: { serving: { serving_id: '2', serving_description: '100g', metric_serving_amount: '100', metric_serving_unit: 'g', protein: '10', fat: '4', carbohydrate: '20', calories: '156' } } } });
    throw new Error(`Unexpected test URL ${url}`);
  };
  const handler = createHandler(credentials ? env : { ...env, FATSECRET_CLIENT_SECRET: '' }, fetcher);
  const request = (body, headers = {}) => handler(new Request('https://project.example/functions/v1/food-reference', { method: 'POST', headers: { Origin: 'http://127.0.0.1:8080', Authorization: 'Bearer user-token', ...headers }, body: JSON.stringify(body) }));
  return { request, handler, calls, saved: () => saved };
}
test('search normalizes a single result; confirmation ignores client-supplied reference nutrients', async () => {
  const h = harness();
  const search = await h.request({ action: 'search', query: 'rice' }); assert.equal(search.status, 200); assert.equal((await search.json()).foods.length, 1);
  const response = await h.request({ action: 'confirm', meal_id: ids.meal, guess_id: ids.guess, request_id: ids.request,
    items: [{ food_id: '1', serving_id: '2', quantity: 150, measure: 'g', protein_g: 9999 }] });
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.reference.protein_g, 15);
  assert.equal(data.persisted_nutrients, false);
  assert.deepEqual(Object.keys(h.saved().p_items[0]).sort(), ['food_id', 'measure', 'quantity', 'serving_id']);
  assert.equal(h.saved().p_actor, 'user-a');
  assert.equal(h.calls.filter(u => u.hostname === 'oauth.fatsecret.com').length, 1);
});
test('ownership rejection happens before provider queries or service-role writes', async () => {
  const h = harness({ owned: false });
  const response = await h.request({ action: 'confirm', meal_id: ids.meal, guess_id: ids.guess, request_id: ids.request, items: [{ food_id: '1', serving_id: '2', quantity: 1, measure: 'servings' }] });
  assert.equal(response.status, 404); assert.equal(h.calls.length, 2); assert.equal(h.saved(), undefined);
});
test('anonymous users, unlisted origins, malformed JSON and absent provider credentials fail explicitly', async () => {
  const h = harness({ credentials: false });
  assert.equal((await h.request({ action: 'search', query: 'rice' }, { Authorization: '' })).status, 401);
  assert.equal((await h.request({ action: 'search', query: 'rice' }, { Origin: 'https://unlisted.example' })).status, 403);
  const malformed = await h.handler(new Request('https://project.example/functions/v1/food-reference', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: '{' }));
  assert.equal(malformed.status, 400);
  const r = await h.request({ action: 'search', query: 'rice' }); assert.equal(r.status, 503);
  assert.match((await r.json()).message, /尚未配置/);
});
