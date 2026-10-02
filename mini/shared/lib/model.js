const { asset } = require('./api');
const statusLabels = { pending: '待审核', published: '在售', sold: '已售', rejected: '已退回' };
function properties(items) { return (items || []).map(p => ({ ...p, coverURL: asset((p.images || [])[0]), statusLabel: statusLabels[p.status] || '状态待确认', priceLabel: p.price == null ? '价格待确认' : p.price + ' 万', info: [p.city, p.district, p.rooms, p.area ? p.area + '㎡' : ''].filter(Boolean).join(' · ') })); }
function filter(items, query = '', city = '', sort = 'featured') {
  return properties(items).filter(p => (!city || p.city === city) && [p.title, p.community, p.city, p.district, p.address].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'new' ? String(b.createdAt || '').localeCompare(String(a.createdAt || '')) : sort === 'reduced' ? ((b.originalPrice || b.price) - b.price) - ((a.originalPrice || a.price) - a.price) : Number(!!b.featured) - Number(!!a.featured));
}
const fieldSpecs = [
  ['type', '交易类型'], ['ownership', '产权说明'], ['priceUnit', '价格单位'],
  ['tax', '税费说明', 'taxInfo'], ['occupancy', '居住情况', 'occupancyStatus'],
  ['mortgage', '抵押情况'], ['viewing', '看房安排', 'viewingArrangement'],
  ['tenure', '产权年限'], ['elevator', '电梯情况'], ['heating', '供暖方式'],
  ['propertyFee', '物业费用'], ['handover', '交房安排'], ['notes', '房源备注', 'note'],
];
function display(value) {
  if (value === null || value === undefined || value === '') return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(display).join('、');
  if (typeof value === 'object') return '结构化资料（待补充展示格式）';
  return String(value);
}
function detailFields(property) {
  const transaction = property.transactionInfo || {};
  const rows = fieldSpecs.map(([key, label, alias]) => ({ key, label, value: display([transaction[key], property[key], alias ? transaction[alias] : undefined, alias ? property[alias] : undefined].find(value => value !== undefined && value !== null && value !== '')) }));
  if (property.privateNotes) rows.push({ key: 'privateNotes', label: '业主私有备注', value: display(property.privateNotes) });
  return rows;
}
module.exports = { properties, filter, detailFields };
