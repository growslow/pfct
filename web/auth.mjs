const storageKey = 'pfct-tab-session-v1';
export function validatePublicConfig(urlText, keyText) {
  const url = new URL(urlText.trim()); const key = keyText.trim();
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请填写有效的 Supabase 项目根地址。');
  let anon = false;
  try {
    let payload = key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    payload = payload.padEnd(Math.ceil(payload.length/4)*4,'='); anon = JSON.parse(atob(payload)).role === 'anon';
  } catch { /* Modern publishable keys are not JWTs. */ }
  if (!key.startsWith('sb_publishable_') && !anon) throw new Error('只允许 publishable / anon key，禁止填写 secret 或 service_role。');
  return { url: url.origin, key };
}
export function readConnection() {
  const demo=new URLSearchParams(location.search).get('demo');
  if(['user','admin'].includes(demo))return{mode:'demo',portal:demo};
  try { const c=JSON.parse(sessionStorage.getItem(storageKey)); return c && ['demo','live'].includes(c.mode) ? c : null; } catch { return null; }
}
export function writeConnection(connection) { try{sessionStorage.setItem(storageKey, JSON.stringify(connection));}catch{if(connection.mode==='live')throw new Error('无法保存登录会话，请通过 localhost HTTP 服务打开页面。');} }
export function clearConnection() { try{sessionStorage.removeItem(storageKey);}catch{} }
export function sessionData(data) {
  if (!data?.access_token || !data.refresh_token) throw new Error('没有返回有效登录会话。');
  return { access:data.access_token,refresh:data.refresh_token,expires:Date.now()+(data.expires_in || 3600)*1000,email:data.user?.email || '' };
}
async function responseData(response) {
  let data; try { data=await response.json(); } catch { data=null; }
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || `请求失败（${response.status}）`);
  return data;
}
export async function backend(connection, path, {body,method='POST',authenticated=true}={}) {
  if (authenticated) {
    if (!connection.session) throw new Error('请先登录。');
    if (connection.session.expires<Date.now()+60000) {
      const r=await fetch(connection.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:connection.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:connection.session.refresh})});
      connection.session=sessionData(await responseData(r)); writeConnection(connection);
    }
  }
  return responseData(await fetch(connection.url+path,{method,headers:{apikey:connection.key,'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${connection.session.access}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
}
export async function signOut(connection) {
  try { if(connection?.mode==='live' && connection.session) await backend(connection,'/auth/v1/logout'); }
  finally { clearConnection(); }
}
