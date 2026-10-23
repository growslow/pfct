import {validatePublicConfig,readConnection,writeConnection,clearConnection,sessionData,backend} from './auth.mjs';
import {publicConfig} from './public-config.mjs';
const $=id=>document.getElementById(id); let portal='user'; let busy=false;
function message(text,error=false){$('login-notice').textContent=text;$('login-notice').className=`notice ${error?'error':''}`;}
function role(value){
  if(busy)return; portal=value;const admin=value==='admin';
  $('user-role').setAttribute('aria-pressed',String(!admin));$('admin-role').setAttribute('aria-pressed',String(admin));
  $('login-title').textContent=admin?'研究数据，从这里查看。':'欢迎回来。';
  $('login-eyebrow').textContent=admin?'RESEARCH WORKSPACE':'YOUR NEXT DISCOVERY';
  $('login-copy').textContent=admin?'使用已获授权的管理员账户，查看用户与研究记录。':'登录后，继续认识自己的每一餐。';
  $('login-submit').textContent=admin?'验证并进入管理台 ↗':'登录，开始记录 ↗';
  $('demo-entry').textContent=admin?'体验管理员演示 ↗':'体验用户演示 ↗';
  $('demo-copy').textContent=admin?'管理员演示只显示合成样本，不读取任何真实用户数据。':'演示不连接数据库，餐食数据刷新后清空。';
  $('admin-boundary').hidden=!admin;$('login-signup').hidden=admin;
}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button,input').forEach(x=>x.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{busy=false;document.querySelectorAll('button,input').forEach(x=>x.disabled=false);}}
function config(){return {...validatePublicConfig($('login-url').value,$('login-key').value),mode:'live',portal};}
async function finish(connection,data){
  connection.session=sessionData(data);
  if(portal==='admin' && await backend(connection,'/rest/v1/rpc/is_admin',{body:{}})!==true){
    // Revoke the newly created session rather than retain a failed admin login.
    try{await backend(connection,'/auth/v1/logout');}catch{}
    throw new Error('此账户没有管理员权限。请联系项目负责人授权，或切换用户登录。');
  }
  writeConnection(connection);location.href=portal==='admin'?'admin.html':'index.html';
}
$('user-role').addEventListener('click',()=>role('user'));$('admin-role').addEventListener('click',()=>role('admin'));
$('login-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{
  const c=config();clearConnection();const data=await backend(c,'/auth/v1/token?grant_type=password',{authenticated:false,body:{email:$('login-email').value.trim(),password:$('login-password').value}});
  $('login-password').value='';await finish(c,data);
});});
$('login-signup').addEventListener('click',()=>{
  if(portal!=='user'||!$('login-form').reportValidity())return;
  action(async()=>{const c=config();clearConnection();const redirect=new URL('login.html',location.href).href;const data=await backend(c,'/auth/v1/signup?redirect_to='+encodeURIComponent(redirect),{authenticated:false,body:{email:$('login-email').value.trim(),password:$('login-password').value}});
    $('login-password').value='';if(data?.access_token)await finish(c,data);else message('注册请求已提交。请检查邮箱并验证，然后返回登录。');});
});
$('demo-entry').addEventListener('click',()=>{clearConnection();writeConnection({mode:'demo',portal});location.href=portal==='admin'?'admin.html?demo=admin':'index.html?demo=user';});
$('login-url').value=publicConfig.url;$('login-key').value=publicConfig.key;
$('connection-details').hidden=!['localhost','127.0.0.1'].includes(location.hostname);
message('使用邮箱注册或登录，开始记录你的每一餐。');
const previous=readConnection();if(previous?.mode==='live' && !$('connection-details').hidden){ $('login-url').value=previous.url;$('login-key').value=previous.key;}
const callback=new URLSearchParams(location.hash.slice(1));
if(location.hash){history.replaceState(null,'',location.pathname+location.search);if(callback.has('error'))message('邮箱验证链接无效或已过期，请返回邮箱检查最新邮件。',true);else if(callback.has('access_token'))message('邮箱验证已完成，请输入邮箱和密码登录。');}
if(new URLSearchParams(location.search).get('portal')==='admin')role('admin');
if(new URLSearchParams(location.search).has('expired'))message('登录会话已失效，请重新登录。',true);
