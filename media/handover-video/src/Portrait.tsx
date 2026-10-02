import {AbsoluteFill,Composition,Img,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
const pages=[
 {title:'业主委托',sub:'填写房屋信息，发起出售委托',file:'owner.png'},
 {title:'浏览房源',sub:'搜索小区，按区域与总价筛选',file:'listings.png'},
 {title:'查看详情',sub:'房源照片、价格与户型集中展示',file:'detail.png'},
 {title:'消息沟通',sub:'查看本人参与的会话，联系经纪人',file:'messages.png'},
 {title:'接入状态',sub:'区分功能已实现、已配置与待联调',file:'services.png'},
];
function PageScene({title,sub,file}:{title:string;sub:string;file:string}){const f=useCurrentFrame();return <AbsoluteFill style={{background:'#eef3f2',fontFamily:'Microsoft YaHei',color:'#173847'}}><div style={{padding:'68px 72px 0'}}><div style={{fontSize:26,color:'#147d80',letterSpacing:4}}>栖岸 · 页面展示</div><h1 style={{fontSize:62,margin:'14px 0 12px',fontWeight:600}}>{title}</h1><div style={{fontSize:29,color:'#526c76'}}>{sub}</div></div><div style={{position:'absolute',left:136,top:310,width:808,height:1500,border:'10px solid #183745',borderRadius:38,overflow:'hidden',background:'white',opacity:interpolate(f,[0,12],[0,1],{extrapolateRight:'clamp'}),translate:`0 ${interpolate(f,[0,20],[24,0],{extrapolateRight:'clamp'})}px`}}><Img src={staticFile(file)} style={{width:788,height:'auto',display:'block'}}/></div><div style={{position:'absolute',bottom:36,width:'100%',textAlign:'center',fontSize:23,color:'#526c76'}}>浏览器手机预览 · 非微信真机录屏 · 虚构数据</div></AbsoluteFill>}
function End(){return <AbsoluteFill style={{background:'#173847',color:'white',fontFamily:'Microsoft YaHei',padding:'150px 85px'}}><div style={{fontSize:30,color:'#7dd0c4'}}>栖岸 · 交接提示</div><h1 style={{fontSize:72,lineHeight:1.4,marginTop:65}}>页面可演示<br/>上线仍需联调</h1><div style={{fontSize:38,lineHeight:1.9,marginTop:65}}>接手后需要配置：<br/>微信应用凭据与手机号权限<br/>域名、证书、服务器与备案<br/>短信、地图、对象存储服务</div><div style={{fontSize:32,lineHeight:1.8,color:'#b9d3da',borderTop:'1px solid #55717b',paddingTop:40,marginTop:70}}>支付收款业务、自动实名核验、<br/>真实全景与智能锁尚未完成。<br/><br/>请先阅读项目说明及生产交接指南。</div></AbsoluteFill>}
export function PortraitVideo(){return <AbsoluteFill>{pages.map((p,i)=><Sequence key={p.file} from={i*240} durationInFrames={240}><PageScene {...p}/></Sequence>)}<Sequence from={1200} durationInFrames={300}><End/></Sequence></AbsoluteFill>}
export const PortraitComposition=()=> <Composition id="PortraitHandover" component={PortraitVideo} durationInFrames={1500} fps={30} width={1080} height={1920}/>;
