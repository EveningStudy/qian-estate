const field = (key, label, type = 'text', required = false) => ({ key, label, type, required });
const property = field('propertyId', '房源', 'property', true);
const note = field('note', '备注', 'textarea');
const phone = field('phone', '联系电话');
const schemas = {
  'agent-applications': { title:'经纪人入驻申请', fields:[field('name','姓名','text',true),field('company','公司','text',true),field('licenseNumber','执业证号','text',true),field('city','城市','text',true),field('phone','手机号','text',true)] },
  commissions: { title: '出售委托 / 电话回访', fields: [field('propertyId', '已有房源（或填写下方房屋信息）', 'property'), field('community', '小区'), field('city', '城市'), field('area', '面积（㎡）', 'number'), field('price', '期望总价（万元）', 'number'), field('contactName', '联系人', 'text', true), phone, note] },
  appointments: { title: '预约看房', fields: [property, field('date', '看房日期', 'date', true), field('time', '看房时间（设备当地时间）', 'time', true), field('contactName', '联系人', 'text', true), phone, note] },
  collaborations: { title: '发起联卖', fields: [property, field('targetAgentId', '合作经纪人', 'agent'), note] },
  clients: { title: '添加客户', fields: [field('name', '客户姓名', 'text', true), phone, field('budget', '预算（万元）', 'number'), field('preference', '购房偏好', 'textarea'), note] },
  feedback: { title: '意见反馈', fields: [field('content', '反馈内容', 'textarea', true), field('category', '分类'), field('contact', '回复联系方式')] },
  lockRequests: { title: '门锁授权申请（仅流程）', fields: [property, field('reason', '申请原因', 'textarea', true)] },
  questions: { title: '提出问题', fields: [field('question', '您的问题', 'textarea', true), field('propertyId', '关联房源', 'property'), field('category', '分类')] },
  properties: { title: '发布房源资料', fields: [field('title', '标题', 'text', true), field('community', '小区', 'text', true), field('city', '城市', 'text', true), field('district', '行政区', 'text', true), field('address', '地址', 'text', true), field('price', '总价（万元）', 'number', true), field('area', '面积（㎡）', 'number', true), field('rooms', '户型', 'text', true), field('floor', '楼层'), field('orientation', '朝向'), field('decoration', '装修'), field('description', '描述', 'textarea')] },
  valuation: { title: '房屋估值', fields: [field('city', '城市', 'text', true), field('community', '小区', 'text', true), field('area', '面积（㎡）', 'number', true)] },
  profile: { title: '编辑个人资料', fields: [field('name', '姓名', 'text', true), phone, field('city', '城市'), field('bio', '个人介绍', 'textarea')] },
  messages: { title: '发送消息', fields: [field('recipientId', '收件人', 'contact', true), field('propertyId', '关联房源', 'property'), field('content', '消息', 'textarea', true)] }
};
function payload(schema, values) {
  const out = {};
  for (const f of schema.fields) {
    const value = String(values[f.key] == null ? '' : values[f.key]).trim();
    if (f.required && !value) throw new Error('请填写' + f.label);
    if (!value) continue;
    if (f.type === 'number') { const n = Number(value); if (!Number.isFinite(n) || n <= 0 || n > 1000000) throw new Error(f.label + '须为 0 到 1,000,000 之间的数值'); out[f.key] = n; }
    else out[f.key] = value;
  }
  if (out.date || out.time) {
    const stamp = new Date(out.date + 'T' + out.time + ':00');
    if (!Number.isFinite(stamp.getTime()) || stamp.getTime() <= Date.now()) throw new Error('请选择未来的有效看房时间');
    out.scheduledAt = stamp.toISOString(); delete out.date; delete out.time;
  }
  return out;
}
module.exports = { schemas, payload };
