import {backend} from './auth.mjs';

export function adminPhotoPath(photo) {
  const path=photo?.storage_path;
  if(typeof path!=='string' || !path.startsWith(`${photo.participant_id}/${photo.meal_id}/`)) throw new Error('照片与餐食路径不匹配。');
  const segments=path.split('/');
  if(segments.length<3 || segments.some(s=>!s || s==='.' || s==='..' || s.includes('\\'))) throw new Error('照片路径无效。');
  return '/storage/v1/object/authenticated/meal-photos/'+segments.map(encodeURIComponent).join('/');
}

export async function downloadAdminPhoto(connection,photo,{request=fetch,authorize=()=>backend(connection,'/rest/v1/rpc/is_admin',{body:{}}),createUrl=blob=>URL.createObjectURL(blob)}={}) {
  const path=adminPhotoPath(photo);
  if(await authorize()!==true) throw new Error('管理员权限已失效，请重新登录。');
  // The Storage SELECT policy independently checks current membership as well.
  let response;
  try {
    response=await request(connection.url+path,{headers:{apikey:connection.key,Authorization:`Bearer ${connection.session.access}`},cache:'no-store',signal:AbortSignal.timeout(45000)});
  } catch(error) {
    throw new Error(['TimeoutError','AbortError'].includes(error?.name)?'照片下载超时，请点击重试。':'照片暂时无法下载，请检查网络后重试。');
  }
  if(!response.ok) throw new Error(response.status===403 || response.status===401?'没有权限读取照片，请确认管理员授权。':'照片暂时无法读取，请检查文件是否存在后重试。');
  const blob=await response.blob();
  if(!blob.type.startsWith('image/')) throw new Error('文件不是可预览的图片格式。');
  return createUrl(blob);
}

// Code-native illustration: no real uploaded photo is bundled with the demo.
export const demoMealPhoto='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#e9eddf"/><ellipse cx="320" cy="200" rx="178" ry="151" fill="#fffdf5" stroke="#d1d9c4" stroke-width="5"/><ellipse cx="270" cy="180" rx="85" ry="76" fill="#ede2bf"/><path d="M350 112 Q450 150 410 246 Q330 280 332 212Z" fill="#c68d65"/><circle cx="260" cy="260" r="35" fill="#8da876"/><circle cx="312" cy="274" r="33" fill="#769261"/><circle cx="235" cy="232" r="25" fill="#9bb784"/><text x="320" y="393" text-anchor="middle" font-size="19" font-family="sans-serif" fill="#607153">演示插图 · 非用户上传照片</text></svg>');
