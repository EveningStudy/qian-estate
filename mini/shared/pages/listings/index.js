const { define } = require('../../lib/page');
const { filter } = require('../../lib/model');
Page(define({
  data: { query: '', cityIndex: 0, cities: ['全部城市'], sortIndex: 0, sorts: ['精选优先', '最新发布', '降价优先'], loading: false, error: '' },
  render(s) { const cities = ['全部城市'].concat([...new Set((s.properties || []).map(p => p.city).filter(Boolean))].sort()); this.setData({ cities, cityIndex: Math.min(this.data.cityIndex, cities.length - 1) }); this.apply(); },
  apply() { this.setData({ items: filter(this.snapshot.properties, this.data.query, this.data.cityIndex ? this.data.cities[this.data.cityIndex] : '', ['featured', 'new', 'reduced'][this.data.sortIndex]) }); },
  search(e) { this.setData({ query: e.detail.value }); if (this.snapshot) this.apply(); },
  city(e) { this.setData({ cityIndex: Number(e.detail.value) }); if (this.snapshot) this.apply(); },
  sort(e) { this.setData({ sortIndex: Number(e.detail.value) }); if (this.snapshot) this.apply(); }
}));
