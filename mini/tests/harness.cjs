const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// 独立执行真实小程序 CommonJS 源码，不复制生产逻辑。
function harness(config = {}) {
  const root = path.resolve(__dirname,'../shared'); const cache = new Map(); const storage = new Map(); const calls = []; const app = {globalData:{}}; let definition;
  const wx = {
    getStorageSync:key => storage.get(key),setStorageSync:(key,value) => storage.set(key,value),removeStorageSync:key => storage.delete(key),
    request:options => { calls.push(options); options.success({statusCode:200,data:{}}); },
    requirePrivacyAuthorize:options => options.success({}),login:options => options.success({code:'微信凭证'}),
    showToast:options => calls.push({toast:options}),showModal:options => options.success && options.success({confirm:true}),
    switchTab:options => calls.push(options),navigateTo:options => calls.push(options),reLaunch:options => calls.push(options),stopPullDownRefresh() {},
  };
  function load(file) {
    const absolute = path.resolve(root,file.endsWith('.js') ? file : file + '.js');
    if (absolute === path.join(root,'config.js')) return {mode:'production',role:'owner',name:'栖岸',baseURL:'https://test.invalid',...config};
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = {exports:{}}; cache.set(absolute,module);
    const context = vm.createContext({module,exports:module.exports,require:relative => load(path.resolve(path.dirname(absolute),relative)),wx,Page:value => {definition=value;},getApp:() => app,Uint8Array,ArrayBuffer,Date,console});
    new vm.Script(fs.readFileSync(absolute,'utf8'),{filename:absolute}).runInContext(context);
    return module.exports;
  }
  function page(name,options = {}) {
    load('pages/' + name + '/index'); const result = {...definition,data:structuredClone(definition.data)};
    result.setData = data => { for (const [key,value] of Object.entries(data)) { const parts=key.split('.'); let target=result.data; for (const part of parts.slice(0,-1)) target=target[part] ||= {}; target[parts.at(-1)]=value; } };
    if (result.onLoad) result.onLoad(options); return result;
  }
  return {load,page,wx,storage,calls,app,authenticate() { storage.set('qian.token.'+(config.mode || 'production')+'.'+(config.role || 'owner'),'token'); }};
}
module.exports = {harness};
