import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {createApp} from '../src/app.js';
const {harness}=createRequire(import.meta.url)('../../mini/tests/harness.cjs');
test('真实原生页面连接真实服务端：登录、委托、受理、消息和资料保存',async()=>{
 const app=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const baseURL=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const make=(role:string)=>{
  const h=harness({mode:'demo',role,baseURL});
  h.wx.request=async(o:any)=>{try{const r=await fetch(o.url,{method:o.method,headers:o.header,body:o.method==='GET'?undefined:JSON.stringify(o.data)});o.success({statusCode:r.status,data:await r.json()});}catch(e){o.fail({errMsg:String(e)});}};
  return h;
 };
 try{
  const owner=make('owner'),agent=make('agent');const oa=owner.load('lib/api'),aa=agent.load('lib/api');
  await oa.login();await aa.login();
  const form=owner.page('form',{collection:'commissions'});await form.refresh();
  form.setData({values:{community:'集成测试小区',area:'89',price:'320',contactName:'测试业主'}});
  await form.submit();assert.equal(form.data.saved,true,form.data.error);
  let data=await aa.bootstrap();const item=data.commissions.find((c:any)=>c.community==='集成测试小区');assert.ok(item);
  await aa.request('/api/commissions/'+item.id,'PATCH',{status:'accepted'});
  assert.equal((await oa.bootstrap()).commissions.find((c:any)=>c.id===item.id).status,'accepted');
  const message=owner.page('form',{collection:'messages',to:'agent-demo'});await message.refresh();message.setData({'values.content':'集成测试沟通'});await message.submit();assert.equal(message.data.saved,true,message.data.error);
  assert.ok((await aa.bootstrap()).messages.some((m:any)=>m.content==='集成测试沟通'));
  const profile=owner.page('form',{collection:'profile'});await profile.refresh();profile.setData({'values.name':'测试资料'});await profile.submit();assert.equal(profile.data.saved,true,profile.data.error);
  assert.equal((await oa.bootstrap()).user.name,'测试资料');
  await oa.logout();await assert.rejects(oa.bootstrap(),/登录/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));app.locals.close();}
});
