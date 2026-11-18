# 同步到桌面与仓库

我这边没法直接写你的桌面或 push 到 GitHub（沙箱只允许写会话输出目录，且到 GitHub 的出站链路不通）。按下面两步在本地执行即可。

## 一、同步到桌面

你已经有一份在 `C:\Users\33582\Desktop\VisualLab\physica-a`，且是能跑通的、含 typecheck 修复的那份。

我这边新增或更新的文件，需要从这里取：

```
C:\Users\33582\AppData\Local\Claude-3p\local-agent-mode-sessions\d5696416\00000000\86d4bf8d\outputs\physica-a
```

本次新增/变更清单：

| 文件 | 说明 |
|---|---|
| `HANDOFF-B.md` | 新增，给 B 的对接说明 |
| `HANDOFF-C.md` | 新增，给 C 的接口说明 |
| `ACCEPTANCE.md` | 更新，第 0 节工程验证全部标绿 |
| `src/hooks/useWorkspace.ts` | 更新，`input.file` 提到局部常量的 typecheck 修复 |
| `src/services/imageRecognition.ts` | 更新，示例走兜底、接口地址可配 |
| `src/config/endpoints.ts` | 新增，接口地址集中配置 |
| `vite.config.ts` | 更新，代理目标可用环境变量覆盖 |
| `.env.example` / `.gitignore` | 新增 |
| `verify.html` | 新增，数值自检页 |

**注意**：你本地那份已经跑通了，说明它的 `useWorkspace.ts` 已是修复版。如果逐文件覆盖，可能把你自己改动过的其他文件冲掉。稳妥做法是**只覆盖上面列出的文件**，其余不动。

复制完成后跑一遍确认没坏：

```powershell
npm run typecheck
npm run test
npm run dev
```

## 二、推送到仓库

先确认你的本地仓库状态，再决定怎么推。如果桌面那份还没接上远端：

```powershell
cd C:\Users\33582\Desktop\VisualLab\physica-a
git init                      # 如果还不是仓库
git remote add origin <仓库地址> # 如果还没配远端
git add .
git commit -m "A: 前端全链路（上传/核对/播放/绘制）+ 物理参考实现 + 交接文档"
git push -u origin main
```

如果远程已经有了其他人的代码（B 的 `src/physics`、C 的 `src/api`），**不要**直接覆盖推上去，先拉：

```powershell
git pull --rebase origin main
```

冲突大概率出在 `package.json`（依赖）和 `src/types/index.ts`（共享类型）。这两个地方要三个人当面确认，别自己拍板。

## 三、提交前必须确认的三件事

1. **`src/adapters/index.ts` 是不是还指向 Mock。** 指向 Mock 是对的，等 B 的库进来再改。但如果 B 已经合并了他的代码，这里要切成 `../physics`。

2. **`.env.local` 不要提交。** 里面可能有接口地址甚至密钥。`.gitignore` 已经排除了，确认一下 `git status` 里没有它。

3. **`node_modules` 和 `dist` 不要提交。** 同样已在 `.gitignore` 里，但如果之前误提交过，`git rm -r --cached node_modules` 清掉，否则仓库会涨到几百 MB。

## 四、建议的提交拆分

一次性提交容易在冲突时全盘重来。建议按这个顺序拆成几个 commit：

1. 工程骨架（`package.json`、`tsconfig`、`vite.config`、`index.html`、`.gitignore`）
2. 共享类型与契约（`src/types`、`src/adapters/contract.ts`）
3. 物理参考实现 + 验收用例（`src/adapters/mockMotionAdapter.ts`、`__tests__`）
4. 服务适配层（`src/services`、`src/config`）
5. 状态机（`src/hooks`）
6. UI 组件与样式（`src/components`、`src/styles`、`App.tsx`、`main.tsx`）
7. 文档（`README.md`、`ACCEPTANCE.md`、`HANDOFF-*.md`、`verify.html`）

这样 B 改 `src/physics`、C 改 `src/api` 时不会和你的 UI 提交撞在一起。
