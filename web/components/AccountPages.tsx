import { useStore } from "../store";
import { production } from "../config";
import { roleLabels } from "../data";
import { FAQ } from "./OwnerDashboard";
import { RemoteForm, Section } from "./UI";

export default function AccountPages({
  view,
}: {
  view: "profile" | "help" | "privacy";
}) {
  const { data, role } = useStore();
  if (production && view === "privacy")
    return (
      <>
        <div className="page-heading">
          <h1>数据与隐私说明</h1>
        </div>
        <Section title="登录与权限">
          <p>
            正式后台使用小程序管理员生成的短期配对码。会话仅保存在当前页面内存中，刷新后需重新登录。每项数据读取和修改仍由服务器校验权限。
          </p>
        </Section>
        <Section title="数据保存与个人权利">
          <p>
            房源、委托和消息保存在部署方的数据目录，图片使用本地存储或私有对象存储。个人资料可导出；注销申请需要核对未结业务及依法留存事项，不会立即删除数据。正式隐私政策和联系方式由运营主体审核发布，并与微信平台填写的信息保持一致。
          </p>
        </Section>
        <Section title="服务边界">
          <p>
            地图、短信和微信服务须配置并完成真实联调。支付尚未形成收款业务，门锁控制始终关闭，人工房源核验不等于住建平台自动核验。不得向用户作出超出现有能力的承诺。
          </p>
        </Section>
      </>
    );
  if (view === "privacy")
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>隐私，始终有边界。</h1>
            <p>本地开发原型 · 演示数据说明</p>
          </div>
        </div>
        <div className="legal-copy">
          <Section title="只用虚构信息">
            <p>
              请勿在表单中输入真实姓名、手机号、住址、证件或财务信息。所有房源、人物、成交、图片和估价都用于产品演示，不提供真实房产服务。
            </p>
          </Section>
          <Section title="数据保存在什么地方？">
            <p>
              在线时，提交的数据保存在当前 API
              服务的本地数据库中。会话令牌仅保存在当前页面内存中，刷新页面会重新演示登录。离线预览不会在浏览器中保存或伪造业务写入。
            </p>
          </Section>
          <Section title="角色与权限">
            <p>
              业主、经纪人、管理员均通过本地演示登录接口取得各自会话。业务权限由服务器校验；管理员不能读取不属于其会话的私人消息。此登录方式仅适用于本地开发，不是生产身份验证。
            </p>
          </Section>
          <Section title="删除与门锁安全">
            <p>
              目前不提供账户或数据删除接口，需要由本地服务维护者管理演示数据库。门锁控制始终关闭，任何审批都不会触发真实开锁。
            </p>
          </Section>
        </div>
      </>
    );
  if (view === "help")
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>有疑问，一起说清楚。</h1>
            <p>先看看常见问题，或把您的问题交给演示管理员。</p>
          </div>
        </div>
        <Section title="常见问题">
          <FAQ />
        </Section>
        <div className="two-column">
          <Section title="提出问题">
            <RemoteForm
              path="/questions"
              submit="提交问题"
              fields={[
                {
                  name: "question",
                  label: "您的问题",
                  type: "textarea",
                  wide: true,
                  required: true,
                },
              ]}
              success="问题已提交，管理员答复后可在常见问题中查看。"
            />
          </Section>
          <Section title="意见反馈">
            <RemoteForm
              path="/feedback"
              submit="发送反馈"
              fields={[
                {
                  name: "category",
                  label: "反馈类型",
                  options: [
                    { value: "体验建议", label: "体验建议" },
                    { value: "功能问题", label: "功能问题" },
                  ],
                },
                {
                  name: "content",
                  label: "反馈内容",
                  type: "textarea",
                  wide: true,
                  required: true,
                },
              ]}
            />
          </Section>
        </div>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>属于您的栖岸。</h1>
          <p>管理演示资料，让每一次协作都有清晰的身份。</p>
        </div>
      </div>
      <div className="profile-header">
        <span className="avatar large">{data.user?.name[0]}</span>
        <div>
          <h2>{data.user?.name}</h2>
          <p>
            {roleLabels[role]} · {data.user?.id}
          </p>
        </div>
      </div>
      <Section
        title="个人资料"
        caption="资料由服务器保存。手机号只能在微信小程序授权绑定，角色不能通过资料表单更改。"
      >
        <RemoteForm
          key={data.user?.id}
          path="/profile"
          method="PUT"
          submit="保存资料"
          fields={[
            {
              name: "name",
              label: "显示名称",
              value: data.user?.name,
              required: true,
            },
            { name: "city", label: "所在城市", value: data.user?.city || "" },
            ...(!production
              ? [
                  {
                    name: "phone",
                    label: "联系电话（演示）",
                    value: data.user?.phone || "",
                    type: "tel",
                  },
                ]
              : []),
            {
              name: "bio",
              label: "个人介绍",
              type: "textarea",
              value: data.user?.bio || "",
              wide: true,
            },
          ]}
        />
      </Section>
    </>
  );
}
