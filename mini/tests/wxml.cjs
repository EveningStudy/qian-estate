const vm = require('node:vm');
// 引号感知的词法扫描，不能把属性中的 > 或模板比较运算符误当标签结尾。
function parse(source,file='模板') {
 for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) if (/&(?:amp|lt|gt);/.test(match[1])) throw new Error(file+' 表达式内不能使用 HTML 实体，请直接使用逻辑或比较运算符');
 const stack=[];const tags=[];let i=0;
 while(i<source.length) {
  if(source.startsWith('<!--',i)){const end=source.indexOf('-->',i+4);if(end<0)throw new Error(file+' 注释未闭合');i=end+3;continue;}
  if(source.startsWith('{{',i)){const end=source.indexOf('}}',i+2);if(end<0)throw new Error(file+' 表达式未闭合');i=end+2;continue;}
  if(source[i]!=='<'){i++;continue;}
  const start=i++;let quote='';for(;i<source.length;i++){const ch=source[i];if(quote){if(ch===quote)quote='';}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}
  if(i===source.length)throw new Error(file+' 标签未闭合');const token=source.slice(start,++i);const match=/^<(\/)?([\w:-]+)([\s\S]*?)>$/.exec(token);if(!match)throw new Error(file+' 非法标签 '+token);
  const [,close,name,tail]=match;
  if(close){if(stack.pop()!==name)throw new Error(file+' 标签嵌套不匹配 '+name);continue;}
  const attrs={};const text=tail.replace(/\/\s*$/,'');const regex=/\s+([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/gy;let pos=0;
  while(pos<text.length){if(!text.slice(pos).trim())break;regex.lastIndex=pos;const attr=regex.exec(text);if(!attr)throw new Error(file+' 属性语法错误 '+text.slice(pos));attrs[attr[1]]=attr[2]?attr[2].slice(1,-1):true;pos=regex.lastIndex;}
  tags.push({name,attrs});if(!/\/\s*>$/.test(token))stack.push(name);
 }
 if(stack.length)throw new Error(file+' 标签未闭合 '+stack.join('/'));return tags;
}
function syntax(source,file){new vm.Script(source,{filename:file});}
module.exports={parse,syntax};
