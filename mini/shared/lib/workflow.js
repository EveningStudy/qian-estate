const labels = { pending:'待审核', accepted:'已受理', rejected:'已拒绝', confirmed:'已确认', completed:'已完成', cancelled:'已取消', active:'有效', contacted:'已联系', converted:'已转化', archived:'已归档', approved:'已批准（不触发开锁）', revoked:'已撤销', sent:'已发送', read:'已读', unread:'未读', published:'在售', sold:'已售', open:'待处理', resolved:'已解决', in_progress:'处理中', answered:'已答复', recorded:'已记录', disabled:'已停用' };
const actionLabels = { accepted:'受理', rejected:'拒绝', confirmed:'确认预约', completed:'完成', cancelled:'取消', contacted:'标记已联系', converted:'标记已转化', archived:'归档', active:'恢复', approved:'批准申请（不开锁）', revoked:'撤销批准', read:'标记已读', pending:'提交审核' };
function allowed(collection, r, user) {
  if (!user) return [];
  const own = r.ownerId === user.id; const assigned = user.role === 'agent' && r.agentId === user.id;
  let transitions = {};
  if (collection === 'commissions') {
    if (assigned) transitions = { pending:['accepted','rejected'], accepted:['completed','cancelled'] };
    if (own) transitions = { pending:['cancelled'], accepted:['cancelled'] };
  }
  if (collection === 'appointments') {
    if (assigned) transitions = { pending:['confirmed','rejected'], confirmed:['completed','cancelled'] };
    if (own) transitions = { pending:['cancelled'], confirmed:['cancelled'] };
  }
  if (collection === 'collaborations') {
    if (r.targetAgentId === user.id) transitions = { pending:['accepted','rejected'], accepted:['completed','cancelled'] };
    if (r.agentId === user.id) transitions = { pending:['cancelled'], accepted:['cancelled'] };
  }
  if (collection === 'clients' && assigned) transitions = { active:['contacted','archived'], contacted:['converted','archived'], converted:['archived'], archived:['active'] };
  if (collection === 'lockRequests') {
    if (own && r.requesterId !== user.id) transitions = { pending:['approved','rejected'], approved:['revoked'] };
    if (r.requesterId === user.id) transitions = { pending:['cancelled'] };
  }
  if (collection === 'properties' && own) transitions = { rejected:['pending'], published:['pending'] };
  if (collection === 'messages' && r.recipientId === user.id) transitions = { sent:['read'] };
  if (collection === 'notifications' && r.userId === user.id) transitions = { unread:['read'] };
  return transitions[r.status] || [];
}
function contacts(snapshot) {
  const map = new Map((snapshot.agents || []).map(a => [a.id, { id:a.id, name:a.name || '经纪人' }]));
  for (const r of [...(snapshot.commissions || []), ...(snapshot.appointments || [])]) {
    if (r.ownerId) map.set(r.ownerId, { id:r.ownerId, name:r.contactName || '业务联系人' });
  }
  for (const r of snapshot.messages || []) for (const side of ['sender','recipient']) {
    const id = r[side + 'Id'];
    if (id && (!map.has(id) || r[side + 'Name'])) map.set(id, { id, name:r[side + 'Name'] || '会话联系人' });
  }
  map.delete(snapshot.user.id);
  return Array.from(map.values());
}
function records(collection, snapshot) {
  return (snapshot[collection] || []).map(r => {
    const property = (snapshot.properties || []).find(p => p.id === r.propertyId);
    return { ...r, titleLabel:r.title || r.name || (property && (property.community || property.title)) || '业务记录', statusLabel:labels[r.status] || '状态待确认',
      actions:allowed(collection, r, snapshot.user).map(status => ({ status, label:actionLabels[status] || '更新状态' })) };
  });
}
module.exports = { allowed, records, contacts, labels, actionLabels };
