import test from 'node:test';
import assert from 'node:assert/strict';
import { createWechat } from '../src/wechat.js';
import { createApp } from '../src/app.js';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const env = { WECHAT_OWNER_APPID: 'wx0000000000000001', WECHAT_OWNER_SECRET: 'secret-1', WECHAT_AGENT_APPID: 'wx0000000000000002', WECHAT_AGENT_SECRET: 'secret-2' };
test('微信真实协议：双应用隔离、凭证缓存、手机号水印、密钥不外泄', async () => {
  let tokenCalls = 0;
  const provider = createWechat(env, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('jscode2session')) {
      assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
      return Response.json({ openid: 'same-open-id', session_key: 'never-leak' });
    }
    if (url.pathname.includes('stable_token')) { tokenCalls++; return Response.json({ access_token: JSON.parse(String(init?.body)).appid, expires_in: 7200 }); }
    assert.equal(JSON.parse(String(init?.body)).code, 'phone-code');
    return Response.json({ phone_info: { purePhoneNumber: '13800000000', countryCode: '86', watermark: { appid: url.searchParams.get('access_token') } } });
  });
  assert.deepEqual(await provider.login('owner', 'test-code'), { openid: 'same-open-id' });
  assert.equal(await provider.phone('owner', 'phone-code'), '13800000000');
  await provider.phone('owner', 'phone-code');
  await provider.phone('agent', 'phone-code');
  assert.equal(tokenCalls, 2);
});
test('未配置、微信拒绝和手机号水印不一致均失败，不回传凭据', async () => {
  await assert.rejects(createWechat({}).login('owner', 'code'), /尚未配置/);
  await assert.rejects(createWechat(env, async () => Response.json({ errcode: 40029, errmsg: 'secret-1' })).login('owner', 'code'), error => !String(error).includes('secret-1') && String(error).includes('40029'));
  const provider = createWechat(env, async input => String(input).includes('stable_token') ? Response.json({ access_token: 'token', expires_in: 7200 }) : Response.json({ phone_info: { purePhoneNumber: '13800000000', countryCode: 86, watermark: { appid: 'wrong' } } }));
  await assert.rejects(provider.phone('owner', 'code'), /当前应用/);
});
test('微信身份登录、手机号绑定、入驻审核和后台一次性配对形成闭环', async () => {
  const provider = createWechat(env, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('jscode2session')) return Response.json({ openid: url.searchParams.get('js_code'), session_key: 'secret' });
    if (url.pathname.includes('stable_token')) return Response.json({ access_token: JSON.parse(String(init?.body)).appid, expires_in: 7200 });
    return Response.json({ phone_info: { purePhoneNumber: '13800000000', countryCode: '86', watermark: { appid: url.searchParams.get('access_token') } } });
  });
  const app = createApp(':memory:', { wechat: provider }); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function call(path: string, body?: unknown, token?: string, method = 'POST') { const r = await fetch(base + path, { method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
  try {
    const first = await call('/auth/wechat/login', { app:'agent', code:'new-user', privacyVersion:'2026-09-09' });
    assert.equal(first.status, 200); assert.equal(first.data.user.role, 'owner'); assert.ok(!JSON.stringify(first.data).includes('session_key'));
    assert.equal((await call('/auth/wechat/login', { app:'agent', code:'new-user', role:'admin', privacyVersion:'v1' })).status, 400);
    const second = await call('/auth/wechat/login', { app:'agent', code:'new-user', privacyVersion:'2026-09-09' });
    assert.equal(first.data.user.id, second.data.user.id);
    const otherApp = await call('/auth/wechat/login', { app:'owner', code:'new-user', privacyVersion:'2026-09-09' });
    assert.notEqual(otherApp.data.user.id, first.data.user.id);
    const phone = await call('/auth/wechat/phone', { code:'phone-code' }, first.data.token);
    assert.equal(phone.data.user.phone, '138****0000');
    const application = await call('/agent-applications', {name:'测试经纪人',company:'测试机构',licenseNumber:'测试备案',city:'杭州',phone:'13800000000'},first.data.token);
    assert.equal(application.status,201);
    const reviewer = await call('/auth/demo',{role:'admin'});
    assert.equal((await call('/agent-applications/'+application.data.id,{status:'approved',note:'已线下核实资质'},reviewer.data.token,'PATCH')).status,200);
    assert.equal((await call('/auth/me',undefined,first.data.token,'GET')).data.user.role,'agent');
    const row=app.locals.db.prepare('SELECT data FROM users WHERE id=?').get(first.data.user.id);
    app.locals.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),role:'admin'}),first.data.user.id);
    const pair=await call('/admin/pairing',{},first.data.token); assert.equal(pair.status,200);
    assert.equal((await call('/auth/admin/pair',{code:pair.data.code})).status,200);
    assert.equal((await call('/auth/admin/pair',{code:pair.data.code})).status,401);
    assert.equal((await call('/auth/logout',{},first.data.token)).status,200);
    assert.equal((await call('/auth/me',undefined,first.data.token,'GET')).status,401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); app.locals.close(); }
});
test('生产数据库不注入演示账号与房源', () => {
  const old=process.env.NODE_ENV; process.env.NODE_ENV='production';
  try { const app=createApp(':memory:'); assert.equal(app.locals.db.prepare('SELECT count(*) AS n FROM users').get().n,0); assert.equal(app.locals.db.prepare('SELECT count(*) AS n FROM records').get().n,0); app.locals.close(); }
  finally { if(old===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=old; }
});
