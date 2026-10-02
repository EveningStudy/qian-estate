import { AbsoluteFill, Composition, Img, Sequence, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
const scenes = [
  ['栖岸房产协作平台','给业主、经纪人和管理员使用的一套中文业务系统'],
  ['业主端：从委托出售开始','填写小区、面积、期望价格和联系方式，提交后进入服务器审核流程。','01-owner.png'],
  ['房源端：搜索与筛选','按城市、区域、关键词和价格排序浏览房源，进入详情查看图片、户型、产权与交易说明。'],
  ['经纪人端：联卖与客户跟进','提交联卖申请、管理客户、处理预约，并通过消息与相关参与者沟通。'],
  ['管理端：审核与风险控制','管理员通过一次性配对码进入后台，审核经纪人入驻、房源资料和人工核验记录。'],
  ['已经接入的基础能力','微信登录、手机号授权、图片上传、数据库、权限隔离、审计、备份、地图和短信适配。'],
  ['交接时需要配置','两个小程序的 AppID 与密钥、HTTPS 域名、服务器、备案、短信签名、地图密钥和正式隐私政策。'],
  ['交接边界','微信支付收款业务、自动实名认证、住建平台自动核验、真实 VR 和智能锁仍需单独完成联调与审核。'],
  ['交接入口','阅读 README 和生产交接指南，复制环境模板，运行配置检查，再进行真机登录和小程序审核。'],
] as const;
function Scene({ data }: { data: typeof scenes[number] }) {
  const frame = useCurrentFrame(); const scale = interpolate(frame,[0,45],[.96,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:'#f7faf9',color:'#163346',fontFamily:'Microsoft YaHei,sans-serif'}}><div style={{height:18,background:'#147d80',width:`${Math.min(100,frame*2.3)}%`}}/><div style={{padding:'110px 92px',position:'relative'}}><div style={{fontSize:26,letterSpacing:8,color:'#147d80',marginBottom:35}}>栖岸 · 房产协作</div><h1 style={{fontSize:72,lineHeight:1.18,margin:0,fontWeight:600}}>{data[0]}</h1><p style={{fontSize:31,lineHeight:1.65,color:'#61747d',maxWidth:850,marginTop:42}}>{data[1]}</p>{data[2]?<div style={{marginTop:50,borderRadius:28,overflow:'hidden',background:'#fff',boxShadow:'0 20px 60px rgba(22,51,70,.12)',transform:`scale(${scale})`,transformOrigin:'top left'}}><Img src={staticFile(data[2])} style={{width:'100%',display:'block'}}/></div>:<div style={{marginTop:78,borderTop:'1px solid #d7e1df',paddingTop:34,fontSize:24,color:'#147d80'}}>交接演示 · 虚构数据 · 不代表生产服务</div>}<div style={{position:'absolute',top:1760,left:92,right:92,display:'flex',justifyContent:'space-between',fontSize:20,color:'#87979d'}}><span>小程序交接展示</span><span>栖岸</span></div></div></AbsoluteFill>;
}
export const MyComposition = () => <Composition id="QianEstateHandover" component={MyComponent} durationInFrames={scenes.length*150} fps={30} width={1080} height={1920}/>;
export const MyComponent: React.FC = () => <AbsoluteFill>{scenes.map((data,i)=><Sequence key={data[0]} from={i*150} durationInFrames={150}><Scene data={data}/></Sequence>)}</AbsoluteFill>;
