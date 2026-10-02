const { define } = require('../../lib/page');
const api = require('../../lib/api');
const { properties, detailFields } = require('../../lib/model');
Page(define({
  async render(s) {
    this.setData({ property: null });
    if (!this.options.id) throw new Error('缺少房源编号');
    const result = await api.property(this.options.id);
    if (!result || result.id !== this.options.id) throw new Error('房源详情响应缺少正确的编号');
    const p = properties([result])[0];
    const agent = (s.agents || []).find(a => a.id === p.agentId) || {};
    this.setData({ property: p, gallery: (p.images || []).map(api.asset), agent,
      favorite: (s.favorites || []).some(f => (typeof f === 'string' ? f : f.propertyId) === p.id),
      transactions: (s.transactions || []).filter(t => t.propertyId === p.id), transactionFields: detailFields(p),
      canBook: s.user.role === 'owner' && p.status === 'published',
      canEdit: s.user.role === 'owner' && p.ownerId === s.user.id && p.status !== 'sold',
      canCollaborate: s.user.role === 'agent' && p.status === 'published' && p.agentId !== s.user.id,
      canRequestLock: p.ownerId === s.user.id || p.agentId === s.user.id,
      canChat: !!agent.id && agent.id !== s.user.id });
  },
  favorite() { if (this.data.property) return this.mutate(() => api.request('/api/favorites/' + encodeURIComponent(this.data.property.id), 'POST', {})); },
  preview(e) { wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.gallery, fail: err => this.setData({ error: err.errMsg }) }); },
  onShareAppMessage() { const p = this.data.property; return { title: p ? p.title + ' · 演示房源' : '栖岸 · 演示房源', path: '/pages/detail/index?id=' + encodeURIComponent(p ? p.id : '') }; }
}));
