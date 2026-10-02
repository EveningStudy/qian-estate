const { define } = require('../../lib/page');
const { filter } = require('../../lib/model');
Page(define({
  render(s) { this.setData({ items: filter(s.properties).slice(0, 4), transactions: (s.transactions || []).slice(0, 3), faqs: (s.faqs || []).slice(0, 2), notifications: (s.notifications || []).slice(0, 3) }); }
}));
