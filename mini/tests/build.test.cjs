const test=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const path=require('node:path');
test('生产缺少AppID拒绝构建，HTTP及未知模式不降级演示',()=>{
 const root=path.resolve(__dirname,'../..');const base={...process.env,MINI_MODE:'production',WECHAT_OWNER_APPID:'',WECHAT_AGENT_APPID:'',MINI_API_BASE_URL:'https://example.com'};
 const run=env=>spawnSync(process.execPath,['scripts/build-mini.mjs'],{cwd:root,env,encoding:'utf8'});
 assert.notEqual(run(base).status,0);assert.match(run(base).stderr,/WECHAT_OWNER_APPID/);
 assert.match(run({...base,MINI_API_BASE_URL:'http://localhost:4310'}).stderr,/HTTPS/);
 assert.match(run({...base,MINI_MODE:'unknown'}).stderr,/MINI_MODE/);
 assert.match(run({...base,MINI_API_BASE_URL:'https://api.example.invalid'}).stderr,/invalid/);
 assert.match(run({...base,PRIVACY_VERSION:'x'.repeat(101)}).stderr,/PRIVACY_VERSION/);
});
