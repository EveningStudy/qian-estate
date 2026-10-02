const { define } = require('../../lib/page');
const { schemas,payload } = require('../../lib/forms');
const { contacts } = require('../../lib/workflow');
const api = require('../../lib/api');
Page(define({
  data:{ values:{},fields:[],images:[],choices:{},selection:{},saved:false },
  onLoad(options) {
    this.options = options || {}; const collection = options.collection;
    if (!Object.prototype.hasOwnProperty.call(schemas,collection)) { this.setData({ error:'未知表单',invalid:true }); return; }
    const fields = schemas[collection].fields.filter(field => !(collection === 'profile' && this.data.mode === 'production' && field.key === 'phone'));
    this.setData({ collection,title:schemas[collection].title,fields,values:{ propertyId:options.propertyId || '',recipientId:options.to || '',note:options.source === 'callback' ? '请电话回访联系出售事宜' : '' } });
  },
  async render(s) {
    if (this.data.invalid) return;
    const c = this.data.collection;
    if ((['properties','commissions','appointments'].includes(c) && s.user.role !== 'owner') || (['clients','collaborations'].includes(c) && s.user.role !== 'agent')) { this.setData({invalid:true}); throw new Error('当前账号无此权限，请完成入驻审核后再操作'); }
    const props = s.properties.filter(p => c === 'commissions' ? p.ownerId === s.user.id && p.status !== 'sold' : c === 'collaborations' ? p.status === 'published' && p.agentId !== s.user.id : c === 'appointments' ? p.status === 'published' : c === 'lockRequests' ? p.ownerId === s.user.id || p.agentId === s.user.id : true);
    const choices = { property:[{id:'',name:'请选择房源'}].concat(props.map(p => ({id:p.id,name:p.community + ' · ' + p.title}))),agent:[{id:'',name:'由房源负责经纪人确定'}].concat((s.agents || []).map(a => ({id:a.id,name:a.name}))),contact:[{id:'',name:'请选择联系人'}].concat(contacts(s)) };
    if (!this.initialized) {
      if (c === 'profile') this.setData({ values:{name:s.user.name || '',phone:s.user.phone || '',city:s.user.city || '',bio:s.user.bio || ''} });
      if (c === 'properties' && this.options.id) {
        const p = await api.property(this.options.id);
        if (p.ownerId !== s.user.id) throw new Error('只能编辑自己的房源');
        const values = {}; for (const field of schemas.properties.fields) values[field.key] = p[field.key] == null ? '' : p[field.key];
        this.setData({ values,images:(p.images || []).map(url => ({url,src:api.asset(url)})),title:'编辑我的房源' });
      }
      this.initialized = true;
    }
    const selection = {}; for (const f of this.data.fields) if (choices[f.type]) selection[f.key] = Math.max(0,choices[f.type].findIndex(item => item.id === this.data.values[f.key]));
    this.setData({ choices,selection });
  },
  input(e) { this.setData({ ['values.' + e.currentTarget.dataset.key]:e.detail.value,saved:false }); },
  choose(e) { const {key,type} = e.currentTarget.dataset; const index = Number(e.detail.value); this.setData({ ['values.' + key]:this.data.choices[type][index].id,['selection.' + key]:index,saved:false }); },
  async photos() {
    if (this.data.busy || this.data.images.length >= 12) return;
    this.setData({busy:true,error:''});
    try {
      const selected = await api.native('chooseMedia',{count:Math.min(9,12-this.data.images.length),mediaType:['image'],sourceType:['album','camera']});
      for (const file of selected.tempFiles) { const uploaded = await api.upload(file); this.setData({images:this.data.images.concat({url:uploaded.url,src:api.asset(uploaded.previewUrl)}),saved:false}); }
    } catch (err) { this.setData({error:err.message}); } finally { this.setData({busy:false}); }
  },
  removePhoto(e) { if (!this.data.busy) this.setData({images:this.data.images.filter((_,i) => i !== Number(e.currentTarget.dataset.index)),saved:false}); },
  submit() {
    if (this.data.invalid || this.data.saved) return;
    return this.mutate(async () => {
      const c = this.data.collection; const data = payload({fields:this.data.fields},this.data.values);
      if (c === 'agent-applications' && !/^1\d{10}$/.test(data.phone)) throw new Error('请填写通过微信绑定的本人11位手机号');
      if (c === 'commissions' && !data.propertyId && !(data.community && data.area && data.price)) throw new Error('请选择自有房源，或填写小区、面积与期望价格');
      if (c === 'properties') data.images = this.data.images.map(item => item.url.split('?')[0]);
      if (c === 'valuation') { this.setData({result:await api.request('/api/valuation','POST',data)}); return; }
      const path = c === 'profile' ? '/api/profile' : c === 'properties' && this.options.id ? '/api/properties/' + encodeURIComponent(this.options.id) : '/api/' + c;
      const result = await api.request(path,c === 'profile' || (c === 'properties' && this.options.id) ? 'PUT' : 'POST',data);
      this.setData({saved:true,receipt:result.status || '已保存'});
    });
  }
}));
