const { define } = require('../../lib/page');
const api = require('../../lib/api');
const { records, allowed, actionLabels } = require('../../lib/workflow');
Page(define({
  render(s) { this.setData({ groups: [['commissions','出售委托'],['appointments','看房预约'],['collaborations','联卖合作'],['clients','客户跟进'],['lockRequests','门锁授权申请']].map(([collection,title]) => ({ collection,title,items:records(collection,s) })) }); },
  change(e) {
    const { collection,id,status } = e.currentTarget.dataset;
    const row = (this.snapshot[collection] || []).find(r => r.id === id);
    if (!row || !allowed(collection,row,this.snapshot.user).includes(status)) return this.setData({ error:'当前身份或状态不允许此操作，请刷新' });
    wx.showModal({ title:'确认' + actionLabels[status], content:collection === 'lockRequests' ? '仅更新授权审核状态，不触发任何真实开锁。' : '操作将保存至服务器。', success: result => { if (result.confirm) this.mutate(() => api.request('/api/' + collection + '/' + encodeURIComponent(id),'PATCH',{ status })); } });
  }
}));
