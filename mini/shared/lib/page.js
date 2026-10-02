const api = require('./api');
const config = require('../config');
const tabs = config.role === 'owner' ? ['home', 'listings', 'messages', 'profile'] : ['home', 'listings', 'workspace', 'messages', 'profile'];
const pageNames = ['home','listings','workspace','messages','profile','detail','form','feed','cards'];
let navigationAt = 0;
let navigationTarget = '';
function go(page, params = {}) {
  if (!pageNames.includes(page)) { wx.showToast({title:'页面入口无效',icon:'none'}); return; }
  const target = JSON.stringify([page,params]);
  if (target === navigationTarget && Date.now() - navigationAt < 600) return;
  navigationAt = Date.now();
  navigationTarget = target;
  const query = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const url = '/pages/' + page + '/index' + (query ? '?' + query : '');
  const fail = () => { navigationAt=0; wx.showToast({ title: '页面打开失败，请返回后重试', icon:'none', duration:2500 }); };
  if (tabs.includes(page)) wx.switchTab({ url: '/pages/' + page + '/index', fail }); else wx.navigateTo({ url, fail });
}
function define(extra) {
  // 工厂只返回配置；每个页面入口显式调用 Page，避免注册依赖共享模块加载上下文。
  return Object.assign({
    data: { role: config.role, brand: config.name, loading: false, busy: false, error: '', ready: false },
    onLoad(options) { this.options = options || {}; },
    onShow() { this.refresh(); },
    onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
    async refresh() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: '' });
      try { const snapshot = await api.bootstrap(); this.snapshot = snapshot; this.setData({ user: snapshot.user, role: snapshot.user.role, ready: true }); if (this.render) await this.render(snapshot); }
      catch (err) {
        this.setData({ error: err.message, ready:false });
        if (!api.signedIn()) {
          this.snapshot = null;
          this.setData({ error:'',user:null,role:'',loggedIn:false,profile:null,property:null,items:[],groups:[],favorites:[],own:[],agents:[],applications:[],values:{},images:[] });
        }
      }
      finally { this.setData({ loading: false }); }
    },
    async mutate(action) {
      if (this.data.busy || this.data.loading) return;
      this.setData({ busy: true, error: '' });
      try { await action(); wx.showToast({ title: '服务器已保存', icon: 'success' }); await this.refresh(); }
      catch (err) { this.setData({ error: err.message }); }
      finally { this.setData({ busy: false }); }
    },
    nav(e) { const { page, collection, id, propertyId, agentId, source, to } = e.currentTarget.dataset; go(page, { collection, id, propertyId, agentId, source, to }); },
    async call(e) {
      const phone = e.currentTarget.dataset.phone;
      if (!phone || !/^\+?[\d -]{5,20}$/.test(String(phone))) { this.setData({ error: '服务器未提供有效可拨打电话' }); return; }
      wx.showModal({ title: '确认拨打电话', content: String(phone) + '（请核实号码）', success: result => { if (result.confirm) wx.makePhoneCall({ phoneNumber: String(phone), fail: err => this.setData({ error: err.errMsg }) }); } });
    }
  }, extra, { data: Object.assign({ role: '', appRole: config.role, mode: config.mode, brand: config.name, loading: false, busy: false, error: '', ready: false }, extra.data || {}) });
}
module.exports = { define, go };
