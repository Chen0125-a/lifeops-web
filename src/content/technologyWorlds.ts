export type TechnologyGroup = 'interface' | 'data' | 'runtime' | 'delivery'

export interface TechnologyWorld {
  slug: string
  name: string
  shortName: string
  group: TechnologyGroup
  orbitIndex: 0 | 1 | 2 | 3
  angle: number
  role: string
  currentUse: string
  architecture: string
  learningNotes: string[]
  officialUrl: string
  accent: string
}

export const technologyWorlds: TechnologyWorld[] = [
  {
    slug: 'react',
    name: 'React',
    shortName: 'Re',
    group: 'interface',
    orbitIndex: 0,
    angle: 214,
    role: '负责 LifeOps 公开宇宙与私人生活界面的组件组织、状态呈现和可访问交互。',
    currentUse: 'V1 前端已确定使用 React，把首页、技术星球和生活闭环拆成可测试的路由与组件。',
    architecture: 'React 位于浏览器表现层，通过领域仓库接口读取状态，后续可无缝换成独立 API 适配器。',
    learningNotes: ['组件边界服从用户动作，而不是页面卡片数量。', '共享元素转场必须保留浏览器返回语义。'],
    officialUrl: 'https://react.dev/',
    accent: '#61dafb',
  },
  {
    slug: 'typescript',
    name: 'TypeScript',
    shortName: 'TS',
    group: 'interface',
    orbitIndex: 0,
    angle: 38,
    role: '定义计划、记录、回顾、知识和公开快照之间可验证的数据关系与状态边界。',
    currentUse: 'V1 前端的领域模型、路由注册表、动效状态机和测试全部由 TypeScript 约束。',
    architecture: '类型只描述稳定业务合同，不把 localStorage 或未来 MySQL 的存储细节泄漏到视图层。',
    learningNotes: ['优先使用判别联合表达状态机。', '外部数据进入领域层前先迁移和收窄。'],
    officialUrl: 'https://www.typescriptlang.org/',
    accent: '#3178c6',
  },
  {
    slug: 'mysql',
    name: 'MySQL',
    shortName: 'My',
    group: 'data',
    orbitIndex: 1,
    angle: 318,
    role: '作为后端阶段的主要关系数据库，承载私有生活数据、来源关系和可撤销公开快照。',
    currentUse: '数据库尚未接入当前前端阶段；技术选型已经确定，V1 先用版本化本地适配器验证数据模型。',
    architecture: '未来由独立 API 访问 MySQL，浏览器不直接连接数据库，敏感数据默认不进入公开投影。',
    learningNotes: ['先理解事务、索引和备份恢复，再决定表结构。', '公开快照采用独立投影，避免查询私有原表。'],
    officialUrl: 'https://dev.mysql.com/doc/',
    accent: '#4479a1',
  },
  {
    slug: 'docker',
    name: 'Docker',
    shortName: 'Do',
    group: 'runtime',
    orbitIndex: 1,
    angle: 150,
    role: '把前端静态服务和后端 API 分别封装成可复现、可扫描、可独立升级的镜像。',
    currentUse: '前后端双镜像方案已经批准；当前前端阶段会提供多阶段构建文件并控制镜像层体积。',
    architecture: '镜像使用固定版本与非特权运行配置，构建产物和运行时分离，适配 UHub 限速环境。',
    learningNotes: ['构建上下文越小，缓存和推送越稳定。', '镜像标签用于追踪，部署升级最终以 digest 为准。'],
    officialUrl: 'https://docs.docker.com/',
    accent: '#2496ed',
  },
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    shortName: 'K8s',
    group: 'runtime',
    orbitIndex: 2,
    angle: 198,
    role: '承载 LifeOps 的多副本前端、API 和后续数据服务，并提供声明式调度与故障恢复基础。',
    currentUse: '用户已经拥有高可用 Kubernetes 集群；LifeOps 将以可直接安装的 Helm 发布物部署到该集群。',
    architecture: '公开入口经网关进入前端与 API，应用副本无状态化，持久数据由独立存储边界负责。',
    learningNotes: ['可用性必须由演练证据证明，不能只看副本数。', '探针、资源限制和滚动升级是应用契约的一部分。'],
    officialUrl: 'https://kubernetes.io/docs/',
    accent: '#326ce5',
  },
  {
    slug: 'helm',
    name: 'Helm',
    shortName: 'He',
    group: 'runtime',
    orbitIndex: 2,
    angle: 14,
    role: '把 LifeOps 所需的 Deployment、Service、配置和后续升级参数组织为可审查的安装版本。',
    currentUse: '集群已经安装 Helm，因此第一版必须在 CI/CD 尚未部署时也能通过 Helm 独立完成首装。',
    architecture: 'Chart 保持环境差异参数化，镜像仓库、digest、域名和持久化配置不写死在模板中。',
    learningNotes: ['模板只处理环境差异，不承担业务逻辑。', '每次发布都要保留 values 与回滚路径。'],
    officialUrl: 'https://helm.sh/docs/',
    accent: '#0f1689',
  },
  {
    slug: 'github',
    name: 'GitHub',
    shortName: 'GH',
    group: 'delivery',
    orbitIndex: 3,
    angle: 232,
    role: '保存应用源码和未来 GitOps 声明，承载代码审查、版本历史与自动化触发入口。',
    currentUse: 'GitHub 已被选为源码与 GitOps 仓库平台；当前阶段先交付可推送的完整工程和锁定依赖。',
    architecture: '应用仓库产生镜像，GitOps 仓库只记录期望部署 digest，运行集群不依赖临时工作目录。',
    learningNotes: ['源码历史和部署历史应当分开审查。', '密钥不能进入仓库或构建日志。'],
    officialUrl: 'https://docs.github.com/',
    accent: '#181717',
  },
  {
    slug: 'jenkins',
    name: 'Jenkins',
    shortName: 'Je',
    group: 'delivery',
    orbitIndex: 1,
    angle: 72,
    role: '在后续 CI 阶段执行测试、构建双镜像、推送 UHub，并生成可审计的发布证据。',
    currentUse: 'Jenkins 尚未安装到新集群，当前版本不能依赖它才能首装；流水线会作为后续升级入口。',
    architecture: '动态 Agent 执行一次性任务，凭据由集群安全机制注入，流水线不把 latest 当成发布身份。',
    learningNotes: ['流水线首先复用本地验证命令。', '失败构建不得更新 GitOps 仓库。'],
    officialUrl: 'https://www.jenkins.io/doc/',
    accent: '#d24939',
  },
  {
    slug: 'argo-cd',
    name: 'Argo CD',
    shortName: 'Ar',
    group: 'delivery',
    orbitIndex: 3,
    angle: 332,
    role: '在后续 GitOps 阶段持续对比仓库期望状态与集群实际状态，并执行可追踪的声明式升级。',
    currentUse: 'Argo CD 尚未部署，当前首装只依赖 Helm；接入后由它消费 GitOps 仓库中的镜像 digest。',
    architecture: 'CI 只更新期望版本，不直接长期持有集群写权限；Argo CD 在集群侧完成收敛与回滚观察。',
    learningNotes: ['同步成功不等于业务健康，仍要看探针与验收。', '漂移应先解释来源，再决定覆盖方向。'],
    officialUrl: 'https://argo-cd.readthedocs.io/',
    accent: '#ef7b4d',
  },
  {
    slug: 'git',
    name: 'Git',
    shortName: 'Git',
    group: 'delivery',
    orbitIndex: 3,
    angle: 104,
    role: '记录设计、代码、测试和部署声明的变化来源，为升级、审查与问题回溯提供共同时间线。',
    currentUse: 'LifeOps 工程将使用 Git 管理；当前生成工作区本身不是仓库，因此本轮只能保留文件级交付证据。',
    architecture: '提交描述一次可解释变化，镜像 digest 与 Git 版本关联，避免无法复现的手工集群修改。',
    learningNotes: ['小而完整的提交比混合大提交更易回滚。', '历史用于解释变化，不应用强制重写掩盖问题。'],
    officialUrl: 'https://git-scm.com/doc',
    accent: '#f05032',
  },
]

export const technologyGroups: Array<{
  id: TechnologyGroup
  eyebrow: string
  title: string
  description: string
}> = [
  { id: 'interface', eyebrow: '01 · INTERFACE', title: '界面层', description: '把生活流程表达成可操作、可访问的界面。' },
  { id: 'data', eyebrow: '02 · DATA', title: '数据层', description: '让私密信息、来源关系与公开投影保持边界。' },
  { id: 'runtime', eyebrow: '03 · RUNTIME', title: '运行层', description: '把应用稳定地交付到现有 Kubernetes 集群。' },
  { id: 'delivery', eyebrow: '04 · DELIVERY', title: '交付链路', description: '让每次构建、升级和回滚都有版本证据。' },
]

export const findTechnologyWorld = (slug: string) =>
  technologyWorlds.find((world) => world.slug === slug)
