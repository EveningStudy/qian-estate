const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');
test('业主委托为子页，经纪人工作台仍为底部页',()=>{
 const owner=harness({role:'owner'});owner.load('lib/page').go('workspace');assert.equal(owner.calls[0].url,'/pages/workspace/index');
 const agent=harness({role:'agent'});let method='';agent.wx.switchTab=o=>{method='switchTab';agent.calls.push(o);};agent.load('lib/page').go('workspace');assert.equal(method,'switchTab');
});
test('个人中心收起长列表，只有已知区域可以展开',()=>{
 const p=harness().page('profile');p.toggleSection({currentTarget:{dataset:{section:'showFavorites'}}});assert.equal(p.data.showFavorites,true);p.toggleSection({currentTarget:{dataset:{section:'showFavorites'}}});assert.equal(p.data.showFavorites,false);p.toggleSection({currentTarget:{dataset:{section:'role'}}});assert.equal(p.data.role,'');
});
