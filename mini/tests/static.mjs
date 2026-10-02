import { readFile,readdir } from 'node:fs/promises';import { resolve,dirname,relative } from 'node:path';import { createRequire } from 'node:module';import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);const {parse,syntax}=require('./wxml.cjs');const {harness}=require('./harness.cjs');
const root=fileURLToPath(new URL('../..',import.meta.url));let count=0;
async function walk(dir){const output=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())output.push(...await walk(path));else output.push(path);}return output;}
for(const role of ['owner','agent']){
 const dir=resolve(root,'dist/mini-'+role);const app=JSON.parse(await readFile(resolve(dir,'app.json'),'utf8'));JSON.parse(await readFile(resolve(dir,'project.config.json'),'utf8'));
 for(const item of app.tabBar.list){if(!app.pages.includes(item.pagePath))throw new Error('导航目标不存在');for(const key of ['iconPath','selectedIconPath']){const bytes=await readFile(resolve(dir,item[key]));if(bytes.length>40960||bytes[0]!==137)throw new Error('导航PNG图标无效');}}
 for(const file of await walk(dir)){
  const source=await readFile(file,'utf8');if(file.endsWith('.js'))syntax(source,file);if(file.endsWith('.json'))JSON.parse(source);
  if(!file.endsWith('.wxml'))continue;const tags=parse(source,file);count++;
  for(const tag of tags){if(['import','include'].includes(tag.name))await readFile(resolve(dirname(file),tag.attrs.src));const target=tag.attrs['data-page'];if(target&&!target.includes('{{')&&!app.pages.includes('pages/'+target+'/index'))throw new Error('页面链接不存在 '+target);}
 }
 for(const page of app.pages){await readFile(resolve(dir,page+'.json'));const h=harness({role});const instance=h.page(page.split('/')[1],{collection:'feedback'});const files=[resolve(dir,page+'.wxml'),resolve(dir,'templates/common.wxml')];for(const file of files)for(const tag of parse(await readFile(file,'utf8'),relative(dir,file)))for(const [key,value] of Object.entries(tag.attrs))if(/^(bind|catch)/.test(key)&&typeof value==='string'&&!value.includes('{{')&&typeof instance[value]!=='function')throw new Error(page+' 缺少事件处理器 '+value);}
}
console.log('原生静态验证通过：双端页面配置、JS语法、WXML结构、事件处理器与导航；模板数 '+count);
