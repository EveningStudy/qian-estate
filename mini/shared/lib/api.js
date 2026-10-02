const config = require('../config');
const tokenKey = 'qian.token.' + config.mode + '.' + config.role;
let pending;
const attempts = new Map();
let sequence = 0;
function clear() { wx.removeStorageSync(tokenKey); getApp().globalData.snapshot = null; }
function signedIn() { return !!wx.getStorageSync(tokenKey); }
function request(path, method = 'GET', data, authenticated = true, contentType = 'application/json') {
  // 同一页面会话的未确认写操作复用幂等键，确认成功后才释放。
  const idempotent = authenticated && contentType === 'application/json' && method !== 'GET' && !path.includes('/auth/') && !path.includes('/sms/') && !path.includes('/subscriptions/') && !path.includes('/admin/');
  const fingerprint = idempotent ? JSON.stringify([wx.getStorageSync(tokenKey),path,method,data]) : '';
  if (fingerprint && !attempts.has(fingerprint)) attempts.set(fingerprint,'mini-'+Date.now()+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2));
  return new Promise((resolve, reject) => {
    if (authenticated && !signedIn()) return reject(new Error('请先在个人中心登录'));
    wx.request({ url: config.baseURL + path, method, data, timeout: 15000,
      header: { 'content-type': contentType, ...(authenticated ? { Authorization: 'Bearer ' + wx.getStorageSync(tokenKey) } : {}), ...(fingerprint ? {'Idempotency-Key':attempts.get(fingerprint)} : {}) },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && !(res.data && res.data.error)) { if(fingerprint) attempts.delete(fingerprint); return resolve(res.data); }
        if (res.statusCode === 401) clear();
        const body = res.data || {}; const detail = body.error || {};
        reject(new Error(detail.message || body.message || (typeof detail === 'string' ? detail : '') || '请求失败（' + res.statusCode + '）'));
      }, fail(err) { reject(new Error('连接失败，提交结果可能尚未确认，请刷新核对后再操作：' + err.errMsg)); }
    });
  });
}
function native(name, options = {}) { return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: err => reject(new Error(err.errMsg || '微信操作失败')) })); }
async function login() {
  if (pending) return pending;
  pending = (async () => {
    let result;
    if (config.mode === 'demo') result = await request('/api/auth/demo', 'POST', { role: config.role }, false);
    else {
      await native('requirePrivacyAuthorize');
      const auth = await native('login');
      if (!auth.code) throw new Error('微信未返回登录凭证');
      result = await request('/api/auth/wechat/login', 'POST', { code: auth.code, app: config.role, privacyVersion: config.privacyVersion || '2026-09-09' }, false);
    }
    if (!result || !result.token || !result.user) throw new Error('登录响应缺少 token/user');
    wx.setStorageSync(tokenKey, result.token);
    return result.user;
  })().finally(() => { pending = null; });
  return pending;
}
async function logout() { await request('/api/auth/logout', 'POST', {}); clear(); }
async function bootstrap() { const data = await request('/api/bootstrap'); if (!data || !data.user || !Array.isArray(data.properties)) throw new Error('初始化响应缺少 user/properties'); getApp().globalData.snapshot = data; return data; }
function property(id) { return request('/api/properties/' + encodeURIComponent(id)); }
function asset(path) { return !path ? '' : /^https?:\/\//.test(path) ? path : config.baseURL + (path[0] === '/' ? '' : '/') + path; }
async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不得超过 5MB');
  const bytes = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: file.tempFilePath, success: result => resolve(result.data), fail: err => reject(new Error(err.errMsg)) }));
  const b = new Uint8Array(bytes);
  if (b.byteLength > 5 * 1024 * 1024) throw new Error('图片不得超过 5MB');
  const type = b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 ? 'image/png' : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : '';
  if (!type) throw new Error('仅支持 PNG 或 JPEG 图片');
  const result = await request('/api/uploads', 'POST', bytes, true, type);
  if (!result || !/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpeg|jpg)$/.test(result.url)) throw new Error('上传响应缺少有效图片地址');
  return {url:result.url,previewUrl:result.previewUrl || result.url};
}
module.exports = { request, bootstrap, property, login, logout, clear, signedIn, asset, native, upload };
