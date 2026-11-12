// 核心逻辑测试：从 index.html 提取 CORE 段，在 Node 中直接运行。
// 运行：node tests/test-core.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");
const m = /\/\* CORE-START \*\/([\s\S]*?)\/\* CORE-END \*\//.exec(html);
assert.ok(m, "index.html 中必须存在 CORE-START/CORE-END 标记");
const core = new Function(m[1] + "\nreturn BookmarksCore;")();
const { parseNetscapeBookmarks, parseChromeBookmarksJSON, classifyOne,
        classifyBookmarks, buildExportHTML, stripRootFolder, hostOf } = core;

let passed = 0;
function t(name, fn){ fn(); passed++; console.log("PASS", name); }

/* ---------- 1. Netscape HTML 解析 ---------- */
const NETSCAPE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://github.com/" ADD_DATE="1700000001">GitHub</A>
        <DT><H3>前端</H3>
        <DL><p>
            <DT><A HREF="https://react.dev/?a=1&amp;b=2" ADD_DATE="2">React &amp; 文档</A>
        </DL><p>
        <DT><A HREF="https://www.taobao.com/" ICON="data:image/png;base64,iVBORw0KGgo=">淘宝</A>
    </DL><p>
    <DT><H3>其他书签</H3>
    <DL><p>
        <DT><A HREF="https://unknown-longtail-site.example.org/page">一个冷门站</A>
    </DL><p>
</DL><p>
`;

t("Netscape: 解析出 4 条书签", () => {
  const items = parseNetscapeBookmarks(NETSCAPE);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(i => i.title), ["GitHub", "React & 文档", "淘宝", "一个冷门站"]);
});

t("Netscape: URL 实体解码", () => {
  const items = parseNetscapeBookmarks(NETSCAPE);
  assert.equal(items[1].url, "https://react.dev/?a=1&b=2");
});

t("Netscape: 嵌套文件夹路径，且剥离根目录名", () => {
  const items = parseNetscapeBookmarks(NETSCAPE);
  assert.equal(items[0].folder, "");            // 书签栏 根下
  assert.equal(items[1].folder, "前端");         // 书签栏/前端
  assert.equal(items[2].folder, "");            // 书签栏 根下
  assert.equal(items[3].folder, "");            // 其他书签 根下
});

t("Netscape: 无标题时回退为 URL", () => {
  const items = parseNetscapeBookmarks(
    `<DL><p><DT><A HREF="https://example.com/x">Example</A></DL><p>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Example");
});

/* ---------- 2. 根目录名剥离 ---------- */
t("stripRootFolder: 中英文根目录名", () => {
  assert.equal(stripRootFolder("书签栏/工作/前端"), "工作/前端");
  assert.equal(stripRootFolder("Other bookmarks/reading"), "reading");
  assert.equal(stripRootFolder("工作/前端"), "工作/前端");
  assert.equal(stripRootFolder(""), "");
});

/* ---------- 3. Chrome Bookmarks JSON 解析 ---------- */
const JSON_FILE = JSON.stringify({
  roots: {
    bookmark_bar: {
      name: "书签栏", type: "folder", children: [
        { name: "GitHub", type: "url", url: "https://github.com/" },
        { name: "开发", type: "folder", children: [
          { name: "MDN", type: "url", url: "https://developer.mozilla.org/zh-CN/" }
        ]}
      ]
    },
    other: {
      name: "其他书签", type: "folder", children: [
        { name: "冷门站", type: "url", url: "https://foo.example.net/" }
      ]
    }
  }
});

t("Bookmarks JSON: 解析嵌套与多根", () => {
  const items = parseChromeBookmarksJSON(JSON_FILE);
  assert.equal(items.length, 3);
  assert.equal(items[0].folder, "");
  assert.equal(items[1].folder, "开发");
  assert.equal(items[2].folder, "");
  assert.equal(items[2].url, "https://foo.example.net/");
});

/* ---------- 4. 分类规则 ---------- */
const cases = [
  ["https://chatgpt.com/", "ai"],
  ["https://chat.deepseek.com/", "ai"],
  ["https://github.com/", "dev"],
  ["https://gist.github.com/", "dev"],          // 子域名后缀匹配
  ["https://developer.mozilla.org/zh-CN/", "docs"],
  ["https://www.zhihu.com/", "social"],
  ["https://www.bilibili.com/video/BV1xx", "video"],
  ["https://m.bilibili.com/", "video"],         // m. 子域名
  ["https://36kr.com/", "news"],
  ["https://www.taobao.com/", "shop"],
  ["https://www.figma.com/files", "design"],
  ["https://www.feishu.cn/docx/abc", "work"],
  ["https://xueqiu.com/S/SH600000", "finance"],
  ["https://www.meituan.com/", "life"],
  ["https://v.qq.com/x/cover/x.html", "video"], // v.qq.com 优先于门户类规则
];
for (const [url, cat] of cases) {
  t(`classifyOne: ${url} → ${cat}`, () => {
    assert.equal(classifyOne(url, ""), cat);
  });
}

t("classifyOne: 文件夹提示兜底（域名未命中）", () => {
  assert.equal(classifyOne("https://unknown.example.org/", "书签栏/购物清单"), "shop");
  assert.equal(classifyOne("https://unknown.example.org/", "理财/待看"), "finance");
});

t("classifyOne: 完全未命中 → other", () => {
  assert.equal(classifyOne("https://totally-unknown.example.com/", ""), "other");
});

/* ---------- 5. 汇总分组 ---------- */
t("classifyBookmarks: 分组、计数与顺序（其他在最后）", () => {
  const items = [
    { title: "GitHub", url: "https://github.com/", folder: "" },
    { title: "A", url: "https://chatgpt.com/", folder: "" },
    { title: "B", url: "https://unknown.example.org/", folder: "" },
    { title: "C", url: "https://bilibili.com/", folder: "" }
  ];
  const groups = classifyBookmarks(items);
  assert.deepEqual(groups.map(g => g.id), ["ai", "dev", "video", "other"]);
  assert.equal(groups.find(g => g.id === "dev").items.length, 1);
  assert.equal(groups.find(g => g.id === "other").items[0].title, "B");
});

t("classifyBookmarks: 手动分类覆盖优先于规则", () => {
  const items = [
    { title: "GitHub", url: "https://github.com/", folder: "" },
    { title: "B站", url: "https://bilibili.com/", folder: "" }
  ];
  const groups = classifyBookmarks(items, { "https://github.com/": "shop", "https://bilibili.com/": "finance" });
  assert.deepEqual(groups.map(g => g.id), ["shop", "finance"], "覆盖后按 CATEGORY_DEFS 固定顺序输出");
  assert.equal(groups.find(g => g.id === "shop").items[0].title, "GitHub");
});

t("classifyBookmarks: 自定义分类（覆盖命中、空也保留、位于其他之前）", () => {
  const custom = [{ id: "c_x", name: "我的私藏", color: "#0ea5e9" }];
  /* 覆盖到自定义分类 */
  const g1 = classifyBookmarks(
    [{ title: "GitHub", url: "https://github.com/", folder: "" }],
    { "https://github.com/": "c_x" }, custom);
  assert.deepEqual(g1.map(g => g.id), ["c_x"], "覆盖后仅自定义分类非空");
  assert.equal(g1[0].items[0].title, "GitHub");
  /* 空的自定义分类也保留，排在内置之后、其他之前 */
  const g2 = classifyBookmarks(
    [{ title: "GitHub", url: "https://github.com/", folder: "" }], {}, custom);
  assert.deepEqual(g2.map(g => g.id), ["dev", "c_x"], "空自定义分类保留");
  const g3 = classifyBookmarks(
    [{ title: "冷门站", url: "https://unknown.example.org/", folder: "" }], {}, custom);
  assert.deepEqual(g3.map(g => g.id), ["c_x", "other"], "自定义分类位于其他之前");
});

t("buildExportHTML: 空分组（空自定义分类）不导出", () => {
  const groups = classifyBookmarks(
    [{ title: "冷门站", url: "https://unknown.example.org/", folder: "" }],
    {}, [{ id: "c_x", name: "空分类", color: "#0ea5e9" }]);
  const out = buildExportHTML(groups, { title: "t" });
  assert.ok(!out.includes("空分类"), "空自定义分类不出现在导出页");
  assert.ok(out.includes("其他"));
  assert.ok(out.includes("共 1 条书签"));
});

/* ---------- 6. 导出 HTML ---------- */
t("buildExportHTML: 含分类标题、链接、搜索框与转义", () => {
  const items = [
    { title: "GitHub <测试>", url: "https://github.com/?q=1&x=2", folder: "开发" },
    { title: "淘宝", url: "https://www.taobao.com/", folder: "" }
  ];
  const out = buildExportHTML(classifyBookmarks(items), { title: "测试导出" });
  assert.ok(out.includes("<!DOCTYPE html>"));
  assert.ok(out.includes("开发工具"));
  assert.ok(out.includes("购物电商"));
  assert.ok(out.includes("GitHub &lt;测试&gt;"));
  assert.ok(out.includes('href="https://github.com/?q=1&amp;x=2"'));
  assert.ok(out.includes("共 2 条书签"));
  assert.ok(out.includes('id="q"'), "导出页必须带搜索框");
  assert.ok(out.includes("<script>"), "导出页必须带搜索过滤脚本");
  assert.ok(out.includes("auto-fill,minmax(170px,1fr)"), "导出页自适应网格");
  assert.ok(out.includes('data-s="github &lt;'), "li 预置小写检索串");
});

/* ---------- 7. hostOf ---------- */
t("hostOf: 去协议、去 www、大小写", () => {
  assert.equal(hostOf("https://WWW.Example.COM/path"), "example.com");
  assert.equal(hostOf("https://a.b.example.com/"), "a.b.example.com");
});

console.log(`\n全部通过：${passed} 个测试。`);
