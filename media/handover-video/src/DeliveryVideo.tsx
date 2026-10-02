import {AbsoluteFill,Composition,Img,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
const scenes=[
 {title:'找房与卖房',caption:'首页保留两项主要操作，常用功能更好找',file:'native-home.png'},
 {title:'房源详情',caption:'查看房源照片、户型与价格信息',file:'native-detail.png'},
 {title:'我的委托与资料',caption:'收藏、委托和预约集中到「我的」',file:'native-profile.png'},
 {title:'经纪人工作台',caption:'在联卖端处理委托、预约和客户跟进',file:'native-workspace.png'},
 {title:'业务消息',caption:'查看相关会话，并进入回复页面',file:'native-messages.png'},
];
function Shot({title,caption,file}:{title:string;caption:string;file:string}){const frame=useCurrentFrame();return <AbsoluteFill style={{background:'#f3f6f5',color:'#203943',fontFamily:'Microsoft YaHei,sans-serif'}}><div style={{padding:'56px 64px'}}><div style={{fontSize:24,color:'#52716f'}}>栖岸 · 小程序页面演示</div><h1 style={{fontSize:56,margin:'18px 0',fontWeight:600}}>{title}</h1><div style={{fontSize:28,color:'#63777d'}}>{caption}</div></div><div style={{position:'absolute',top:285,bottom:116,left:192,right:192,opacity:interpolate(frame,[0,10],[0,1],{extrapolateRight:'clamp'})}}><Img src={staticFile(file)} style={{width:'100%',height:'100%',objectFit:'contain',borderRadius:22}}/></div><div style={{position:'absolute',bottom:54,left:55,right:55,textAlign:'center',fontSize:23,color:'#627779'}}>近期微信模拟器截图 · 静态页面演示 · 虚构数据</div></AbsoluteFill>}
function Closing(){return <AbsoluteFill style={{background:'#203943',color:'#fff',fontFamily:'Microsoft YaHei,sans-serif',padding:'130px 76px'}}><div style={{fontSize:30,color:'#b6d6d0'}}>技术交接版</div><h1 style={{fontSize:66,lineHeight:1.45,margin:'55px 0'}}>页面与代码可交接<br/>上线前仍需验收</h1><p style={{fontSize:34,lineHeight:1.9}}>接手方配置微信应用凭据、域名证书、服务器、短信和地图等账号，完成备案、资质核对与真机联调。</p><div style={{borderTop:'1px solid #607880',marginTop:55,paddingTop:42,fontSize:30,lineHeight:1.9,color:'#c7dbdf'}}>支付订单与退款、自动实名认证、地方房源自动核验、真实全景及门锁控制尚未完成。<br/><br/>本视频使用已采集模拟器画面，不作为最后一次修复的真机验收证明。</div></AbsoluteFill>}
export const DeliveryVideo=()=> <AbsoluteFill>{scenes.map((s,i)=><Sequence key={s.file} from={i*210} durationInFrames={210}><Shot {...s}/></Sequence>)}<Sequence from={1050} durationInFrames={300}><Closing/></Sequence></AbsoluteFill>;
export const DeliveryComposition=()=> <Composition id="DeliveryPortrait" component={DeliveryVideo} width={1080} height={1920} fps={30} durationInFrames={1350}/>;
