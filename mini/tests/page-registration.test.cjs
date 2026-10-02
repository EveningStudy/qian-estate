const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./harness.cjs');
test('每个入口直接调用微信Page注册，共享模块只构造配置',()=>{
 const h=harness();const config=h.load('lib/page').define({data:{test:1}});assert.equal(config.data.test,1);assert.equal(typeof config.onShow,'function');
 for(const name of fs.readdirSync(path.join(__dirname,'../shared/pages'))){const source=fs.readFileSync(path.join(__dirname,'../shared/pages',name,'index.js'),'utf8');assert.match(source,/Page\(define\(/,name);}
});
test('无效导航不会静默失败，连续点击不会叠加页面栈',()=>{
 const h=harness({role:'owner'});const {go}=h.load('lib/page');go('missing');assert.equal(h.calls[0].toast.title,'页面入口无效');go('form',{collection:'commissions'});go('form',{collection:'commissions'});assert.equal(h.calls.filter(r=>r.url).length,1);
});
