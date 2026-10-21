'use strict';
import { scaleServing, totalNutrition, compareNutrition, nutrientKeys } from './nutrition.mjs';

// Buildless preview. Only a publishable/legacy anon key may be used here.
// Auth tokens and configuration remain in memory and are cleared on refresh.
const $ = (id) => document.getElementById(id);
const state = { mode: 'demo', url: '', key: '', session: null, participant: null,
  file: null, preview: null, attempt: null, records: [], busy: false,
  activeMeal: null, selectedFood: null, drafts: new Map() };
const types = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', other: '其他' };
const fields = ['protein', 'fat', 'carbs', 'calories'];
const values = ['protein_g', 'fat_g', 'carbs_g', 'calories_kcal'];
const units = ['g', 'g', 'g', 'kcal'];

function notice(text, kind = '') { $('notice').textContent = text; $('notice').className = `notice ${kind}`; }
function localTime() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function lock() {
  document.querySelectorAll('button').forEach((el) => { el.disabled = state.busy; });
  document.querySelectorAll('#settings input, #settings select, #confirmation input, #confirmation select').forEach((el) => { el.disabled = state.busy; });
  ['photo', 'meal-type', 'eaten-at', ...fields].forEach((id) => { $(id).disabled = state.busy || !!state.attempt; });
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; lock();
  try { await action(); } catch (e) {
    const message = e.message || '操作失败，请重试。'; notice(message, 'error');
    if (!$('confirmation').hidden) { $('food-status').textContent = message; $('food-status').className = 'notice error'; }
  }
  finally { state.busy = false; lock(); }
}
function resetMeal() {
  state.attempt = null; state.file = null;
  if (state.preview) URL.revokeObjectURL(state.preview);
  state.preview = null;
  $('preview').removeAttribute('src'); $('preview').hidden = true;
  $('upload-hint').hidden = false; $('photo').value = '';
  $('file-name').textContent = '让这一餐，成为你的学习素材。';
  $('guess-form').reset(); $('eaten-at').value = localTime();
  $('result').hidden = true; $('comparison').replaceChildren();
  $('confirmation').hidden = true; state.activeMeal = null; state.selectedFood = null;
  $('submit-guess').textContent = '保存我的猜测 ↗'; lock();
}
function pickFile(file) {
  if (state.busy || state.attempt || !file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return notice('请选择 JPG、PNG 或 WebP 图片。', 'error');
  if (file.size > 10 * 1024 * 1024) return notice('图片超过 10 MB，请选择较小的图片。', 'error');
  if (state.preview) URL.revokeObjectURL(state.preview);
  state.file = file; state.preview = URL.createObjectURL(file);
  $('preview').src = state.preview; $('preview').hidden = false; $('upload-hint').hidden = true;
  $('file-name').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  notice('照片准备好了，接下来猜一猜这餐的 PFCT。');
}
function sessionFrom(data) {
  if (!data.access_token) throw new Error('登录没有返回有效会话，请重新登录。');
  state.session = { access: data.access_token, refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000, email: data.user?.email || '' };
}
async function decodeResponse(response) {
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `请求失败（${response.status}）`);
  return data;
}
async function ensureSession() {
  if (!state.session) throw new Error('请先在连接设置中登录测试账户。');
  if (state.session.expires > Date.now() + 60000) return;
  const response = await fetch(`${state.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: state.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: state.session.refresh }),
  });
  const data = await decodeResponse(response); sessionFrom(data);
}
async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  if (auth) await ensureSession();
  const response = await fetch(state.url + path, {
    method, headers: { apikey: state.key, ...(auth ? { Authorization: `Bearer ${state.session.access}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return decodeResponse(response);
}
async function insert(table, row) {
  // Stable IDs make retries safe, including a response lost after a successful insert.
  return api(`/rest/v1/${table}?on_conflict=id`, { method: 'POST', body: row,
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
}
async function loadParticipant() {
  const rows = await api('/rest/v1/participants?select=id&limit=1');
  if (!rows?.length) throw new Error('账户已登录，但没有参与者记录。请检查是否已应用数据库迁移。');
  state.participant = rows[0].id;
  $('auth-form').hidden = true; $('account').hidden = false;
  $('account-text').textContent = `已登录：${state.session.email}`;
  $('mode-label').textContent = 'Supabase 联调 · 已登录，提交将保存到云端';
}
async function signedPhoto(path) {
  const data = await api(`/storage/v1/object/sign/meal-photos/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', body: { expiresIn: 300 },
  });
  const relative = data.signedURL || data.signedUrl;
  if (!relative) throw new Error('没有返回照片访问地址。');
  const url = new URL(relative.startsWith('/storage/v1/') ? relative : `/storage/v1${relative}`, state.url);
  if (url.origin !== new URL(state.url).origin) throw new Error('照片地址来源不匹配。');
  return url.href;
}
function newest(rows = []) { return [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]; }
function element(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; }
async function renderRecords() {
  const container = $('records'); container.replaceChildren();
  if (!state.records.length) {
    container.append(element('div', 'empty', '还没有餐食记录。上传一张照片，留下你的第一次猜测。')); return;
  }
  for (const row of state.records) {
    const card = element('article', 'record');
    const image = element('img', 'record-image'); image.alt = `${types[row.meal_type] || '餐食'}照片`;
    const main = element('div', 'record-main');
    main.append(element('h3', '', types[row.meal_type] || '餐食'));
    main.append(element('p', '', `${new Date(row.eaten_at).toLocaleString('zh-CN')} · ${state.mode === 'demo' ? '本地演示记录' : '云端记录'}`));
    const guess = newest(row.guesses);
    const nutrients = element('div', 'record-nutrients');
    if (guess) values.forEach((key, i) => nutrients.append(element('span', '', `${['P', 'F', 'C', 'T'][i]} ${guess[key]} ${units[i]}`)));
    else nutrients.append(element('span', '', '尚未提交猜测'));
    main.append(nutrients);
    const estimate = newest(row.nutrition_estimates);
    card.append(image, main, element('span', 'record-status', estimate || row.transientReference ? '已有参考估算' : row.food_confirmations?.length ? '已确认份量' : '待确认份量'));
    const view = element('button', 'quiet', '查看');
    view.addEventListener('click', () => { showResult(row); $('result').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    card.append(view); container.append(card);
    if (row.localImage) image.src = row.localImage;
    else if (row.meal_photos?.length) {
      try { image.src = await signedPhoto(row.meal_photos[0].storage_path); }
      catch { image.hidden = true; main.append(element('p', '', '照片暂不可用，可刷新重试。')); }
    } else image.hidden = true;
  }
}
async function refreshRecords() {
  if (state.mode === 'live') {
    if (!state.participant) throw new Error('请先登录，才能读取你的云端记录。');
    const select = '*,meal_photos(*),guesses(*),nutrition_estimates(*),feedback(*),food_confirmations(*)';
    state.records = await api(`/rest/v1/meals?select=${encodeURIComponent(select)}&order=eaten_at.desc&limit=20`);
  }
  await renderRecords();
}
function showResult(row) {
  state.activeMeal = row; showConfirmation(row);
  const guess = newest(row.guesses);
  const feedback = newest((row.feedback || []).filter((item) => item.guess_id === guess?.id));
  const estimate = feedback ? row.nutrition_estimates?.find((item) => item.id === feedback.estimate_id) : newest(row.nutrition_estimates);
  $('result').hidden = false; $('comparison').replaceChildren();
  $('result-title').textContent = estimate ? '看一看，这次的直觉。' : '猜测已记录，等一次新发现。';
  $('result-description').textContent = estimate
    ? '以下为系统保存的参考估算。照片和份量可能存在误差，不代表精确测量。'
    : state.mode === 'demo' ? '猜测已保存在本页。请在上方填写实际食物的营养标签与食用重量，即可计算对比；不会自动识别照片。刷新页面后记录将清空。'
    : '照片和猜测已保存。请在上方搜索食物，确认实际食用份量，再计算参考结果。';
  if (guess && estimate) {
    const table = element('table', 'comparison');
    const head = element('thead'); const tr = element('tr');
    ['营养项', '你的猜测', '参考估算'].forEach((text) => { const th = element('th', '', text); th.scope = 'col'; tr.append(th); });
    head.append(tr); table.append(head); const body = element('tbody');
    values.forEach((key, i) => { const line = element('tr');
      [['蛋白质', '脂肪', '碳水', '总热量'][i], `${guess[key]} ${units[i]}`, `${estimate[key]} ${units[i]}`]
        .forEach((text) => line.append(element('td', '', text))); body.append(line); });
    table.append(body); $('comparison').append(table);
    if (typeof feedback?.payload?.message === 'string') $('comparison').append(element('p', '', feedback.payload.message));
  }
  if (row.transientReference) renderReference(row.transientReference, guess);
}
async function saveGuess() {
  if (state.attempt?.done) return notice('这一餐已保存。可以开始新的一餐，或刷新记录。', 'success');
  if (state.mode === 'live' && !state.participant) throw new Error('请先打开连接设置，登录测试账户。');
  if (!state.attempt) {
    if (!state.file) throw new Error('请先选择一张餐食照片。');
    const date = new Date($('eaten-at').value);
    if (!Number.isFinite(date.getTime())) throw new Error('请选择有效的用餐时间。');
    const nutrients = Object.fromEntries(values.map((key, i) => [key, Number($(fields[i]).value)]));
    values.forEach((key, i) => { if (!Number.isFinite(nutrients[key]) || nutrients[key] < 0 || nutrients[key] > (i === 3 ? 100000 : 10000)) throw new Error('请输入有效的营养猜测。'); });
    state.attempt = { meal: { id: crypto.randomUUID(), participant_id: state.participant,
      meal_type: $('meal-type').value, eaten_at: date.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
      photoId: crypto.randomUUID(), guessId: crypto.randomUUID(), nutrients, file: state.file };
  }
  const attempt = state.attempt; lock();
  notice(state.mode === 'demo' ? '正在保存演示记录…' : '正在保存照片和猜测，请稍候…');
  if (state.mode === 'demo') {
    const row = { ...attempt.meal, localImage: URL.createObjectURL(attempt.file),
      guesses: [{ id: attempt.guessId, ...attempt.nutrients, created_at: new Date().toISOString() }], nutrition_estimates: [], feedback: [] };
    state.records.unshift(row); attempt.done = true;
    await renderRecords(); showResult(row);
  } else {
    // Preserve every ID and phase on failure, so retry cannot duplicate the record.
    if (!attempt.mealSaved) { await insert('meals', attempt.meal); attempt.mealSaved = true; }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[attempt.file.type];
    const path = `${state.participant}/${attempt.meal.id}/${attempt.photoId}.${ext}`;
    const storagePath = `/storage/v1/object/meal-photos/${path}`;
    if (!attempt.uploaded) {
      await ensureSession();
      const headers = { apikey: state.key, Authorization: `Bearer ${state.session.access}` };
      const response = await fetch(state.url + storagePath, { method: 'POST', headers: { ...headers, 'Content-Type': attempt.file.type, 'x-upsert': 'false' }, body: attempt.file });
      if (!response.ok) {
        // A prior request may have succeeded while its response was lost.
        const existing = await fetch(state.url + storagePath, { headers });
        if (!existing.ok) await decodeResponse(response);
        if (existing.body) await existing.body.cancel();
      }
      attempt.uploaded = true;
    }
    if (!attempt.photoSaved) { await insert('meal_photos', { id: attempt.photoId, participant_id: state.participant, meal_id: attempt.meal.id, storage_path: path }); attempt.photoSaved = true; }
    if (!attempt.guessSaved) { await insert('guesses', { id: attempt.guessId, participant_id: state.participant, meal_id: attempt.meal.id, ...attempt.nutrients }); attempt.guessSaved = true; }
    attempt.done = true;
    await refreshRecords();
    const row = state.records.find((item) => item.id === attempt.meal.id);
    if (row) showResult(row);
    else { $('result').hidden = false; $('result-title').textContent = '餐食与猜测已保存。'; $('result-description').textContent = '当前列表仅显示最近 20 餐，这条记录可能不在列表内。'; }
  }
  $('submit-guess').textContent = '已保存 ✓';
  notice(state.mode === 'demo' ? '演示保存成功。照片未上传，刷新后会清空。' : '已保存到 Supabase。可点击“开始新的一餐”继续。', 'success');
}

function foodStatus(text, kind = '') { $('food-status').textContent = text; $('food-status').className = `notice ${kind}`; }
function draft() {
  if (!state.activeMeal) throw new Error('请先保存这一餐的猜测。');
  if (!state.drafts.has(state.activeMeal.id)) state.drafts.set(state.activeMeal.id, { items: [], requestId: null });
  return state.drafts.get(state.activeMeal.id);
}
function editableDraft() {
  const d = draft();
  if (d.requestId) throw new Error('上一次确认可能已保存。请先用相同份量重试确认，再修改食物。');
  return d;
}
function showConfirmation(row) {
  $('confirmation').hidden = !newest(row.guesses);
  $('confirmation-context').textContent = `正在确认：${types[row.meal_type] || '餐食'} · ${new Date(row.eaten_at).toLocaleString('zh-CN')}。你的原始猜测已保存。`;
  $('live-food-picker').hidden = state.mode !== 'live'; $('label-form').hidden = state.mode !== 'demo';
  $('portion-form').hidden = true; state.selectedFood = null; $('food-results').replaceChildren();
  $('review-reference').hidden = state.mode !== 'live' || !row.food_confirmations?.length;
  $('reference-storage-note').textContent = state.mode === 'live'
    ? '长期保存食物 ID、份量 ID 和你填写的数量。FatSecret 参考数值实时计算，不写入历史营养快照；再次查询可能变化。'
    : '本地标签数据仅在当前页面内存中保存。你需要自行确认标签与食物、份量是否匹配。';
  renderItems(); foodStatus('先加入食物和实际食用份量，再确认计算。');
}
function invalidateReference() {
  if (!state.activeMeal) return;
  draft().confirmed = false;
  delete state.activeMeal.transientReference;
  $('comparison').replaceChildren(); $('result-title').textContent = '份量已修改，等待重新确认。';
  $('result-description').textContent = '确认食物与份量后，系统才会计算本次参考结果。';
}
function renderItems() {
  const container = $('confirmed-items'); container.replaceChildren();
  const d = draft();
  if (!d.items.length) { container.append(element('p', 'small', '这一餐还没有添加食物。')); return; }
  d.items.forEach((item, index) => {
    const row = element('div', 'confirmed-item');
    row.append(element('span', '', `${item.name} · ${item.quantity} ${item.measure === 'servings' ? `× 标准份（${item.description}）` : item.measure}`));
    const remove = element('button', 'quiet', '移除');
    remove.addEventListener('click', () => run(async () => { editableDraft().items.splice(index, 1); invalidateReference(); renderItems(); }));
    row.append(remove); container.append(row);
  });
}
async function referenceApi(body) { return api('/functions/v1/food-reference', { method: 'POST', body }); }
function setMeasureChoices() {
  const serving = state.selectedFood?.servings.find(item => item.id === $('serving-choice').value);
  $('portion-measure').replaceChildren();
  for (const [value, label] of [['servings', '所选标准份的倍数'], ...(serving?.metric_amount > 0 && ['g', 'ml'].includes(serving.metric_unit) ? [[serving.metric_unit, serving.metric_unit === 'g' ? '克（g）' : '毫升（ml）']] : [])]) {
    const option = element('option', '', label); option.value = value; $('portion-measure').append(option);
  }
  $('portion-quantity').value = '1';
}
async function searchFoods() {
  if (state.mode !== 'live' || !state.participant) throw new Error('FatSecret 搜索需要连接 Supabase 并登录。');
  editableDraft(); foodStatus('正在搜索 FatSecret…'); $('food-results').replaceChildren(); $('portion-form').hidden = true;
  const data = await referenceApi({ action: 'search', query: $('food-query').value.trim() });
  if (!data.foods.length) return foodStatus('没有找到食物，可以尝试英文名称或更具体的烹饪方式。');
  for (const food of data.foods) {
    const button = element('button', 'food-option'); button.type = 'button';
    button.append(element('strong', '', food.name), element('small', '', food.brand || '通用食物'), element('small', '', food.description));
    button.addEventListener('click', () => run(async () => {
      editableDraft(); foodStatus('正在读取标准份量…');
      const data = await referenceApi({ action: 'servings', food_id: food.id });
      state.selectedFood = data.food; $('selected-food-name').textContent = data.food.name;
      $('serving-choice').replaceChildren();
      for (const serving of data.food.servings) {
        const option = element('option', '', `${serving.description}${serving.metric_amount ? ` · ${serving.metric_amount} ${serving.metric_unit || ''}` : ''}`);
        option.value = serving.id; $('serving-choice').append(option);
      }
      setMeasureChoices(); $('portion-form').hidden = false; foodStatus('选择标准份，再填写实际食用数量。');
    }));
    $('food-results').append(button);
  }
  foodStatus('请选择与你实际餐食相符的食物。');
}
function addItem(item) {
  const d = editableDraft();
  if (d.items.length >= 30) throw new Error('一餐最多添加 30 项食物。');
  d.items.push(item); invalidateReference(); renderItems(); foodStatus('已加入这一餐，可以继续添加其他食物，或确认份量。', 'success');
}
function renderReference(data, guess) {
  if (!guess || !data.reference) return;
  $('result').hidden = false; $('comparison').replaceChildren();
  $('result-title').textContent = '看一看，这次的直觉。';
  $('result-description').textContent = data.source === 'user_label'
    ? '根据你填写的营养标签和重量计算，不是 FatSecret 或照片识别结果。标签、食物与重量的准确性需要你确认。'
    : `${data.recalculated ? '这是重新查询后的当前参考值，并非当时的历史快照。' : ''}${data.message}`;
  const table = element('table', 'comparison'); const head = element('thead'); const tr = element('tr');
  ['营养项', '你的猜测', '参考估算', '猜测差值'].forEach(text => { const th = element('th', '', text); th.scope = 'col'; tr.append(th); });
  head.append(tr); table.append(head); const tbody = element('tbody');
  const differences = data.differences || compareNutrition(guess, data.reference);
  nutrientKeys.forEach((key, i) => {
    const delta = differences[key].delta;
    const line = element('tr');
    [['蛋白质', '脂肪', '碳水', '总热量'][i], `${guess[key]} ${units[i]}`, `${data.reference[key]} ${units[i]}`,
      `${delta > 0 ? '+' : ''}${delta} ${units[i]}`].forEach(text => line.append(element('td', '', text)));
    tbody.append(line);
  });
  table.append(tbody); $('comparison').append(table);
  $('comparison').append(element('p', 'difference', '正数表示你的猜测高于参考值，负数表示低于参考值。这里不评价你的饮食，也不设置等级。'));
  if (data.source === 'fatsecret') $('comparison').append(element('p', 'small', `来源：FatSecret · 计算于 ${new Date(data.calculated_at).toLocaleString('zh-CN')} · 数值未永久保存`));
}
async function confirmPortions() {
  const row = state.activeMeal; const d = draft(); const guess = newest(row.guesses);
  if (d.confirmed && row.transientReference) { renderReference(row.transientReference, guess); return foodStatus('该份量已经确认，可直接查看结果。', 'success'); }
  if (!d.items.length) throw new Error('请先添加至少一项食物。');
  foodStatus('正在按确认的食物与份量计算…');
  let data;
  if (state.mode === 'demo') {
    const reference = totalNutrition(d.items.map(item => scaleServing(item.serving, item.quantity, item.measure)));
    data = { source: 'user_label', reference, differences: compareNutrition(guess, reference) };
  } else {
    d.requestId ||= crypto.randomUUID();
    const items = d.items.map(({ food_id, serving_id, quantity, measure }) => ({ food_id, serving_id, quantity, measure }));
    data = await referenceApi({ action: 'confirm', meal_id: row.id, guess_id: guess.id, request_id: d.requestId, items });
    row.food_confirmations ||= [];
    if (!row.food_confirmations.some(item => item.id === data.confirmation_id)) row.food_confirmations.push({ id: data.confirmation_id, guess_id: guess.id, created_at: new Date().toISOString() });
    d.requestId = null; $('review-reference').hidden = false;
  }
  d.confirmed = true; row.transientReference = data; renderReference(data, guess); await renderRecords();
  foodStatus('参考结果已计算。下方可以查看你的猜测与参考值的差异。', 'success');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('food-search-form').addEventListener('submit', e => { e.preventDefault(); run(searchFoods); });
$('serving-choice').addEventListener('change', setMeasureChoices);
$('portion-form').addEventListener('submit', e => {
  e.preventDefault(); run(async () => {
    const food = state.selectedFood;
    const serving = food?.servings.find(item => item.id === $('serving-choice').value);
    if (!serving) throw new Error('请先选择食物与标准份量。');
    const quantity = Number($('portion-quantity').value); const measure = $('portion-measure').value;
    scaleServing(serving, quantity, measure);
    addItem({ food_id: food.id, serving_id: serving.id, name: food.name, description: serving.description, quantity, measure });
  });
});
$('label-form').addEventListener('submit', e => {
  e.preventDefault(); run(async () => {
    const name = $('label-name').value.trim(); if (!name) throw new Error('请填写标签上的食物名称。');
    const serving = { metric_amount: Number($('label-base').value), metric_unit: 'g',
      ...Object.fromEntries(values.map((key, i) => [key, Number($(`label-${fields[i]}`).value)])) };
    const quantity = Number($('label-amount').value); scaleServing(serving, quantity, 'g');
    addItem({ name, description: `标签基准 ${serving.metric_amount} g`, quantity, measure: 'g', serving });
    $('label-form').reset();
  });
});
$('confirm-portions').addEventListener('click', () => run(confirmPortions));
$('review-reference').addEventListener('click', () => run(async () => {
  const row = state.activeMeal; const guess = newest(row.guesses);
  const confirmation = newest((row.food_confirmations || []).filter(item => item.guess_id === guess?.id));
  if (!confirmation) throw new Error('这次猜测还没有已保存的份量确认记录。');
  foodStatus('正在重新查询当前 FatSecret 参考值…');
  const data = await referenceApi({ action: 'review', confirmation_id: confirmation.id });
  row.transientReference = data; renderReference(data, guess); foodStatus('已重新计算。当前值可能与过去不同。', 'success');
}));

$('settings-button').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; $('settings-button').setAttribute('aria-expanded', String(!$('settings').hidden)); });
$('photo').addEventListener('change', (e) => pickFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((type) => $('upload-area').addEventListener(type, (e) => { e.preventDefault(); $('upload-area').classList.add('dragging'); }));
['dragleave', 'drop'].forEach((type) => $('upload-area').addEventListener(type, (e) => { e.preventDefault(); $('upload-area').classList.remove('dragging'); }));
$('upload-area').addEventListener('drop', (e) => pickFile(e.dataTransfer.files[0]));
$('guess-form').addEventListener('submit', (e) => { e.preventDefault(); run(saveGuess); });
$('new-meal').addEventListener('click', () => {
  if (state.attempt && !state.attempt.done && !confirm('这次保存尚未全部完成。部分数据可能已写入云端，建议先重试保存。仍要开始新的一餐吗？')) return;
  resetMeal(); notice('新的一餐，新的发现。');
});
$('refresh').addEventListener('click', () => run(async () => { await refreshRecords(); notice('记录已刷新（最多显示最近 20 餐）。', 'success'); }));
$('connect-form').addEventListener('submit', (e) => {
  e.preventDefault(); run(async () => {
    const mode = $('mode').value; const key = $('project-key').value.trim(); let url = '';
    if (mode === 'live') {
      const parsed = new URL($('project-url').value.trim());
      if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('请填写有效的 Supabase 项目根地址（HTTPS，或本机 HTTP）。');
      url = parsed.origin;
      if (!key) throw new Error('请填写 publishable key 或 legacy anon key。');
      let anon = false;
      if (key.split('.').length === 3) {
        try { let part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); part = part.padEnd(Math.ceil(part.length / 4) * 4, '='); anon = JSON.parse(atob(part)).role === 'anon'; } catch { /* reject malformed keys */ }
      }
      if (!key.startsWith('sb_publishable_') && !anon) throw new Error('只能使用 publishable / anon key。不能把 secret 或 service_role 密钥放在网页中。');
    }
    if ((state.records.length || state.attempt) && !confirm('切换连接会清空当前页面的演示记录与未完成操作。云端已有记录不会删除。是否继续？')) return;
    state.records.forEach((row) => { if (row.localImage) URL.revokeObjectURL(row.localImage); });
    state.mode = mode; state.url = url; state.key = mode === 'live' ? key : ''; state.session = null; state.participant = null; state.records = []; state.drafts.clear();
    $('auth-form').hidden = mode !== 'live'; $('account').hidden = true; $('password').value = '';
    $('mode-label').textContent = mode === 'demo' ? '本地演示 · 数据不上传，刷新即清空' : 'Supabase 联调 · 请先登录';
    resetMeal(); await renderRecords(); notice(mode === 'demo' ? '已切换到本地演示。' : '连接配置已应用。请登录测试账户；密钥和会话仅保留在本页内存。');
  });
});
$('auth-form').addEventListener('submit', (e) => { e.preventDefault(); run(async () => {
  const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: $('email').value.trim(), password: $('password').value } });
  sessionFrom(data); $('password').value = ''; await loadParticipant(); await refreshRecords(); notice('登录成功，可以记录餐食了。', 'success');
}); });
$('signup').addEventListener('click', () => {
  if (!$('auth-form').reportValidity()) return;
  run(async () => {
    const data = await api('/auth/v1/signup', { method: 'POST', auth: false, body: { email: $('email').value.trim(), password: $('password').value } });
    $('password').value = '';
    if (data?.access_token) { sessionFrom(data); await loadParticipant(); await refreshRecords(); notice('测试账户注册成功。', 'success'); }
    else notice('注册请求已提交。请检查邮箱，完成验证后返回此页登录。若已注册，可直接登录。', 'success');
  });
});
$('logout').addEventListener('click', () => run(async () => {
  await api('/auth/v1/logout', { method: 'POST' });
  state.session = null; state.participant = null; state.records = []; state.drafts.clear(); resetMeal(); await renderRecords();
  $('auth-form').hidden = false; $('account').hidden = true; $('mode-label').textContent = 'Supabase 联调 · 请先登录'; notice('已退出登录。');
}));
resetMeal();
