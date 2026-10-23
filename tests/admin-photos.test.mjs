import test from 'node:test';
import assert from 'node:assert/strict';
import {adminPhotoPath,downloadAdminPhoto} from '../web/admin-photos.mjs';

const photo={participant_id:'participant-a',meal_id:'meal-a',storage_path:'participant-a/meal-a/photo one.png'};
const connection={url:'https://project.example',key:'public-test',session:{access:'access-test'}};
test('photo paths must match the participant and meal; path traversal is rejected',()=>{
 assert.equal(adminPhotoPath(photo),'/storage/v1/object/authenticated/meal-photos/participant-a/meal-a/photo%20one.png');
 for(const path of ['other/meal-a/a.png','participant-a/other/a.png','participant-a/meal-a/../a.png','participant-a/meal-a//a.png'])assert.throws(()=>adminPhotoPath({...photo,storage_path:path}));
});
test('photo download requires admin authorization before fetching; no token is added to the URL',async()=>{
 let requestCount=0;
 await assert.rejects(downloadAdminPhoto(connection,photo,{authorize:async()=>false,request:async()=>{requestCount++;}}),/管理员权限/);
 assert.equal(requestCount,0);
 let args;
 const url=await downloadAdminPhoto(connection,photo,{authorize:async()=>true,request:async(...input)=>{args=input;return new Response(new Blob(['synthetic fixture'],{type:'image/png'}));},createUrl:()=> 'blob:test-preview'});
 assert.equal(url,'blob:test-preview');assert.equal(args[1].cache,'no-store');assert.equal(args[1].headers.Authorization,'Bearer access-test');assert.ok(!args[0].includes('access-test'));
});
test('missing files and non-images never become a preview URL',async()=>{
 let created=0;const dependencies={authorize:async()=>true,createUrl:()=>{created++;}};
 await assert.rejects(downloadAdminPhoto(connection,photo,{...dependencies,request:async()=>new Response('',{status:404})}),/无法读取/);
 await assert.rejects(downloadAdminPhoto(connection,photo,{...dependencies,request:async()=>new Response('text',{headers:{'Content-Type':'text/plain'}})}),/图片格式/);
 assert.equal(created,0);
});
