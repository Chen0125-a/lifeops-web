---
name: LifeOps
description: 一张从今天开始、让生活证据自然沉淀的日光工作台
colors:
  action-blue: "#2867e8"
  action-blue-soft: "#eaf1ff"
  ink: "#142033"
  text-muted: "#667085"
  text-faint: "#929baa"
  paper: "#ffffff"
  daylight-canvas: "#f7f9fb"
  wash: "#f4f7fa"
  line: "#dfe5ec"
  line-strong: "#cbd4df"
  public-night: "#020306"
  warm-light: "#f5eadf"
  success: "#147d55"
  danger: "#b42318"
typography:
  display:
    fontFamily: "Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "clamp(4rem, 6.7vw, 6rem)"
    fontWeight: 500
    lineHeight: 0.93
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control-sm: "9px"
  control: "12px"
  panel: "16px"
  window: "24px"
  round: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "34px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "50px"
  button-public:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.round}"
    padding: "0 20px"
    height: "48px"
  input-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "11px 0"
---

# Design System: LifeOps

## Overview

**Creative North Star: “日光制图台”**

LifeOps 把生活管理呈现为一张持续使用的工作纸，而不是一组后台卡片。公开页可以更具表达性：白天是暖白与淡蓝环境光，夜间是安静星空，五个有含义的对象沿不规则轨迹移动。身份确认之后，空间只保留明亮日光；视觉语言从“探索”切换为“整理、执行、留下证据”。

系统的高级感来自比例、留白、线条和状态连贯性。装饰不能承担信息架构；动效必须解释入口、路由或因果关系。私人区保持平静、长时可读，不延续公开页的轨道隐喻。

**Key Characteristics:**

- 公开表达与私人工作台有明确视觉边界。
- 私人首屏是纵向时间线和窄上下文栏，不是指标仪表盘。
- 一条细分隔线优先于容器，容器优先保持平坦。
- 主蓝色只标记当前、可执行和焦点状态。

## Colors

颜色以冷白纸面和深蓝黑文字为基础；暖光只属于公开日间入口，深夜色只属于公开夜间入口。

### Primary

- **行动蓝**：用于当前时间线、活动导航、主要提交和键盘焦点。
- **行动蓝浅层**：用于完成按钮、选择态和低强度反馈。

### Secondary

- **暖光**：只用于公开首页的日间环境光，不进入私人功能页面。
- **公开夜幕**：只用于公开首页夜间主题，不成为私人区背景。

### Neutral

- **墨色**：标题、正文和主操作文字。
- **冷纸白 / 日光画布**：主要表面与应用背景。
- **细线 / 强细线**：时间刻度、表单底线、区块边界和导航分隔。
- **次级文字 / 微弱文字**：解释、时间、来源和空状态。

**The Blue Evidence Rule.** 行动蓝只标记“现在是什么”或“下一步能做什么”，不能铺满整页。

**The Theme Boundary Rule.** 星空黑不得穿过登录边界；私人工作台始终使用日光画布。

## Typography

**Display Font:** Noto Sans SC Variable（随应用自托管）  
**Body Font:** Noto Sans SC Variable（随应用自托管）

**Character:** 紧凑、克制的中文无衬线；展示标题依靠尺度和字重，不依赖英文眉题、渐变字或装饰字体。

### Hierarchy

- **Display**（500，响应式最高 6rem，0.93）：只用于公开首屏和大型收束句。
- **Headline**（600，3rem，约 1.1）：私人页面标题和主要章节。
- **Title**（600，1–1.35rem）：列表条目、上下文模块和表单任务。
- **Body**（400，1rem，1.7）：说明文字，控制在约 65–75 个拉丁字符的阅读宽度内。
- **Label**（600，0.75rem）：导航、按钮、字段标签和时间刻度，不全大写。

**The Heading Speaks Rule.** 标题上方不添加英文 kicker、eyebrow 或装饰编号；来源和状态放在标题之后或相邻位置。

## Layout

公开首屏在桌面使用约 42/58 的非对称双栏：左侧主张，右侧轨迹。后续章节是原生长文档，依次解释闭环、项目、近况和公开/私人边界。公开详情保留顶部粘性返回条，滚动到底仍能退出。

私人区使用稳定顶部导航和最大 1540px 内容画布。今日页的主列是 06:00–22:00 时间线，右列依次放“接下来、待回顾、最近记录”。其他功能按任务重排为列表/时间流/证据弧/知识索引/快照预览，不共享同一套卡片模板。

1180px 以下缩小轨迹与工具密度；860px 以下把工作区变成单列并把导航移到第二行；560px 以下保留至少 44px 触控目标，十个私人导航标签通过可感知的横向导航完整可达，不截断当前项或把关闭/返回推到页面顶部之外。

## Elevation & Depth

系统平坦优先。页面结构使用色阶和 1px 线条，不给每个区块加阴影。只有登录窗、命令搜索、快速记录和移动对象需要从当前表面暂时抬起；阴影必须带下方偏移和宽柔化，不使用发光描边或硬偏移块影。

### Shadow Vocabulary

- **对象漂浮**（`0 12px 34px rgba(24,52,92,.12)`）：公开语义对象。
- **窗口抬升**（`0 32px 90px rgba(5,17,37,.24)`）：登录身份边界。
- **工作台浮层**（`0 34px 100px rgba(25,43,71,.24)`）：全局搜索和快速记录。

**The Flat-by-Default Rule.** 常驻内容只用纸面与线条；阴影表示临时层级或可移动对象。

## Shapes

时间线、边界和表单以直线为主。常规操作使用 9–12px 圆角，临时浮层使用 16px，登录窗使用 24px。圆形只属于公开对象、主题按钮、头像和状态点；胶囊只用于短小的公开入口操作。

## Components

### Buttons

- **Primary:** 行动蓝、白字、12px 圆角、50px 高；禁用态降低透明度并取消可点击光标。
- **Public:** 墨色/纸白反转胶囊，48px 高；用于“了解 LifeOps”和公开收束动作。
- **Focus:** 2px 行动蓝外轮廓，偏移 3px；不能只依赖颜色变化。

### Inputs / Fields

- **Style:** 透明底、单条底线，字段标签直接说明用途。
- **Focus:** 底线切换为行动蓝；登录输入额外保留清晰外轮廓。
- **Disabled:** 保持内容可读，主要提交按钮同步显式禁用。

### Navigation

- 顶部导航在所有私人路由稳定存在；活动项使用墨色字重和 2px 蓝色底线。
- 桌面显示搜索快捷键和“快速记录”；移动端收敛为两个 44px 图形操作，文本导航仍完整可读。

### Public Semantic Objects

五个对象复用可见 SVG 路径作为 CSS offset-path。每个对象有独立速度、起点、手工 SVG 图形和克制的语义色；对象链接与轨迹数据不得分叉。

### Day Timeline

时间刻度、当前时间线、计划条目和右侧证据摘要构成私人首屏。空状态提供可执行方向，不伪造用户计划或历史。

### Life Workspace

生活专区沿用同一个日光指挥台，通过“今日｜日历｜计划｜资料库｜采购｜分析”紧凑命令条组织任务。角落日历是持续时间入口；今日时间线为主，营养/预算为次，库存与采购只在可行动时抬高。资料库、食谱关系、周计划和分析使用最适合数据的列表、时间画布、关系图+列表或图表+表格，不共享等大卡片模板。预测/实际、现金支出/消耗成本、无记录/零值必须以文字和形态共同区分。

### Login Window

登录窗是唯一长期使用磨砂玻璃的界面：固定在公开页右侧，打开后立即聚焦账号框，Tab 焦点被限定在窗口内，Esc 关闭。透明度/位移参与过渡，`visibility` 不参与延迟以保证真实浏览器可聚焦。

## Do's and Don'ts

### Do:

- **Do** 让每个功能使用最适合它的数据形态：计划列表、记录时间流、回顾证据、知识搜索和发布预览。
- **Do** 用 View Transition 与 220–280ms CSS 过渡解释路由和浮层变化。
- **Do** 在 `prefers-reduced-motion` 下停止连续轨迹并把过渡压缩到近即时。
- **Do** 让公开副本明确选择标题和摘录，并始终保留撤回后的不可访问状态。

### Don't:

- **Don't** 把私人区改回星球、深色宇宙或“左侧功能栏 + 右侧卡片墙”。
- **Don't** 在标题上方添加英文眉题、渐变文字、装饰编号或伪技术标签。
- **Don't** 为了填满空白伪造个人数据、指标或商业成绩。
- **Don't** 让鼠标滚轮接管路由；滚轮只负责正常文档滚动，进入对象必须点击。
- **Don't** 在常驻页面上堆玻璃卡片、阴影矩阵或同尺寸功能卡。
