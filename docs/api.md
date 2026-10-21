# 前端接入协议 v0

Supabase JS 示例也可等价转换为 Swift / Kotlin SDK。每个写操作都必须检查 `error`；错误时停止后续操作。重试用同一个客户端生成的 UUID，避免网络重试生成重复餐食或猜测。

## 1. 登录与参与者 ID

```js
const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
if (loginError) throw loginError;
const { data: participant, error } = await supabase
  .from('participants').select('id').single();
if (error) throw error;
const participantId = participant.id;
```

注册使用 `auth.signUp`；确认邮箱并登录后再读取参与者。不要自行创建或修改 `participants`。

## 2. 记录用户习惯

向 `profile_versions` 插入完整快照：

```json
{
  "participant_id": "参与者 UUID",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai",
  "habits": { "meal_sources": ["canteen", "home_cooking"] }
}
```

习惯字段是初始扩展点，前端正式开发前确定字段字典。读取最新快照：按 `created_at` 降序、`limit(1)`。

## 3. 创建餐食

```js
const mealId = crypto.randomUUID();
const { error } = await supabase.from('meals').insert({
  id: mealId,
  participant_id: participantId,
  eaten_at: new Date().toISOString(),
  timezone: 'Asia/Shanghai',
  meal_type: 'lunch',
});
if (error) throw error;
```

`eaten_at` 是实际用餐时间；`created_at` 由数据库生成，表示记录提交时间。餐次枚举：`breakfast / lunch / dinner / snack / other`。

## 4. 上传照片并登记

```js
const photoId = crypto.randomUUID();
const path = `${participantId}/${mealId}/${photoId}.jpg`;
const { error: uploadError } = await supabase.storage.from('meal-photos')
  .upload(path, imageBytes, { contentType: 'image/jpeg', upsert: false });
if (uploadError) throw uploadError;
const { error: photoError } = await supabase.from('meal_photos').insert({
  id: photoId, participant_id: participantId, meal_id: mealId, storage_path: path,
});
if (photoError) throw photoError;
```

登记失败时保留上传路径，重试登记即可。若上传重试提示路径冲突，确认已有对象后再登记；不要启用覆盖上传。文件上限 10 MiB；支持 JPEG、PNG、HEIC、HEIF、WebP。建议客户端转成 JPEG，便于后续识别服务处理。

查看照片使用本人会话执行 Storage `download(path)`，或创建短期签名 URL；不要把长期可访问链接作为研究数据保存。

## 5. 提交猜测

向 `guesses` 插入：

```json
{
  "id": "本次尝试的 UUID，重试时复用",
  "participant_id": "参与者 UUID",
  "meal_id": "餐食 UUID",
  "protein_g": 30,
  "fat_g": 20,
  "carbs_g": 60,
  "calories_kcal": 550
}
```

不填写 `created_at`。客户端不得写入 `nutrition_estimates` 或 `feedback`。

## 6. 读取记录和后续分析结果

```js
const { data, error } = await supabase.from('meals')
  .select('*, meal_photos(*), guesses(*), nutrition_estimates(*), feedback(*)')
  .eq('id', mealId).single();
if (error) throw error;
```

同一餐可能有多个猜测和参考结果；反馈通过 `guess_id`、`estimate_id` 指定使用哪个版本。空的分析数组代表尚无结果，不能解释为零摄入。嵌套数组没有默认排序，请按服务器时间排序后使用。

日列表：对 `eaten_at` 使用 UTC 范围 `gte(start)`、`lt(nextDayStart)`，并按用餐时间排序；数据量大时分页。不要使用服务器日期代替用户当地日期。

## 尚未开放的后端能力

手动 FatSecret 参考接口已在 `food-reference` Edge Function 中提供，需要部署、配置凭证和 IP 白名单；具体见 `manual-food-confirmation.md`。当前没有照片 AI 识别、汇总全天、研究导出或删除账户的接口。所需密钥仅存服务端。
