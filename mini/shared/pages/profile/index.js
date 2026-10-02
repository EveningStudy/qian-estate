const { define } = require('../../lib/page');
const api = require('../../lib/api');
const { properties } = require('../../lib/model');
Page(define({
  data:{ loggedIn:false, consent:false },
  toggleSection(e) {const key=e.currentTarget.dataset.section;if(['showFavorites','showProperties','showAgents','showServices'].includes(key))this.setData({[key]:!this.data[key]});},
  onShow() { this.setData({ loggedIn:api.signedIn() }); if (api.signedIn()) this.refresh(); else this.setData({role:'',profile:null,favorites:[],own:[],agents:[],applications:[]}); },
  async render(s) {
    this.setData({ loggedIn:true, profile:s.user, favorites:properties(s.properties.filter(p => (s.favorites || []).some(f => f.propertyId === p.id))), own:properties(s.properties.filter(p => p.ownerId === s.user.id)), agents:s.agents || [] });
    if (this.data.appRole === 'agent' && this.data.mode === 'production') {
      const applications = await api.request('/api/agent-applications');
      this.setData({applications:applications.map(item => ({...item,statusLabel:({pending:'待管理员审核',approved:'审核通过',rejected:'审核未通过'})[item.status] || '状态待确认'})),pendingApplication:applications.some(item=>item.status === 'pending')});
    }
  },
  consent(e) { this.setData({ consent:e.detail.value.includes('agree') }); },
  privacy() { if(this.data.mode === 'demo') { wx.showModal({title:'本地演示说明',content:'本演示仅使用虚构资料。登录使用测试身份，不申请微信手机号、不发送真实通知、不进行交易。请勿输入真实个人信息。',showCancel:false}); return; } api.native('openPrivacyContract').catch(err => this.setData({ error:err.message })); },
  async pairing() {
    if (this.data.role !== 'admin' || this.data.busy) return;
    this.setData({busy:true,error:'',pairCode:''});
    try { const r=await api.request('/api/admin/pairing','POST',{}); if (!/^\d{8}$/.test(String(r.code)) || !(r.expiresIn>0)) throw new Error('配对响应无效'); this.setData({pairCode:String(r.code),pairExpiry:new Date(Date.now()+r.expiresIn*1000).toLocaleTimeString()}); }
    catch(err){this.setData({error:err.message});} finally{this.setData({busy:false});}
  },
  async prepareSubscription() {
    if (this.data.busy) return;
    this.setData({busy:true,error:'',templateId:''});
    try {const r=await api.request('/api/subscriptions/template');if (!r.templateId) throw new Error('订阅模板未配置');this.setData({templateId:r.templateId});}
    catch(err){this.setData({error:err.message});}finally{this.setData({busy:false});}
  },
  async subscribe() {
    if (!this.data.templateId || this.data.busy) return;
    this.setData({busy:true,error:'',serviceMessage:''});
    try {const id=this.data.templateId; const r=await api.native('requestSubscribeMessage',{tmplIds:[id]});if(r[id]!=='accept') {this.setData({serviceMessage:'未同意订阅，未登记授权'});return;} const saved=await api.request('/api/subscriptions/grant','POST',{templateId:id,accepted:true});this.setData({serviceMessage:saved.message || '订阅意愿已记录，实际送达由微信决定'});}
    catch(err){this.setData({error:err.message});}finally{this.setData({busy:false});}
  },
  smsConsent(e) {this.setData({smsConsented:e.detail.value.includes('sms')});},
  smsInput(e) {this.setData({smsCode:e.detail.value});},
  async smsChallenge() {
    if (!this.data.smsConsented || this.data.busy) return;
    if (Date.now() < (this.smsNext || 0)) return this.setData({error:'五分钟内请勿重复发送，超时结果也可能已受理'});
    this.smsNext=Date.now()+300000;this.setData({busy:true,error:'',serviceMessage:''});
    try {const r=await api.request('/api/sms/challenge','POST',{consent:true});this.setData({serviceMessage:r.message || '请求已受理，请检查本人绑定手机'});}
    catch(err){this.setData({error:err.message});}finally{this.setData({busy:false});}
  },
  async smsVerify() {
    if (this.data.busy) return;
    if (!/^\d{6}$/.test(this.data.smsCode || '')) return this.setData({error:'请输入6位短信验证码'});
    this.setData({busy:true,error:'',serviceMessage:''});
    try {const r=await api.request('/api/sms/verify','POST',{code:this.data.smsCode});if(!r.verified)throw new Error('验证码未通过');this.setData({serviceMessage:r.message || '验证通过',smsCode:''});}
    catch(err){this.setData({error:err.message});}finally{this.setData({busy:false});}
  },
  onHide() {this.setData({pairCode:'',smsCode:''});},
  async login() {
    if (!this.data.consent || this.data.busy) return;
    this.setData({ busy:true,error:'' });
    try { await api.login(); await this.refresh(); } catch (err) { this.setData({ error:err.message }); } finally { this.setData({ busy:false }); }
  },
  phone(e) {
    if (!e.detail.code) return this.setData({ error:'未获得手机号授权，未绑定手机号' });
    return this.mutate(() => api.request('/api/auth/wechat/phone','POST',{ code:e.detail.code }));
  },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy:true,error:'' });
    try { await api.logout(); this.setData({ loggedIn:false,profile:null,user:null,role:'',ready:false,favorites:[],own:[],agents:[],consent:false,pairCode:'',smsCode:'',templateId:'',serviceMessage:'' }); wx.reLaunch({ url:'/pages/profile/index' }); }
    catch (err) { this.setData({ error:'退出未确认：' + err.message }); }
    finally { this.setData({ busy:false }); }
  }
}));
