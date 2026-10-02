import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const compiler=process.env.WXML_COMPILER || 'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
if(!existsSync(compiler)) throw new Error('未找到微信官方编译器，请安装微信开发者工具或设置 WXML_COMPILER。');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):e.name.endsWith('.wxml')?[resolve(dir,e.name)]:[]);
mkdirSync(resolve(root,'work/compiler'),{recursive:true});
for(const name of ['mini/shared','dist/mini-owner','dist/mini-agent']) {
 const cwd=resolve(root,name); const files=walk(cwd).map(p=>relative(cwd,p).replaceAll('\\','/'));
 if(!files.length) throw new Error('没有模板：'+name);
 const result=spawnSync(compiler,['-o',resolve(root,'work/compiler',name.replaceAll('/','-')+'.js'),...files],{cwd,encoding:'utf8'});
 if(result.status!==0) throw new Error(name+' 编译失败\n'+(result.stderr||result.stdout||result.error));
 console.log('微信官方模板编译通过：'+name+'，'+files.length+'个模板');
 const styleCompiler=resolve(compiler,'..','wcsc.exe');
 if(!existsSync(styleCompiler)) throw new Error('未找到微信样式编译器。');
 const style=spawnSync(styleCompiler,['-o',resolve(root,'work/compiler',name.replaceAll('/','-')+'-style.js'),'app.wxss'],{cwd,encoding:'utf8'});
 if(style.status!==0) throw new Error(name+' 样式编译失败\n'+style.stderr);
 console.log('微信官方样式编译通过：'+name);
}
