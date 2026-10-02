const test=require('node:test');const assert=require('node:assert/strict');const {harness}=require('./harness.cjs');
test('未确认写入复用幂等键，确认后下一次操作使用新键',async()=>{
 const h=harness({mode:'demo'});h.authenticate();const api=h.load('lib/api');const keys=[];let fail=true;
 h.wx.request=o=>{keys.push(o.header['Idempotency-Key']);if(fail)o.fail({errMsg:'超时'});else o.success({statusCode:201,data:{id:'saved'}});};
 await assert.rejects(api.request('/api/commissions','POST',{community:'测试'}),/未确认/);
 fail=false;await api.request('/api/commissions','POST',{community:'测试'});
 assert.equal(keys[0],keys[1]);assert.ok(keys[0]);
 await api.request('/api/commissions','POST',{community:'测试'});assert.notEqual(keys[1],keys[2]);
});
