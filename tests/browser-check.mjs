// 浏览器端到端交互验证（puppeteer-core + 系统 Chromium）
// 运行：node /home/gem/.aily/workdir/task_7705805960652016671/web-delivery/tests/browser-check.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + join(__dirname, "..", "index.html");
const outDir = join(__dirname, "..", ".preview", "browser");
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));

const results = [];
function ok(name, cond, extra = "") {
  results.push([cond ? "PASS" : "FAIL", name + (extra ? " | " + extra : "")]);
  if (!cond) process.exitCode = 1;
}
async function shot(name, w) {
  if (w) await page.setViewport({ width: w, height: 900 });
  await page.screenshot({ path: join(outDir, name + ".png"), fullPage: w === undefined ? true : false });
}
async function freshPage() {
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
}

/* ========== 阶段 A：布局 / 搜索 / 筛选 / 折叠 / 导入 / 导出 ========== */
await page.setViewport({ width: 1280, height: 900 });
await freshPage();

/* 1. 初始状态：横幅不显示、空态可见（清空 localStorage 后无残留恢复） */
const initialHidden = await page.$eval("#sampleBanner", el => el.hidden);
const emptyVisible = await page.$eval("#emptyState", el => !el.hidden);
const lsClean = await page.evaluate(() => localStorage.length === 0);
ok("初始状态：示例横幅隐藏", initialHidden === true);
ok("初始状态：三步引导可见", emptyVisible === true);
ok("初始状态：localStorage 已清空无残留恢复", lsClean === true);
await shot("01-initial-desktop");

/* 2. 点击「加载示例数据」 */
await page.click("#btnSample");
await page.waitForFunction(() => !document.getElementById("statsSection").hidden);
const statTotal = await page.$eval("#statTotal", el => el.textContent);
const bannerShown = await page.$eval("#sampleBanner", el => !el.hidden);
ok("示例数据：总数统计正确（期望 72）", statTotal === "72", "实际 " + statTotal);
ok("示例数据：示例横幅显示", bannerShown === true);
const chipCount = await page.$$eval("#chips .chip", els => els.length);
ok("示例数据：分类 chips 渲染", chipCount >= 10, "chips=" + chipCount);
await shot("02-sample-desktop");

/* 2.5 自适应网格：桌面多列、窄屏列数收缩、卡片紧凑 */
const cols1280 = await page.$eval("#results section.cat .grid", el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
ok("桌面 1280px：自适应网格 ≥6 列", cols1280 >= 6, "cols=" + cols1280);
const cardW = await page.$eval("#results section.cat .card", el => el.getBoundingClientRect().width);
ok("卡片紧凑（宽度 < 200px）", cardW < 200, "width=" + cardW.toFixed(0));
await page.setViewport({ width: 640, height: 900 });
await new Promise(r => setTimeout(r, 200));
const cols640 = await page.$eval("#results section.cat .grid", el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
ok("窄屏 640px：列数随屏幕收缩", cols640 >= 2 && cols640 < cols1280, "cols640=" + cols640 + " cols1280=" + cols1280);
await page.setViewport({ width: 1280, height: 900 });

/* 3. 搜索 */
await page.type("#searchInput", "figma");
await new Promise(r => setTimeout(r, 300));
const cards = await page.$$eval("#results .card", els => els.length);
ok("搜索 figma：命中卡片", cards >= 1, "cards=" + cards);
await shot("03-search");
await page.$eval("#searchInput", el => { el.value = ""; el.dispatchEvent(new Event("input")); });
await page.type("#searchInput", "不存在的关键词xyzq");
await new Promise(r => setTimeout(r, 200));
const noRes = await page.$eval("#results", el => el.textContent.includes("没有匹配"));
ok("搜索无结果：空态提示", noRes);
await page.$eval("#searchInput", el => { el.value = ""; el.dispatchEvent(new Event("input")); });

/* 4. 分类筛选 chip */
await page.evaluate(() => {
  const chips = [...document.querySelectorAll("#chips .chip")];
  const c = chips.find(x => x.textContent.includes("AI 工具"));
  if (c) c.click();
});
await new Promise(r => setTimeout(r, 200));
const aiOnly = await page.$$eval("#results section.cat h2", els => els.map(e => e.textContent));
ok("筛选 AI 工具：仅显示该分类", aiOnly.length === 1 && aiOnly[0].includes("AI 工具"), JSON.stringify(aiOnly));
const pressed = await page.$$eval("#chips .chip[aria-pressed='true']", els => els.length);
ok("筛选状态：aria-pressed 唯一", pressed === 1);
await shot("04-filter-ai");
await page.evaluate(() => document.querySelectorAll("#chips .chip")[0].click()); /* 回到全部 */

/* 5. 折叠 */
const firstSec = await page.$("#results section.cat h2 button");
await firstSec.click();
const collapsed = await page.$eval("#results section.cat", el => el.classList.contains("collapsed"));
const ariaExp = await page.$eval("#results section.cat h2 button", el => el.getAttribute("aria-expanded"));
ok("折叠分类", collapsed === true && ariaExp === "false");

/* 6. 拖拽导入真实 Netscape 格式文件（模拟 drop 事件，走完整解析路径） */
const NETSCAPE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://github.com/">GitHub</A>
        <DT><H3>理财</H3>
        <DL><p>
            <DT><A HREF="https://totally-unknown-fund.example.org/">冷门基金站</A>
        </DL><p>
    </DL><p>
</DL><p>
`;
const dropped = await page.evaluate(async (html) => {
  const file = new File([html], "bookmarks.html", { type: "text/html" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const dz = document.getElementById("dropzone");
  dz.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 400));
  return {
    total: document.getElementById("statTotal").textContent,
    banner: document.getElementById("sampleBanner").hidden,
    cats: [...document.querySelectorAll("#results section.cat h2")].map(e => e.textContent.trim().split("\n")[0]),
  };
}, NETSCAPE);
ok("拖拽导入：解析出 2 条", dropped.total === "2", "total=" + dropped.total);
ok("拖拽导入：真实数据模式（示例横幅隐藏）", dropped.banner === true);
ok("拖拽导入：域名规则命中开发工具", dropped.cats.some(c => c.includes("开发工具")), JSON.stringify(dropped.cats));
ok("拖拽导入：文件夹提示命中金融理财", dropped.cats.some(c => c.includes("金融理财")), JSON.stringify(dropped.cats));
await shot("05-dropped");

/* 7. JSON 导入（Bookmarks JSON 路径） */
const chromeJSON = JSON.stringify({ roots: { bookmark_bar: { name: "书签栏", type: "folder", children: [
  { name: "B站", type: "url", url: "https://www.bilibili.com/" },
  { name: "开发", type: "folder", children: [ { name: "MDN", type: "url", url: "https://developer.mozilla.org/" } ] }
]}}});
const jsonRes = await page.evaluate(async (txt) => {
  const file = new File([txt], "Bookmarks", { type: "application/json" });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById("dropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 400));
  return {
    total: document.getElementById("statTotal").textContent,
    cats: [...document.querySelectorAll("#results section.cat h2")].map(e => e.textContent.trim().split("\n")[0]),
  };
}, chromeJSON);
ok("JSON 导入：解析出 2 条", jsonRes.total === "2", "total=" + jsonRes.total);
ok("JSON 导入：视频/文档分类命中", jsonRes.cats.some(c => c.includes("视频与娱乐")) && jsonRes.cats.some(c => c.includes("技术文档与学习")), JSON.stringify(jsonRes.cats));

/* 8. 错误文件类型 */
const badRes = await page.evaluate(async () => {
  const file = new File(["x"], "data.txt", { type: "text/plain" });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById("dropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 200));
  const err = document.getElementById("errorBanner");
  return { shown: !err.hidden, msg: err.textContent.slice(0, 30) };
});
ok("错误类型：提示且不崩", badRes.shown, badRes.msg);

/* 9. 导出（核心函数直调，验证内容可读） */
const downloadRes = await page.evaluate(() => {
  return new Promise((resolve) => {
    const html = window.BookmarksCore.buildExportHTML(
      window.BookmarksCore.classifyBookmarks([{title:"GitHub",url:"https://github.com/",folder:""}]),
      {title:"t"});
    resolve({ len: html.length, hasDoctype: html.startsWith("<!DOCTYPE html>"), hasCat: html.includes("开发工具"), hasAutoGrid: html.includes("auto-fill,minmax(170px,1fr)") });
  });
});
ok("导出 HTML 生成", downloadRes.hasDoctype && downloadRes.hasCat, "len=" + downloadRes.len);
ok("导出 HTML 使用自适应网格", downloadRes.hasAutoGrid === true);

/* 9.5 导出页端到端：自适应网格 + 搜索过滤 */
const exportPageHtml = await page.evaluate(() => {
  return window.BookmarksCore.buildExportHTML(
    window.BookmarksCore.classifyBookmarks([
      {title:"GitHub", url:"https://github.com/", folder:"开发"},
      {title:"淘宝", url:"https://www.taobao.com/", folder:""},
      {title:"冷门站", url:"https://unknown.example.org/", folder:""}
    ]), {title:"导出页测试"});
});
const exportFile = join(outDir, "export-test.html");
writeFileSync(exportFile, exportPageHtml, "utf8");
await page.goto("file://" + exportFile, { waitUntil: "load" });
const expCols = await page.$eval("ul", el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
ok("导出页 1280px：自适应网格 ≥6 列", expCols >= 6, "cols=" + expCols);
await page.setViewport({ width: 390, height: 844 });
await new Promise(r => setTimeout(r, 200));
const expColsNarrow = await page.$eval("ul", el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
ok("导出页 390px：列数随屏幕收缩", expColsNarrow >= 1 && expColsNarrow < expCols, "narrow=" + expColsNarrow);
await page.setViewport({ width: 1280, height: 900 });
const expSearchVisible = await page.$eval("#q", el => el.offsetParent !== null);
ok("导出页：搜索框可见", expSearchVisible);
await page.type("#q", "github");
await new Promise(r => setTimeout(r, 200));
const expCount = await page.$eval("#count", el => el.textContent);
ok("导出页：搜索过滤生效", expCount.includes("1 / 3"), "count=" + expCount);
const expShown = await page.$$eval("h2:not(.hide)", els => els.map(e => e.textContent.trim()));
ok("导出页：仅命中分类显示", expShown.length === 1 && expShown[0].includes("开发工具"), JSON.stringify(expShown));

/* ========== 阶段 B：编辑功能（右键拖拽 / 删除撤销 / 新增 / 刷新保留 / 清空重来） ========== */
await freshPage();
await page.setViewport({ width: 1280, height: 900 });
await page.click("#btnSample");
await page.waitForFunction(() => !document.getElementById("statsSection").hidden);

/* B1. 新增书签：空网址被拦截 → 正常新增落到所选分类 */
await page.click("#btnAdd");
const formVisible = await page.$eval("#addForm", el => !el.hidden);
ok("新增：表单展开", formVisible === true);
const catOptions = await page.$$eval("#addCat option", els => els.length);
ok("新增：分类下拉覆盖全部类别", catOptions === 12, "options=" + catOptions);
await page.click("#addForm button[type='submit']"); /* 空网址提交 */
const emptyUrlErr = await page.$eval("#addErr", el => el.textContent);
ok("新增：空网址被拦截并提示", emptyUrlErr.length > 0, JSON.stringify(emptyUrlErr));
await page.evaluate(() => {
  document.getElementById("addTitle").value = "测试新增站";
  document.getElementById("addUrl").value = "https://test-new.example.com/";
  document.getElementById("addCat").value = "shop";
  document.getElementById("addForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const added = await page.evaluate(() => {
  const shop = document.querySelector('#results section.cat[data-cat="shop"]');
  return {
    inShop: !!shop && shop.textContent.includes("测试新增站"),
    total: document.getElementById("statTotal").textContent,
    toast: document.getElementById("toast").classList.contains("show"),
    formHidden: document.getElementById("addForm").hidden,
  };
});
ok("新增：书签落入所选分类「购物电商」", added.inShop === true);
ok("新增：总数 72 → 73", added.total === "73", "total=" + added.total);
ok("新增：toast 反馈且表单收起", added.toast === true && added.formHidden === true);
await shot("07-add-done");

/* B2. 右键拖拽移动：把「开发工具」里的 GitHub 拖到「AI 工具」分类 */
await page.evaluate(() => {
  /* 新增后自动切到了所选分类筛选，先回到「全部」 */
  const all = document.querySelector("#chips .chip");
  if (all) all.click();
});
await new Promise(r => setTimeout(r, 200));
const dragRes = await page.evaluate(() => {
  const src = [...document.querySelectorAll('#results section.cat[data-cat="dev"] .card')]
    .find(c => c.textContent.includes("GitHub"));
  const dst = document.querySelector('#results section.cat[data-cat="ai"]');
  if (!src || !dst) return { skip: true };
  dst.scrollIntoView({ block: "center" });
  const r1 = src.getBoundingClientRect(), r2 = dst.getBoundingClientRect();
  /* 确保两个坐标都在视口内（AI 与开发是相邻分类，一般同屏可见） */
  const startY = Math.min(Math.max(r1.top + 10, 5), innerHeight - 5);
  const endY = Math.min(Math.max(r2.top + 24, 5), innerHeight - 5);
  const mk = (type, x, y) => new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: x, clientY: y,
  });
  src.dispatchEvent(mk("mousedown", r1.left + 24, startY));
  document.dispatchEvent(mk("mousemove", r1.left + 34, startY + 8)); /* 越过 4px 阈值 */
  const ghost = !!document.querySelector(".drag-ghost");
  const bodyDragging = document.body.classList.contains("dragging");
  document.dispatchEvent(mk("mousemove", r2.left + 40, endY));
  const over = document.querySelector("section.cat.drop-over");
  const overCat = over ? over.getAttribute("data-cat") : null;
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r2.left + 40, clientY: endY }));
  return { ghost, bodyDragging, overCat, skip: false };
});
ok("右键拖拽：生成拖拽幽灵与拖拽态", dragRes.ghost === true && dragRes.bodyDragging === true, JSON.stringify({ ghost: dragRes.ghost, body: dragRes.bodyDragging }));
ok("右键拖拽：目标分类高亮", dragRes.overCat === "ai", "overCat=" + dragRes.overCat);
const movedOk = await page.evaluate(() => {
  const ai = document.querySelector('#results section.cat[data-cat="ai"]');
  const dev = document.querySelector('#results section.cat[data-cat="dev"]');
  return {
    inAI: !!ai && ai.textContent.includes("GitHub"),
    goneFromDev: !!dev && !dev.textContent.includes("GitHub"),
    toast: document.getElementById("toastMsg").textContent,
    noGhost: !document.querySelector(".drag-ghost"),
    noDropOver: !document.querySelector("section.cat.drop-over"),
  };
});
ok("右键拖拽：GitHub 移入「AI 工具」", movedOk.inAI === true && movedOk.goneFromDev === true);
ok("右键拖拽：拖拽残迹清理干净", movedOk.noGhost === true && movedOk.noDropOver === true);
ok("右键拖拽：移动 toast 反馈", movedOk.toast.includes("已移动"), "toast=" + movedOk.toast);
await shot("08-drag-moved");

/* B3. 删除 + 撤销 */
const delRes = await page.evaluate(() => {
  const card = [...document.querySelectorAll("#results .card")].find(c => c.textContent.includes("测试新增站"));
  if (!card) return { skip: true };
  card.querySelector(".del").click();
  return {
    skip: false,
    gone: ![...document.querySelectorAll("#results .card")].some(c => c.textContent.includes("测试新增站")),
    total: document.getElementById("statTotal").textContent,
    undoVisible: !document.getElementById("toastBtn").hidden,
  };
});
ok("删除：卡片即时移除", delRes.gone === true);
ok("删除：总数 73 → 72", delRes.total === "72", "total=" + delRes.total);
ok("删除：toast 提供撤销按钮", delRes.undoVisible === true);
await page.click("#toastBtn");
const undoOk = await page.evaluate(() => ({
  back: [...document.querySelectorAll("#results .card")].some(c => c.textContent.includes("测试新增站")),
  total: document.getElementById("statTotal").textContent,
}));
ok("撤销：删除的书签恢复", undoOk.back === true && undoOk.total === "73", "total=" + undoOk.total);
await shot("09-undo-restored");

/* B4. 刷新保留：编辑层（移动/新增）与数据集持久化 */
await page.reload({ waitUntil: "load" });
const persist = await page.evaluate(() => {
  const ai = document.querySelector('#results section.cat[data-cat="ai"]');
  const shop = document.querySelector('#results section.cat[data-cat="shop"]');
  return {
    restored: !document.getElementById("statsSection").hidden,
    total: document.getElementById("statTotal").textContent,
    githubStillInAI: !!ai && ai.textContent.includes("GitHub"),
    addedKept: !!shop && shop.textContent.includes("测试新增站"),
    editsKey: !!localStorage.getItem("bmCategorizerEdits.v1"),
    dataKey: !!localStorage.getItem("bmCategorizerData.v1"),
  };
});
ok("刷新保留：数据自动恢复", persist.restored === true);
ok("刷新保留：总数仍为 73", persist.total === "73", "total=" + persist.total);
ok("刷新保留：手动移动仍在生效（GitHub 在 AI 工具）", persist.githubStillInAI === true);
ok("刷新保留：新增书签仍在（购物电商）", persist.addedKept === true);
ok("刷新保留：localStorage 双 key 写入", persist.editsKey === true && persist.dataKey === true);

/* ========== 阶段 C：自定义分类（创建 / 归入 / 拖拽 / 删除撤销 / 刷新保留） ========== */
/* C1. 创建分类：空名拦截 → 重名拦截 → 正常创建（chip + 占位区块） */
await page.click("#btnAddCat");
const catFormVisible = await page.$eval("#addCatForm", el => !el.hidden);
ok("自定义分类：表单展开", catFormVisible === true);
await page.click("#addCatForm button[type='submit']"); /* 空名称提交 */
const emptyCatErr = await page.$eval("#newCatErr", el => el.textContent);
ok("自定义分类：空名称被拦截", emptyCatErr.length > 0, JSON.stringify(emptyCatErr));
await page.evaluate(() => {
  document.getElementById("newCatName").value = "购物电商"; /* 与内置分类重名 */
  document.getElementById("addCatForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const dupCatErr = await page.$eval("#newCatErr", el => el.textContent);
ok("自定义分类：重名被拦截", dupCatErr.includes("同名"), JSON.stringify(dupCatErr));
await page.evaluate(() => {
  document.getElementById("newCatName").value = "我的私藏";
  document.getElementById("addCatForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const created = await page.evaluate(() => {
  const chip = [...document.querySelectorAll("#chips .chip")].find(c => c.textContent.includes("我的私藏"));
  return {
    chipCount: document.querySelectorAll("#chips .chip").length,
    chip: !!chip,
    chipCnt: chip ? chip.querySelector(".cnt").textContent : "?",
    toast: document.getElementById("toastMsg").textContent,
    formHidden: document.getElementById("addCatForm").hidden,
    /* 创建后自动切到该分类，应显示占位区块 */
    placeholder: [...document.querySelectorAll("#results section.cat")].some(s => s.getAttribute("data-cat") && s.textContent.includes("还没有书签")),
    catsStat: document.getElementById("statCats").textContent,
  };
});
ok("自定义分类：创建成功并出现在 chips", created.chip === true && created.chipCnt === "0", "chips=" + created.chipCount + " cnt=" + created.chipCnt);
ok("自定义分类：空分类显示占位区块", created.placeholder === true);
ok("自定义分类：选中空分类时不出现「没有匹配」空态", await page.evaluate(() =>
  !document.getElementById("results").textContent.includes("没有匹配")));
ok("自定义分类：命中分类数不计入空分类（仍 12）", created.catsStat === "12", "statCats=" + created.catsStat);
ok("自定义分类：创建 toast 与表单收起", created.toast.includes("已创建") && created.formHidden === true);
await shot("11-custom-cat-created");

/* 搜索时空分类占位不显示 */
await page.evaluate(() => {
  document.querySelector("#chips .chip").click(); /* 回到全部 */
});
await page.type("#searchInput", "github");
await new Promise(r => setTimeout(r, 250));
const hiddenWhileSearch = await page.evaluate(() =>
  ![...document.querySelectorAll("#results section.cat")].some(s => s.textContent.includes("还没有书签")));
ok("自定义分类：搜索时空分类占位隐藏", hiddenWhileSearch === true);
await page.$eval("#searchInput", el => { el.value = ""; el.dispatchEvent(new Event("input")); });

/* C2. 新增书签到自定义分类 */
const customCatId = await page.evaluate(() => {
  const sec = [...document.querySelectorAll("#results section.cat")]
    .find(s => s.textContent.includes("我的私藏"));
  return sec ? sec.getAttribute("data-cat") : null;
});
await page.click("#btnAdd");
const optsWithCustom = await page.$$eval("#addCat option", els => els.map(o => o.textContent));
ok("自定义分类：新增书签下拉包含自定义项", optsWithCustom.some(t => t.includes("我的私藏（自定义）")), "options=" + optsWithCustom.length);
await page.evaluate((cid) => {
  document.getElementById("addTitle").value = "私藏站点";
  document.getElementById("addUrl").value = "https://my-stash.example.com/";
  document.getElementById("addCat").value = cid || "other";
  document.getElementById("addForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}, customCatId);
const addedToCustom = await page.evaluate(() => {
  const sec = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  return {
    inCustom: !!sec && sec.textContent.includes("私藏站点"),
    noPlaceholder: !sec.textContent.includes("还没有书签"),
    total: document.getElementById("statTotal").textContent,
  };
});
ok("自定义分类：新增书签归入自定义分类", addedToCustom.inCustom === true && addedToCustom.noPlaceholder === true);
ok("自定义分类：总数 73 → 74", addedToCustom.total === "74", "total=" + addedToCustom.total);
await shot("12-custom-cat-with-item");

/* C3. 右键拖拽 GitHub（当前在 AI 工具）到自定义分类 */
await page.evaluate(() => { document.querySelector("#chips .chip").click(); });
await new Promise(r => setTimeout(r, 200));
const dragToCustom = await page.evaluate(() => {
  const src = [...document.querySelectorAll('#results section.cat[data-cat="ai"] .card')]
    .find(c => c.textContent.includes("GitHub"));
  const dst = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  if (!src || !dst) return { skip: true };
  dst.scrollIntoView({ block: "center" });
  const r1 = src.getBoundingClientRect(), r2 = dst.getBoundingClientRect();
  const mk = (type, x, y) => new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: x, clientY: y,
  });
  src.dispatchEvent(mk("mousedown", r1.left + 24, r1.top + 10));
  document.dispatchEvent(mk("mousemove", r1.left + 34, r1.top + 18));
  document.dispatchEvent(mk("mousemove", r2.left + 40, r2.top + 20));
  const overCat = (document.querySelector("section.cat.drop-over") || {}).getAttribute ? document.querySelector("section.cat.drop-over").getAttribute("data-cat") : null;
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r2.left + 40, clientY: r2.top + 20 }));
  return { skip: false, overCat };
});
ok("自定义分类：右键拖拽目标高亮", dragToCustom.overCat && dragToCustom.overCat.indexOf("c_") === 0, "overCat=" + dragToCustom.overCat);
const movedToCustom = await page.evaluate(() => {
  const custom = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  const ai = document.querySelector('#results section.cat[data-cat="ai"]');
  return {
    inCustom: !!custom && custom.textContent.includes("GitHub"),
    goneFromAI: !!ai && !ai.textContent.includes("GitHub"),
    toast: document.getElementById("toastMsg").textContent,
  };
});
ok("自定义分类：GitHub 拖入自定义分类", movedToCustom.inCustom === true && movedToCustom.goneFromAI === true);
ok("自定义分类：移动 toast 反馈", movedToCustom.toast.includes("已移动到「我的私藏」"), "toast=" + movedToCustom.toast);
await shot("13-drag-to-custom");

/* C4. 删除自定义分类（书签回到自动分类）+ 撤销恢复 */
const delCat = await page.evaluate(() => {
  const sec = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  if (!sec) return { skip: true };
  sec.querySelector("h2 .cat-del").click();
  return { skip: false };
});
const catDeleted = await page.evaluate(() => ({
  chipGone: ![...document.querySelectorAll("#chips .chip")].some(c => c.textContent.includes("我的私藏")),
  statCats: document.getElementById("statCats").textContent,
  githubBackToDev: (() => { const dev = document.querySelector('#results section.cat[data-cat="dev"]'); return !!dev && dev.textContent.includes("GitHub"); })(),
  stashInOther: (() => { const o = document.querySelector('#results section.cat[data-cat="other"]'); return !!o && o.textContent.includes("私藏站点"); })(),
  undoVisible: !document.getElementById("toastBtn").hidden,
}));
ok("自定义分类：删除后 chips 移除", catDeleted.chipGone === true);
ok("自定义分类：删除后 GitHub 回到开发工具（自动分类恢复）", catDeleted.githubBackToDev === true);
ok("自定义分类：删除后自定义新增的书签落到其他", catDeleted.stashInOther === true, "statCats=" + catDeleted.statCats);
ok("自定义分类：删除提供撤销", catDeleted.undoVisible === true);
await page.click("#toastBtn");
const catRestored = await page.evaluate(() => {
  const custom = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  const dev = document.querySelector('#results section.cat[data-cat="dev"]');
  return {
    chipBack: [...document.querySelectorAll("#chips .chip")].some(c => c.textContent.includes("我的私藏")),
    githubInCustom: !!custom && custom.textContent.includes("GitHub"),
    stashInCustom: !!custom && custom.textContent.includes("私藏站点"),
    goneFromDev: !!dev && !dev.textContent.includes("GitHub"),
  };
});
ok("自定义分类：撤销后分类与归属恢复", catRestored.chipBack === true && catRestored.githubInCustom === true && catRestored.stashInCustom === true && catRestored.goneFromDev === true);
await shot("14-custom-cat-restored");

/* C5. 刷新保留自定义分类 */
await page.reload({ waitUntil: "load" });
const customPersist = await page.evaluate(() => {
  const custom = [...document.querySelectorAll("#results section.cat")].find(s => s.textContent.includes("我的私藏"));
  return {
    chip: [...document.querySelectorAll("#chips .chip")].some(c => c.textContent.includes("我的私藏")),
    githubInCustom: !!custom && custom.textContent.includes("GitHub"),
    stashInCustom: !!custom && custom.textContent.includes("私藏站点"),
    total: document.getElementById("statTotal").textContent,
  };
});
ok("自定义分类：刷新后分类与归属保留", customPersist.chip === true && customPersist.githubInCustom === true && customPersist.stashInCustom === true);
ok("自定义分类：刷新后总数仍 74", customPersist.total === "74", "total=" + customPersist.total);
await shot("15-custom-cat-persist");

/* B5. 清空重来 */
await page.click("#btnClear");
const cleared = await page.evaluate(() => ({
  empty: !document.getElementById("emptyState").hidden,
  stats: document.getElementById("statsSection").hidden,
  editsGone: localStorage.getItem("bmCategorizerEdits.v1") === null,
  dataGone: localStorage.getItem("bmCategorizerData.v1") === null,
}));
ok("清空重来：回到空态引导", cleared.empty === true && cleared.stats === true);
ok("清空重来：localStorage 已清空", cleared.editsGone === true && cleared.dataGone === true);
await shot("10-cleared");

/* 10. 390px 窄屏（重载示例后检查） */
await page.click("#btnSample");
await page.waitForFunction(() => !document.getElementById("statsSection").hidden);
await page.setViewport({ width: 390, height: 844 });
await new Promise(r => setTimeout(r, 200));
const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("390px 窄屏：无横向溢出", overflowX <= 1, "overflowX=" + overflowX);
await shot("06-mobile-390", 390);

/* 11. 键盘可达 */
await page.setViewport({ width: 1280, height: 900 });
const kbdOk = await page.evaluate(() => {
  const dz = document.getElementById("dropzone");
  dz.focus();
  return document.activeElement === dz;
});
ok("键盘：拖拽区可聚焦", kbdOk);

ok("控制台无错误", consoleErrors.length === 0, consoleErrors.join(" || ").slice(0, 300));

await browser.close();
console.log("\n===== 浏览器交互验证结果 =====");
for (const [s, n] of results) console.log(s, n);
const fails = results.filter(r => r[0] === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} 通过；截图目录：${outDir}`);
