import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, BookmarkStart, BookmarkEnd, BorderStyle, Document, Footer, Header,
  HeadingLevel, ImageRun, ImportedXmlComponent, Packer, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType, convertInchesToTwip,
} from "docx";

const T = String.raw;

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: node create.js /absolute/path/output.docx");

const assetDir = path.join(path.dirname(outputPath), "report-assets");
const img = (name) => fs.readFileSync(path.join(assetDir, name));

// ---------- fonts & helpers ----------
const bodyFont = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "SimSun" };
const headFont = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "SimHei" };

const INK = "3A3632";      // 暖墨色正文
const ACCENT = "8C5B3F";   // 低饱和赭棕(校徽暖调)
const SOFT = "A8978A";     // 浅暖灰
const BAND = "F4EEE8";     // 表头浅暖底

const run = (text, options = {}) => new TextRun({ text, font: bodyFont, size: 24, color: INK, ...options });
const para = (children, options = {}) => new Paragraph({
  spacing: { after: 160, line: 320 },
  ...options,
  children: Array.isArray(children) ? children : [children],
});

const p = (text) => para(run(text), { indent: { firstLine: convertInchesToTwip(0.33) } });
const bullet = (text) => para(run(text), {
  indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.18) },
  spacing: { after: 80, line: 320 },
  children: [run(T`◆ `, { color: ACCENT }), run(text)],
});

const h1 = (text) => para(run(text, { bold: true, size: 32, font: headFont, color: ACCENT }), {
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 200 },
});
const h2 = (text) => para(run(text, { bold: true, size: 27, font: headFont, color: INK }), {
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 140 },
});

const figure = (name, width, height, caption) => [
  para(new ImageRun({ type: "png", data: img(name), transformation: { width, height } }), {
    alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 },
  }),
  para(run(caption, { size: 20, color: SOFT, italics: true }), {
    alignment: AlignmentType.CENTER, spacing: { after: 220 },
  }),
];

// ---------- TOC ----------
const xmlEscape = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const toc = (entries) => {
  const cached = entries.map(({ title, level, page }) => {
    const indent = Math.max(0, level - 1) * 360;
    return `<w:p><w:pPr><w:pStyle w:val="TOC${level}"/>
      <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
      <w:ind w:left="${indent}"/></w:pPr>
      <w:r><w:t>${xmlEscape(title)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r></w:p>`;
  }).join("");
  return ImportedXmlComponent.fromXmlString(`<w:sdt xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:sdtPr><w:alias w:val="目录"/></w:sdtPr>
    <w:sdtContent>
      <w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>
        <w:instrText xml:space="preserve"> TOC \\o &quot;1-2&quot; \\h \\z \\u </w:instrText>
        <w:fldChar w:fldCharType="separate"/></w:r></w:p>
      ${cached}
      <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    </w:sdtContent>
  </w:sdt>`).root[0];
};

// ---------- table ----------
const widths = [2600, 6600];
const cell = (text, options = {}) => new TableCell({
  children: [para(run(text, options.bold ? { bold: true } : {}), { spacing: { after: 40, line: 280 } })],
  margins: { top: 100, bottom: 100, left: 140, right: 140 },
  ...options.cell,
});
const dataTable = (rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  columnWidths: widths,
  rows: rows.map(([k, v], i) => new TableRow({
    children: [
      cell(k, {
        bold: true,
        cell: { shading: { type: ShadingType.CLEAR, fill: BAND }, width: { size: widths[0], type: WidthType.DXA } },
      }),
      cell(v, { cell: { width: { size: widths[1], type: WidthType.DXA } } }),
    ],
  })),
});

// ---------- document ----------
const children = [];

// 封面
children.push(
  para(run(T`商大元境 · CampusTwin X`, { bold: true, size: 56, font: headFont, color: ACCENT }), {
    alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 240 },
  }),
  para(run(T`浙江工商大学下沙校区 3D 数字孪生智能平台`, { bold: true, size: 36, font: headFont, color: INK }), {
    alignment: AlignmentType.CENTER, spacing: { after: 160 },
  }),
  para(run(T`系 统 介 绍`, { size: 30, font: headFont, color: SOFT }), {
    alignment: AlignmentType.CENTER, spacing: { after: 2400 },
  }),
  para(run(T`汇报单位:信电(人工智能)学院`, { size: 26 }), { alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
  para(run(T`汇报人:诸葛斌、蒋献、陈俊烨等研究生团队`, { size: 26, bold: true }), { alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
  para(run(T`2026 年 8 月`, { size: 24, color: SOFT }), { alignment: AlignmentType.CENTER, spacing: { after: 480 } }),
  new Paragraph({ children: [], pageBreakBefore: true }),
);

// 目录
children.push(
  para(run(T`目  录`, { bold: true, size: 32, font: headFont, color: ACCENT }), { alignment: AlignmentType.CENTER, spacing: { after: 240 } }),
  toc([
    { title: T`一、系统概况`, level: 1, page: 2 },
    { title: T`二、核心功能`, level: 1, page: 3 },
    { title: T`2.1 真实 3D 校园与地标精模`, level: 2, page: 3 },
    { title: T`2.2 昼夜与气象仿真`, level: 2, page: 4 },
    { title: T`2.3 AI 一句话指挥台`, level: 2, page: 5 },
    { title: T`2.4 房间级点对点定位与楼宇分层`, level: 2, page: 6 },
    { title: T`2.5 多端兼容`, level: 2, page: 7 },
    { title: T`三、技术架构`, level: 1, page: 8 },
    { title: T`四、应用场景与价值`, level: 1, page: 9 },
    { title: T`五、后续规划`, level: 1, page: 10 },
  ]),
  new Paragraph({ children: [], pageBreakBefore: true }),
);

// 一、系统概况
children.push(h1(T`一、系统概况`));
children.push(p(T`“商大元境 · CampusTwin X”是面向浙江工商大学下沙校区建设的三维数字孪生智能服务平台。系统以真实地理数据为底座,在浏览器中原样复刻了下沙校区的建筑、道路、水系、绿化与地标,并在此基础上叠加了真实太阳昼夜光照、气象仿真、人流能耗模拟与 AI 自然语言指挥能力,实现“看校园、找房间、办事务”的一站式沉浸体验。用户无需安装任何软件,通过浏览器访问即可进入校园三维场景。`));
children.push(dataTable([
  [T`系统名称`, T`商大元境 · CampusTwin X(浙江工商大学下沙校区 3D 数字孪生智能平台)`],
  [T`覆盖范围`, T`下沙校区全域:422 栋楼宇(87 栋实名)、160 条道路、19 段水系、733 棵树木、21 处校园地标`],
  [T`房间数据`, T`510 个房间 / 21 栋楼,房间编号对齐校方真实用法(如综合大楼九楼第三会议室)`],
  [T`访问方式`, T`浏览器直接访问 http://43.166.169.80:8888/ ,支持电脑、平板、手机`],
  [T`技术栈`, T`React 19 + TypeScript + Three.js + WebGL,云端 Docker + Nginx 部署`],
]));
children.push(...figure("user-3.png", 550, 310, T`图 1  系统日景全景:综合大楼、图书馆等校园地标真实还原`));

// 二、核心功能
children.push(h1(T`二、核心功能`));

children.push(h2(T`2.1 真实 3D 校园与地标精模`));
children.push(p(T`系统对校园 422 栋建筑进行了逐一建模,并对标志性建筑做了局部精细化还原:综合大楼为 12 层、高 51 米的新月形弧板造型,楼前还原了真实的玻璃金字塔采光顶(地下空间采光井);南门“飞翔门”、北门“地球门”(凯旋门与自转地球仪)、图书馆、信电楼、文体中心等师生熟悉的地标均按实景建模,可 360° 环绕查看。`));
children.push(bullet(T`综合大楼:12 层新月形弧板 + 楼前玻璃金字塔采光顶,学校门户形象真实呈现`));
children.push(bullet(T`南校门“飞翔门”、北校门“地球门”:按实景照片建模的校园入口地标`));
children.push(bullet(T`图书馆、信电楼、文体中心等 87 栋实名建筑,悬挂可点击的三维标牌`));

children.push(h2(T`2.2 昼夜与气象仿真`));
children.push(p(T`系统内置基于真实天文算法(suncalc)的太阳位置引擎,按校园所处经纬度实时计算太阳高度角与方位角,完整模拟黎明、白天、黄昏、夜晚四个时段的光照变化:黎明晨光熹微、白昼明朗、黄昏霞光浸染、夜晚楼宇灯火通明。支持手动切换时段,也支持“自动”模式以 600 倍速循环演绎完整的一天。同时提供晴、雨、雪、雾四种天气效果,营造不同气象条件下的校园氛围。`));
children.push(...figure("shot-dusk.png", 480, 270, T`图 2  黄昏时分:夕阳低角度照射下的校园全景`));
children.push(...figure("m3-黑夜模式.png", 480, 270, T`图 3  夜晚模式:全楼宇灯光点亮的校园夜景`));

children.push(h2(T`2.3 AI 一句话指挥台`));
children.push(p(T`系统内置 AI 指挥台,师生只需用一句自然语言下达指令,系统即可自动完成“理解意图 — 检索数据 — 镜头飞行 — 结果呈现”的完整闭环。目前已支持四大类指令:`));
children.push(bullet(T`找空间:如“帮我找一个综合楼的会议室”,自动检索空闲会议室并飞抵目标房间`));
children.push(bullet(T`报修:如“我要报修”,自动定位设备位置、生成工单并指派处理`));
children.push(bullet(T`看态势:如“看看现在校园态势”,拉升至上帝视角,呈现人流、能耗、事件总览`));
children.push(bullet(T`逛校园:如“带我逛校园”,自动规划路线进行开场运镜式导览`));
children.push(p(T`指挥台同时支持语音输入,方便移动端使用。指令解析准确率经回归测试达 45/45,四条链路端到端测试 17/17 全部通过。`));
children.push(...figure("user-1.png", 550, 310, T`图 4  AI 指挥台执行“帮我找一个综合楼的会议室”:左侧指令链、右侧空间预约面板`));

children.push(h2(T`2.4 房间级点对点定位与楼宇分层`));
children.push(p(T`系统已完成 21 栋楼、510 个房间的室内空间建模,房间编号与学校实际使用编号一致。点击任意建筑即可将其“解剖”为逐层展开的分层视图,每层房间按真实布局排布;点击房间或发起预约、报修、导航时,镜头将以“楼宇定位 — 楼层剖切 — 房间聚焦”三段式运镜精确飞抵目标(如 5 楼 501),实现真正的点对点定位。`));
children.push(...figure("user-2.png", 550, 308, T`图 5  信电楼分层爆炸视图:6 层逐层展开,房间级标注与信息卡`));
children.push(...figure("ctx-m44-zonghe.png", 550, 309, T`图 6  综合大楼 12 层剖切视图:可预约房间直接呈现(如九楼第三会议室)`));

children.push(h2(T`2.5 多端兼容`));
children.push(p(T`系统采用响应式设计,同一网址在电脑、平板、手机上均可流畅访问。移动端自动切换为沉浸视图并优化触控交互与侧边栏收纳,方便师生在手机上随时随地查询空间、提交报修。`));
children.push(...figure("ctx-mobile.png", 170, 368, T`图 7  手机端沉浸视图:侧边栏自动收纳,触控操作`));

// 三、技术架构
children.push(h1(T`三、技术架构`));
children.push(p(T`系统采用“数据烘焙 — 三维渲染 — 智能服务”三层架构,全部基于开源技术栈构建,不依赖任何商业引擎授权:`));
children.push(bullet(T`数据层:基于 OpenStreetMap 真实地理数据的自动化烘焙管线,批量生成校园建筑轮廓、道路网与水系;自研楼层布局引擎按校方编号规则生成 510 个房间的室内布局`));
children.push(bullet(T`渲染层:React 19 + TypeScript + Three.js(R3F)+ WebGL 实例化渲染,422 栋建筑、700 余棵树木流畅呈现;zustand 状态管理,ECharts 态势图表`));
children.push(bullet(T`智能层:AI 指令解析引擎将自然语言映射为镜头动作与数据查询,数据源适配层已预留课表、预约、工单等真实业务系统的接入接口`));
children.push(bullet(T`部署层:Docker + Nginx 容器化部署于云服务器(43.166.169.80:8888),支持持续集成更新与版本回退,代码托管于 GitHub`));

// 四、应用场景与价值
children.push(h1(T`四、应用场景与价值`));
children.push(p(T`系统立足校园真实业务场景,可为学校的教学、管理与服务工作提供直接支撑:`));
children.push(bullet(T`教学空间管理:会议室、教室、实验室的查询、预约与室内导航一体化,新生与访客“找房不再难”`));
children.push(bullet(T`后勤报修:报修时自动定位设备所在楼宇、楼层与房间,工单处理进度在三维场景中实时可视`));
children.push(bullet(T`迎新导览与校园宣传:AI 语音导览 + 地标精模,成为新生入学教育和对外展示的数字化窗口`));
children.push(bullet(T`校园态势感知:上帝视角实时总览人流分布、能耗曲线与事件告警,辅助管理决策与应急指挥`));

// 五、后续规划
children.push(h1(T`五、后续规划`));
children.push(bullet(T`接入真实数据:对接学校统一身份认证、课表系统、会议室预约系统与后勤工单系统,从演示数据升级为真实业务数据`));
children.push(bullet(T`深化智能服务:扩展更多自然语言指令场景,引入大模型实现更开放的校园问答`));
children.push(bullet(T`校内试点推广:在信电(人工智能)学院先行试用,收集师生反馈后逐步面向全校推广`));
children.push(p(T`以上汇报,恳请各位老师、领导批评指正。`, ), );

const doc = new Document({
  features: { updateFields: true },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [para(
      run(T`商大元境 · CampusTwin X —— 浙江工商大学下沙校区 3D 数字孪生智能平台`, { size: 18, color: SOFT }),
      { alignment: AlignmentType.CENTER, spacing: { after: 40 } },
    )] }) },
    footers: { default: new Footer({ children: [para(
      new TextRun({ children: [PageNumber.CURRENT], font: bodyFont, size: 18, color: SOFT }),
      { alignment: AlignmentType.CENTER },
    )] }) },
    children,
  }],
});

fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
console.log("Wrote:", outputPath);
