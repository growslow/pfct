import {readConnection,backend,signOut,clearConnection} from './auth.mjs';
import {downloadAdminPhoto,demoMealPhoto} from './admin-photos.mjs?v=20261023-photos2';
const $=id=>document.getElementById(id);const connection=readConnection();const pageSize=20;
let offset=0,total=0,busy=false,selected=null,mealOffset=0,mealTotal=0;
const photoUrls=new Set();let photoGeneration=0;
const mealNames={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'加餐',other:'其他'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const date=value=>value?new Date(value).toLocaleString('zh-CN'):'暂无记录';
const consent=value=>value==='granted'?'已记录同意':value==='withdrawn'?'已记录撤回':'未记录';
function notice(text,error=false){$('admin-notice').textContent=text;$('admin-notice').className=`notice ${error?'error':''}`;}
function controls(){document.querySelectorAll('button,input,select').forEach(n=>n.disabled=busy||n.dataset.unavailable==='true');const pp=$('participants-prev'),pn=$('participants-next');if(pp)pp.disabled=busy||offset===0;if(pn)pn.disabled=busy||offset+pageSize>=total;const prev=$('meals-prev'),next=$('meals-next');if(prev)prev.disabled=busy||mealOffset===0;if(next)next.disabled=busy||mealOffset+pageSize>=mealTotal;}
async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){notice(e.message,true);}finally{busy=false;controls();}}
function blocked(text){$('admin-main').replaceChildren(el('h1','', '暂时无法进入管理台。'),el('p','subtle',text));const a=el('a','primary','返回登录');a.href='login.html?portal=admin';$('admin-main').append(a);}
const demoParticipants=[0,1,2,3].map((n)=>({id:`demo-participant-${String(n+1).padStart(3,'0')}`,created_at:`2026-10-${15+n}T02:00:00Z`,account_linked:true,meal_count:n===3?0:1,guess_count:n===3?0:n===0?2:1,confirmation_count:n===0?1:0,latest_submission:n===3?null:`2026-10-${19+n}T04:00:00Z`,consent_action:n===0?'granted':n===2?'withdrawn':null}));
function demoDetail(id){const p=demoParticipants.find(x=>x.id===id);if(!p)throw new Error('没有找到演示用户。');return{participant:p,profiles:[],consents:p.consent_action?[{action:p.consent_action,document_version:'demo-v1',created_at:p.created_at}]:[],meal_total:p.meal_count,meals:p.meal_count?[{id:`${id}-meal`,meal_type:'lunch',eaten_at:p.latest_submission,created_at:p.latest_submission,timezone:'Asia/Shanghai',photo_count:1,guesses:Array.from({length:p.guess_count},(_,n)=>({id:`${id}-guess-${n}`,protein_g:20+n*2,fat_g:12,carbs_g:50,calories_kcal:400+n*10,created_at:`2026-10-${id.endsWith('001')?'19':id.endsWith('002')?'20':'21'}T04:0${n}:00Z`})),confirmations:p.confirmation_count?[{id:'demo-confirmation',created_at:p.latest_submission,items:[{food_id:'demo-only',serving_id:'demo-only',quantity:150,measure:'g'}]}]:[],estimates:[],feedback:[]}]:[]};}
async function overview(){const data=connection.mode==='demo'?{participants:demoParticipants.length,meals:demoParticipants.reduce((a,p)=>a+p.meal_count,0),guesses:demoParticipants.reduce((a,p)=>a+p.guess_count,0),confirmations:demoParticipants.reduce((a,p)=>a+p.confirmation_count,0)}:await backend(connection,'/rest/v1/rpc/admin_overview',{body:{}});for(const key of ['participants','meals','guesses','confirmations'])$(`stat-${key}`).textContent=data[key];}
async function list(){const query=$('participant-query').value.trim();const filter=$('participant-filter').value;let data;
 if(connection.mode==='demo'){const rows=demoParticipants.filter(p=>p.id.includes(query)&&(filter==='all'||(filter==='with_records'?p.meal_count>0:p.meal_count===0)));data={total:rows.length,rows:rows.slice(offset,offset+pageSize)};}
 else data=await backend(connection,'/rest/v1/rpc/admin_participants',{body:{p_query:query,p_filter:filter,p_offset:offset,p_limit:pageSize}});
 total=data.total;const rows=$('participant-rows');rows.replaceChildren();
 for(const p of data.rows){const tr=el('tr');if(p.id===selected)tr.className='selected-row';const identity=el('td');identity.append(el('strong','participant-id',p.id),el('small','',`加入：${date(p.created_at)}${p.account_linked?'':' · 账户已解除关联'}`));
 tr.append(identity,el('td','',`${p.meal_count} / ${p.guess_count}`),el('td','',date(p.latest_submission)),el('td','',consent(p.consent_action)));const td=el('td');const b=el('button','quiet','查看');b.setAttribute('aria-label',`查看 ${p.id}`);b.addEventListener('click',()=>action(async()=>{selected=p.id;mealOffset=0;await detail();await list();notice('已加载用户的原始记录。');}));td.append(b);tr.append(td);rows.append(tr);}
 if(!data.rows.length){const tr=el('tr');const td=el('td','empty','没有符合条件的用户记录。');td.colSpan=5;tr.append(td);rows.append(tr);}
 $('participant-page').textContent=total?`${offset+1}–${Math.min(offset+pageSize,total)} / ${total} 位`:'0 位用户';controls();
}
function jsonBlock(title,value){const d=el('details','raw-details');d.append(el('summary','',title),el('pre','',JSON.stringify(value,null,2)));return d;}
function closePhoto(){if($('photo-dialog').open)$('photo-dialog').close();$('photo-dialog-image').removeAttribute('src');}
function releasePhotos(){photoGeneration++;closePhoto();for(const url of photoUrls)URL.revokeObjectURL(url);photoUrls.clear();}
function openPhoto(url,caption){$('photo-dialog-image').src=url;$('photo-dialog-caption').textContent=caption;$('photo-dialog').showModal();}
function photoPanel(meal){
 const panel=el('section','meal-photo-panel');panel.setAttribute('aria-label','餐食照片预览');
 if(!meal.photo_count){panel.append(el('p','small','这一餐没有登记照片。'));return panel;}
 const button=el('button','quiet',`查看照片（${meal.photo_count}）`);button.type='button';
 const status=el('p','small','点击加载私有照片，点击缩略图可放大。');status.setAttribute('role','status');
 const gallery=el('div','meal-photo-grid');let next=0;const generation=photoGeneration;
 panel.append(button,status,gallery);
 async function loadBatch(){
   if(generation!==photoGeneration || !panel.isConnected)return;
   status.textContent='正在加载照片…';
   const data=connection.mode==='demo'?{total:1,photos:[{id:'demo-photo',demo:true,created_at:meal.created_at}]}:await backend(connection,'/rest/v1/rpc/admin_meal_photos',{body:{p_meal:meal.id,p_offset:next,p_limit:12}});
   if(generation!==photoGeneration || !panel.isConnected)return;
   for(const photo of data.photos){
     const tile=el('div','photo-tile');const caption=`${mealNames[meal.meal_type]||'餐食'} · ${date(meal.eaten_at)}${photo.demo?' · 演示插图（非上传照片）':''}`;
     const zoom=el('button','photo-thumbnail');zoom.type='button';zoom.disabled=true;zoom.dataset.unavailable='true';zoom.setAttribute('aria-label',`放大查看${caption}`);
     const image=el('img');image.alt=caption;image.decoding='async';zoom.append(image);
     const note=el('p','small',photo.demo?'演示插图':'照片加载中…');tile.append(zoom,note);gallery.append(tile);
     async function loadImage(){
       try{
         const url=photo.demo?demoMealPhoto:await downloadAdminPhoto(connection,photo);
         if(generation!==photoGeneration || !tile.isConnected){if(!photo.demo)URL.revokeObjectURL(url);return;}
         if(!photo.demo)photoUrls.add(url);
         image.src=url;image.hidden=false;zoom.disabled=false;delete zoom.dataset.unavailable;
         note.textContent=photo.demo?'演示插图 · 点击放大':`上传：${date(photo.created_at)} · 点击放大`;
         zoom.onclick=()=>openPhoto(url,caption);
       }catch(error){image.hidden=true;zoom.disabled=true;zoom.dataset.unavailable='true';note.textContent=error.message;const retry=el('button','quiet','重试');retry.type='button';retry.addEventListener('click',()=>action(async()=>{retry.remove();await loadImage();}));tile.append(retry);}
     }
     image.onerror=()=>{image.hidden=true;zoom.disabled=true;zoom.dataset.unavailable='true';note.textContent='浏览器无法预览该图片格式，可尝试 JPG / PNG / WebP。';};
     await loadImage();
   }
   next+=data.photos.length;button.hidden=next>=data.total || !data.photos.length;
   button.textContent=`继续加载照片（${next}/${data.total}）`;
   status.textContent=data.total?`已读取 ${next} / ${data.total} 张照片记录。`:'没有找到已登记的照片。';
 }
 button.addEventListener('click',()=>action(async()=>{try{await loadBatch();}catch(error){status.textContent=error.message;throw error;}}));
 return panel;
}
async function detail(){const data=connection.mode==='demo'?demoDetail(selected):await backend(connection,'/rest/v1/rpc/admin_participant_detail',{body:{p_participant:selected,p_offset:mealOffset,p_limit:pageSize}});
 releasePhotos();
 const box=$('participant-detail');box.replaceChildren();box.append(el('span','eyebrow','PARTICIPANT TIMELINE'),el('h2','', '用户记录详情'),el('p','detail-id',data.participant.id),el('p','small',`加入时间：${date(data.participant.created_at)} · ${data.participant.account_linked?'账户已关联':'账户已解除关联'}`));
 box.append(jsonBlock(`习惯历史（${data.profiles.length}）`,data.profiles),jsonBlock(`研究同意 / 撤回（${data.consents.length}）`,data.consents));
 box.append(el('h3','', '餐食时间线'));mealTotal=data.meal_total;
 if(!data.meals.length)box.append(el('p','subtle','尚无餐食记录。'));
 for(const meal of data.meals){const article=el('article','timeline-meal');article.append(el('h3','',mealNames[meal.meal_type]||'餐食'),el('p','small',`用餐：${date(meal.eaten_at)} · 原时区 ${meal.timezone}`),el('p','small',`提交：${date(meal.created_at)} · 照片 ${meal.photo_count} 张`));
 article.append(photoPanel(meal));
 const table=el('table','comparison');const head=el('thead');const h=el('tr');['尝试','P / F / C（g）','T（kcal）'].forEach(t=>{const th=el('th','',t);th.scope='col';h.append(th);});head.append(h);table.append(head);const body=el('tbody');
 meal.guesses.forEach((g,i)=>{const tr=el('tr');tr.append(el('td','',`${i+1}${i===0?' · 首次':''}`),el('td','',`${g.protein_g} / ${g.fat_g} / ${g.carbs_g}`),el('td','',g.calories_kcal));body.append(tr);});table.append(body);article.append(table);
 if(!meal.guesses.length)article.append(el('p','small','尚无猜测记录。'));
 article.append(el('p','small',`份量确认 ${meal.confirmations.length} 次 · 持久化参考估算 ${meal.estimates.length} 条 · 反馈 ${meal.feedback.length} 条`));
 article.append(jsonBlock('查看原始猜测与提交时间',meal.guesses),jsonBlock('查看食物 ID / 份量确认历史',meal.confirmations));
 if(meal.estimates.length)article.append(jsonBlock('查看已保存的参考估算',meal.estimates));if(meal.feedback.length)article.append(jsonBlock('查看已保存的反馈',meal.feedback));box.append(article);}
 const pager=el('div','pagination');pager.append(el('span','',`${mealTotal?mealOffset+1:0}–${Math.min(mealOffset+pageSize,mealTotal)} / ${mealTotal} 餐`));const buttons=el('div');for(const [id,text,delta] of [['meals-prev','上一页',-pageSize],['meals-next','下一页',pageSize]]){const b=el('button','quiet',text);b.id=id;b.addEventListener('click',()=>action(async()=>{mealOffset+=delta;await detail();}));buttons.append(b);}pager.append(buttons);box.append(pager);controls();
}
$('admin-filter').addEventListener('submit',e=>{e.preventDefault();action(async()=>{offset=0;await list();notice('筛选已更新。');});});
$('admin-refresh').addEventListener('click',()=>action(async()=>{await overview();await list();if(selected)await detail();notice('数据已刷新。');}));
$('participants-prev').addEventListener('click',()=>action(async()=>{offset=Math.max(0,offset-pageSize);await list();}));
$('participants-next').addEventListener('click',()=>action(async()=>{offset+=pageSize;await list();}));
$('admin-logout').addEventListener('click',()=>action(async()=>{releasePhotos();try{await signOut(connection);}finally{location.href='login.html?portal=admin';}}));
$('photo-dialog-close').addEventListener('click',closePhoto);
$('photo-dialog').addEventListener('close',()=>{$('photo-dialog-image').removeAttribute('src');});
$('photo-dialog').addEventListener('click',event=>{if(event.target===$('photo-dialog'))closePhoto();});
window.addEventListener('pagehide',releasePhotos);
await action(async()=>{
 if(!connection || (connection.mode==='demo'&&connection.portal!=='admin')){location.replace('login.html?portal=admin');return;}
 if(connection.mode==='live'&&await backend(connection,'/rest/v1/rpc/is_admin',{body:{}})!==true){blocked('当前账户没有管理员权限，请联系项目负责人。');return;}
 $('admin-mode').textContent=connection.mode==='demo'?'演示 · 全部为合成样本':'管理员 · 只读研究数据';
 await overview();await list();notice(connection.mode==='demo'?'演示模式：以下为合成样本，不是你的真实用户数据。':'管理员身份已验证。用户数据通过受限接口读取。');
});
