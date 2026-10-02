const { define } = require('../../lib/page');
const { contacts,labels } = require('../../lib/workflow');
const api = require('../../lib/api');
Page(define({ render(s) {
  const people=contacts(s); const name=id=>id===s.user.id?'我':(people.find(p=>p.id===id)||{}).name || '会话联系人';
  this.setData({items:(s.messages || []).map(item=>({...item,senderName:name(item.senderId),recipientName:name(item.recipientId),replyTo:item.senderId===s.user.id?item.recipientId:item.senderId,statusLabel:labels[item.status] || '状态待确认',canRead:item.recipientId===s.user.id&&item.status==='sent'}))});
}, read(e) { return this.mutate(()=>api.request('/api/messages/'+encodeURIComponent(e.currentTarget.dataset.id),'PATCH',{status:'read'})); } }));
