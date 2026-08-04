# 开发计划：我的世界复刻版

## 总览

本计划采用**增量垂直切片**策略，每个阶段交付一个可运行、可验证的完整功能切片。每个阶段都建立在上一阶段的可运行骨架之上，绝不延迟集成。

### 阶段总览

| 阶段 | 名称 | 核心交付 | 验证方式 |
|------|------|----------|----------|
| 1 | 行走骨架 | 可运行的主循环 + 平坦方块地面 | `npm run dev` 后看到 3D 地面 |
| 2 | 程序化地形生成 | 噪声地形 + 多种方块 + 树木水域 | 每次加载生成不同地形 |
| 3 | 第一人称控制与物理 | 鼠标视角 + WASD 移动 + 重力跳跃碰撞 | 玩家可自由行走跳跃，不穿墙不掉落 |
| 4 | 方块交互 | 射线检测 + 破坏/放置 + 高亮 + 粒子 | 可破坏和放置方块，有视觉反馈 |
| 5 | 快捷栏与物品选择 | 9 格快捷栏 + 数字键选择 + 按类型放置 | 可选择不同方块类型进行放置 |
| 6 | 昼夜循环与天空 | 10 分钟昼夜周期 + 天空渐变 + 光照旋转 | 天空颜色和光照随时间平滑变化 |
| 7 | 菜单与游戏状态 | 主菜单 + 加载界面 + 暂停菜单 + 状态机 | 菜单→加载→游戏→暂停全流程可用 |
| 8 | 视觉打磨与最终润色 | 增强纹理 + 裂纹动画 + 相机过渡 + 响应式 | 全部视觉元素到位，60fps 无瑕疵 |

---

## Phase 1: 行走骨架 (Walking Skeleton)

### 功能特性范围（用户体验与视觉）

- 浏览器打开后显示一个全屏 3D 场景，中央有一个由 16×16 草方块组成的平坦地面
- 地面使用程序化生成的绿色纹理（CanvasTexture），每个方块有细微的颜色变化
- 相机位于地面上方，可通过鼠标拖拽旋转视角（临时控制，Phase 3 替换）
- 页面无任何 UI 元素，仅显示 3D 场景和地面

### 技术任务

1. 手动创建项目脚手架（不使用交互式 CLI）：
   - `package.json` — 依赖：`three`、`typescript`、`vite`、`@types/three`
   - `tsconfig.json` — 严格模式，`moduleResolution: "bundler"`
   - `vite.config.ts` — 基础 Vite 配置
   - `index.html` — 挂载点 `<div id="app">`
   - `src/main.ts` — 入口文件
   - `src/style.css` — 全屏样式，无滚动条
2. 创建 `src/core/Game.ts`：
   - 初始化 Three.js `Scene`、`PerspectiveCamera`、`WebGLRenderer`
   - 设置 `requestAnimationFrame` 主循环，每帧调用 `update(deltaTime)` 和 `render()`
   - 主循环中输出 `console.log` 帧率（每 60 帧一次）
3. 创建 `src/world/World.ts`：
   - 定义 `BlockType` 枚举（`GRASS`、`DIRT`、`STONE`、`AIR`）
   - 定义 `Block` 接口（`type`、`position`）
   - 创建 `createFlatGround(size: number)` 方法，生成 16×16 的草方块地面
4. 创建 `src/textures/TextureGenerator.ts`：
   - 实现 `generateGrassTexture(): CanvasTexture` — 16×16 像素，绿色基底 + 随机噪点
   - 使用 `CanvasTexture` 生成，不加载任何外部图片
5. 创建 `src/world/ChunkMesh.ts`：
   - 将方块数据转换为 Three.js Mesh（使用 `BoxGeometry` + `MeshLambertMaterial`）
   - 每个方块一个独立 Mesh（Phase 2 优化为合并网格）

### 前置代码调整与重新接线

- 不适用（首个阶段）

### 验证目标

- 运行 `npm run dev`，浏览器自动打开
- 看到 16×16 的绿色草方块地面，每个方块有细微颜色差异
- 鼠标拖拽可旋转视角（临时 OrbitControls 或手动实现）
- 控制台每 60 帧输出一次帧率，稳定在 55-60fps
- 无任何报错或警告

---

## Phase 2: 程序化地形生成 (Procedural Terrain Generation)

### 功能特性范围（用户体验与视觉）

- 每次点击刷新（重新加载页面），生成完全不同的地形
- 地形包含：草地（绿色顶部）、泥土（棕色）、石头（灰色）、沙子（淡黄色）、水域（蓝色半透明）、树木（木头+树叶）
- 地形起伏：平原、丘陵、山脉、湖泊
- 树木随机分布在草地表面，水域出现在低洼区域
- 世界以玩家出生点为中心，生成 128×128 范围的地形

### 技术任务

1. 实现噪声算法：
   - 创建 `src/utils/Noise.ts` — 实现 Simplex 噪声（2D 和 3D）
   - 使用多倍频叠加（FBM）生成自然的地形起伏
2. 实现地形生成：
   - 创建 `src/world/TerrainGenerator.ts`：
     - 使用 2D 噪声生成高度图（海拔）
     - 根据海拔决定方块类型：
       - 低于海平面 → 水 + 沙子（底部）
       - 海平面以上 → 草地（表面）+ 泥土（下方 3 格）+ 石头（更深）
       - 高海拔 → 石头表面
     - 使用 3D 噪声在草地表面随机生成树木（木头 4-6 格高 + 树叶球冠）
3. 实现区块系统：
   - 创建 `src/world/Chunk.ts` — 16×16×16 的方块数组存储
   - 创建 `src/world/ChunkManager.ts` — 管理 8×8 个区块（128×128 范围）
   - 实现 `getBlock(x, y, z)` 和 `setBlock(x, y, z, type)` 接口
4. 优化渲染：
   - 创建 `src/world/ChunkMeshBuilder.ts` — 仅生成暴露在空气中的方块面（面剔除）
   - 每个区块合并为一个 `BufferGeometry`，大幅减少 draw call
   - 水方块使用半透明材质（`transparent: true`，`opacity: 0.7`）
5. 更新 `src/world/World.ts`：
   - 删除 `createFlatGround()`，替换为 `generateWorld()` 调用 `TerrainGenerator`
   - 世界底部（y=0）铺设一层基岩（不可见，防止掉落）

### 前置代码调整与重新接线

- **修改 `src/world/World.ts`**：删除 `createFlatGround()`，替换为 `generateWorld()`，调用 `TerrainGenerator` 和 `ChunkManager`
- **修改 `src/world/ChunkMesh.ts`**：从"每方块一个 Mesh"重构为"每区块一个合并 Mesh"，使用 `ChunkMeshBuilder`
- **修改 `src/core/Game.ts`**：初始化时调用 `world.generateWorld()` 替代 `world.createFlatGround()`
- **保留**：主循环、相机、渲染器不变

### 验证目标

- 刷新页面 5 次，每次生成的地形明显不同（山丘位置、水域形状、树木分布均不同）
- 地形包含所有方块类型：草地、泥土、石头、沙子、水、木头、树叶
- 无悬浮方块、无空洞、无地形穿透
- 帧率保持 50fps 以上（128×128 范围）
- 相机可自由旋转观察整个地形

---

## Phase 3: 第一人称控制与物理 (First-Person Controls & Physics)

### 功能特性范围（用户体验与视觉）

- 点击画面后，鼠标被锁定（Pointer Lock），移动鼠标旋转视角
- WASD 键控制前后左右移动，空格键跳跃
- 玩家受重力影响，落地后停止下落
- 玩家碰撞体为 0.6×1.8×0.6 格（宽×高×深），无法穿过方块
- 玩家可走上 1 格高的台阶（自动步进）
- 玩家走入水中时移动速度降低 50%，但可正常跳跃
- 屏幕中央显示白色"+"准星

### 技术任务

1. 创建 `src/player/Player.ts`：
   - 属性：`position: Vector3`（脚底位置）、`velocity: Vector3`、`onGround: boolean`
   - 碰撞体：`width: 0.6`、`height: 1.8`、`depth: 0.6`
   - 方法：`update(deltaTime, input)` — 处理移动、重力、跳跃、碰撞
2. 实现输入系统：
   - 创建 `src/core/Input.ts`：
     - 监听 `keydown`/`keyup` 维护按键状态（WASD、Space）
     - 监听 `mousemove` 更新鼠标偏移量（Pointer Lock 模式下）
     - 监听 `click` 请求 Pointer Lock
     - 监听 `pointerlockchange` 处理锁定/解锁状态
3. 实现碰撞检测：
   - 创建 `src/physics/Collision.ts`：
     - `moveWithCollision(player, world, deltaTime)` — 分轴移动（X → Y → Z）
     - 每轴移动后检查 AABB 与方块网格的碰撞，发生碰撞则将该轴速度归零
     - 检测玩家脚底是否有方块支撑（`onGround` 判定）
     - 水方块（`WATER`）不参与碰撞，但检测玩家是否在水中（降低速度）
4. 更新相机：
   - 相机位置 = 玩家位置 + 眼睛高度（1.62 格）
   - 相机旋转 = 鼠标累积偏移量（Pitch 限制 ±89°）
   - 删除 Phase 1 的临时 OrbitControls
5. 创建 HUD 准星：
   - 在 `index.html` 中添加 `<div id="crosshair">+</div>`
   - CSS 居中定位，白色，`pointer-events: none`

### 前置代码调整与重新接线

- **修改 `src/core/Game.ts`**：初始化 `Player` 和 `Input`，主循环中调用 `player.update(deltaTime)`，相机位置/旋转从玩家实体获取
- **删除**：Phase 1 的临时相机控制代码（OrbitControls 或手动旋转）
- **修改 `src/world/World.ts`**：暴露 `getBlock(x, y, z)` 接口供碰撞检测使用
- **保留**：地形生成、区块系统、渲染管线不变

### 验证目标

- 点击画面后鼠标锁定，移动鼠标视角平滑旋转，无跳变
- WASD 移动方向正确（前后左右相对于视角方向）
- 空格跳跃，跳跃高度约 1.25 格，可跳上 1 格高的方块
- 玩家无法穿过任何方块（包括山体、树木）
- 玩家不会从地面掉落（重力 + 碰撞正常）
- 走入水中时移动速度明显降低，走出后恢复
- 准星始终显示在屏幕中央

---

## Phase 4: 方块交互 - 破坏与放置 (Block Interaction - Break & Place)

### 功能特性范围（用户体验与视觉）

- 准星对准方块时，方块表面显示半透明白色线框高亮（距离 ≤ 8 格）
- 左键点击：破坏瞄准的方块，方块消失并播放粒子效果（8-12 个小立方体四散）
- 右键点击：在瞄准方块的相邻空位放置一个草方块（Phase 5 改为当前选中方块）
- 破坏和放置后，世界数据立即更新，区块网格自动重建
- 基岩不可破坏

### 技术任务

1. 实现射线检测：
   - 创建 `src/interaction/Raycaster.ts`：
     - 使用 DDA（Digital Differential Analyzer）算法在体素网格中步进
     - 从相机中心出发，方向为相机朝向，最大距离 8 格
     - 返回命中的方块坐标、命中面法线方向、以及相邻放置坐标
2. 实现方块高亮：
   - 创建 `src/interaction/BlockHighlight.ts`：
     - 使用 `LineSegments` + `EdgesGeometry` 创建方块线框
     - 每帧更新位置到射线命中的方块
     - 未命中时隐藏
3. 实现方块破坏：
   - 左键点击时调用 `world.setBlock(x, y, z, AIR)`
   - 触发 `ChunkManager.rebuildChunk(chunkCoord)` 重建受影响区块
   - 创建 `src/effects/ParticleSystem.ts`：
     - 生成 8-12 个小立方体（`BoxGeometry(0.1)`），颜色取自被破坏方块的纹理主色
     - 粒子受重力影响，0.5 秒后消失
     - 粒子池上限 200 个
4. 实现方块放置：
   - 右键点击时在射线命中的相邻面放置方块
   - 检查放置位置是否为空气（或水），且不与玩家碰撞体重叠
   - 放置后重建区块
5. 更新 `src/world/ChunkManager.ts`：
   - 实现 `rebuildChunk(chunkX, chunkY, chunkZ)` — 仅重建指定区块
   - 若方块位于区块边界，同时重建相邻区块

### 前置代码调整与重新接线

- **修改 `src/world/ChunkManager.ts`**：添加 `rebuildChunk()` 方法，支持单区块重建
- **修改 `src/world/World.ts`**：暴露 `setBlock()` 接口，内部调用 `ChunkManager` 更新数据并触发重建
- **修改 `src/core/Input.ts`**：添加 `mousedown` 事件监听，区分左键（`button === 0`）和右键（`button === 2`）
- **修改 `src/core/Game.ts`**：初始化 `Raycaster`、`BlockHighlight`、`ParticleSystem`，主循环中更新高亮和粒子
- **保留**：玩家控制、物理、地形生成不变

### 验证目标

- 准星对准方块时显示白色线框高亮，移开后消失
- 左键点击方块，方块立即消失，播放粒子效果，区块网格正确重建（无残留面）
- 右键点击方块相邻面，在正确位置放置草方块
- 基岩无法被破坏
- 破坏和放置后，玩家可以正常行走碰撞（不会卡在修改过的区域）
- 粒子效果在 0.5 秒内消失，无粒子残留

---

## Phase 5: 快捷栏与物品选择 (Hotbar & Item Selection)

### 功能特性范围（用户体验与视觉）

- 屏幕底部中央显示 9 格快捷栏，每格显示对应方块的程序化纹理图标
- 方块类型：草方块、泥土、石头、沙子、木头、树叶、水、基岩、玻璃
- 数字键 1-9 切换选中槽位，选中槽位有白色高亮边框
- 右键放置时，放置的是当前选中槽位的方块类型
- 快捷栏在窄窗口下自动缩小但保持 9 格

### 技术任务

1. 扩展方块类型：
   - 更新 `BlockType` 枚举：`GRASS`、`DIRT`、`STONE`、`SAND`、`WOOD`、`LEAVES`、`WATER`、`BEDROCK`、`GLASS`
   - 更新 `TextureGenerator`：为每种方块生成程序化纹理（16×16 CanvasTexture）
     - 草方块：顶部绿色 + 侧面棕色带绿色边缘
     - 泥土：均匀棕色带噪点
     - 石头：灰色带颗粒
     - 沙子：淡黄色带颗粒
     - 木头：棕色竖条纹
     - 树叶：绿色半透明
     - 水：蓝色半透明
     - 基岩：深灰色
     - 玻璃：透明带白色边框
2. 实现快捷栏 UI：
   - 创建 `src/ui/Hotbar.ts`：
     - 在 `index.html` 中添加 `<div id="hotbar">` 容器
     - 动态生成 9 个槽位 `<div class="hotbar-slot">`
     - 每个槽位使用 `background-image` 显示方块纹理（通过 `canvas.toDataURL()`）
     - 监听数字键 1-9，更新选中槽位（添加 `selected` class）
     - 鼠标滚轮也可切换槽位（可选）
3. 连接放置逻辑：
   - 修改 `src/interaction/Raycaster.ts` 或 `Game.ts`：
     - 右键放置时，使用 `hotbar.getSelectedBlockType()` 替代硬编码的 `GRASS`
     - 水方块放置后为半透明状态
     - 玻璃方块放置后为透明状态

### 前置代码调整与重新接线

- **修改 `src/interaction/BlockInteraction.ts`**（或 `Game.ts` 中的放置逻辑）：硬编码的 `GRASS` 替换为 `hotbar.getSelectedBlockType()`
- **修改 `src/textures/TextureGenerator.ts`**：为所有 9 种方块生成纹理，供快捷栏图标和世界渲染共用
- **修改 `src/world/ChunkMeshBuilder.ts`**：支持所有新方块类型的材质（半透明水、透明玻璃）
- **保留**：射线检测、破坏逻辑、粒子效果不变

### 验证目标

- 快捷栏显示 9 个方块图标，每个图标清晰可辨
- 按数字键 1-9，对应槽位出现白色高亮边框
- 选中不同槽位后右键放置，放置的是对应方块类型
- 放置水方块后呈半透明蓝色，放置玻璃后呈透明状态
- 快捷栏在窗口缩小时自动缩小，但始终显示 9 格

---

## Phase 6: 昼夜循环与天空 (Day/Night Cycle & Sky)

### 功能特性范围（用户体验与视觉）

- 游戏内时间自动流转，完整周期 10 分钟（600 秒）
- 天空颜色平滑过渡：白天天蓝色 → 黄昏橙红色 → 夜晚深蓝色 → 黎明淡蓝色
- 太阳（方向光）随白天移动，夜晚消失；月亮（微弱方向光）夜晚出现
- 距离雾颜色与天空同步变化，增强氛围
- 夜晚环境变暗但仍有微弱月光，保证可见度

### 技术任务

1. 实现时间系统：
   - 创建 `src/environment/DayNightCycle.ts`：
     - 属性：`timeOfDay: number`（0-1，0 为午夜，0.5 为正午）
     - 方法：`update(deltaTime)` — 每 600 秒完成一个周期
     - 方法：`getSunAngle()` — 返回太阳高度角（用于光照方向）
2. 实现天空渲染：
   - 创建 `src/environment/Sky.ts`：
     - 使用 `ShaderMaterial` 创建渐变天空球（大球体，`side: BackSide`）
     - 定义 4 个关键颜色点：白天 `#87CEEB`、黄昏 `#FF7F50`、夜晚 `#0A0A2E`、黎明 `#B0C4DE`
     - 根据 `timeOfDay` 在关键点之间线性插值
3. 实现光照：
   - 修改 `src/core/Game.ts`：
     - 创建 `DirectionalLight`（太阳）和 `DirectionalLight`（月亮，强度低）
     - 太阳角度 = `timeOfDay * 2π`，绕 X 轴旋转
     - 太阳强度：白天 1.0，夜晚 0.0（平滑过渡）
     - 月亮强度：夜晚 0.3，白天 0.0
     - 环境光强度：白天 0.5，夜晚 0.2
4. 实现雾效：
   - 设置 `scene.fog = new THREE.Fog(color, 60, 120)`
   - 每帧更新雾颜色为当前天空颜色

### 前置代码调整与重新接线

- **修改 `src/core/Game.ts`**：初始化 `DayNightCycle` 和 `Sky`，主循环中调用 `dayNightCycle.update(deltaTime)`，将时间值传递给光照和天空
- **修改 `src/core/Game.ts`**：添加太阳/月亮方向光和环境光，替代 Phase 1 的静态光照
- **保留**：地形、玩家、方块交互、快捷栏不变

### 验证目标

- 游戏内天空颜色随时间平滑变化，无跳变
- 太阳光方向随时间旋转，光照角度正确
- 夜晚环境明显变暗，但方块仍可见（月光 + 环境光）
- 雾颜色与天空颜色一致，远处方块逐渐隐入雾中
- 完整周期 10 分钟，时间流转速度正确

---

## Phase 7: 菜单与游戏状态 (Main Menu & Pause Menu)

### 功能特性范围（用户体验与视觉）

- **主菜单**：标题"我的世界复刻版"居中显示，三个按钮垂直排列：开始游戏、操作说明、关于
- **操作说明界面**：显示控制列表（WASD-移动、空格-跳跃、鼠标-视角、左键-破坏方块、右键-放置方块、1-9-选择快捷栏、E-打开背包、ESC-暂停），底部"返回"按钮
- **关于界面**：显示项目名称、技术栈、版本号，底部"返回"按钮
- **加载界面**：显示"正在生成世界..."文字 + 进度条，生成完成后自动进入游戏
- **暂停菜单**（游戏中按 ESC）：标题"游戏暂停"，按钮：继续游戏、重新开始、返回主菜单
- 所有按钮悬停时高亮，点击时有缩放反馈

### 技术任务

1. 实现游戏状态机：
   - 创建 `src/core/GameState.ts`：
     - 枚举：`MENU`、`LOADING`、`PLAYING`、`PAUSED`、`CONTROLS`、`ABOUT`
     - 状态转换表：
       - `MENU` → 点击"开始游戏" → `LOADING`
       - `LOADING` → 世界生成完成 → `PLAYING`
       - `PLAYING` → 按 ESC → `PAUSED`
       - `PAUSED` → 点击"继续游戏" → `PLAYING`
       - `PAUSED` → 点击"重新开始" → `LOADING`
       - `PAUSED` → 点击"返回主菜单" → `MENU`
       - `CONTROLS`/`ABOUT` → 点击"返回" → `MENU`
2. 实现 UI 界面：
   - 创建 `src/ui/MainMenu.ts`、`src/ui/PauseMenu.ts`、`src/ui/LoadingScreen.ts`、`src/ui/ControlsScreen.ts`、`src/ui/AboutScreen.ts`
   - 所有界面使用 HTML/CSS 覆盖层（`position: fixed`，`z-index` 分层）
   - 主菜单背景：程序化生成的缓慢旋转方块场景（使用 Three.js 渲染到背景）
3. 修改主循环：
   - `Game.ts` 主循环根据当前状态决定是否更新游戏逻辑：
     - `PLAYING`：更新玩家、世界、交互、昼夜循环
     - `PAUSED`：停止更新，但继续渲染（静态画面）
     - `MENU`：仅渲染菜单背景场景
     - `LOADING`：执行世界生成，更新进度条
4. 实现重新开始：
   - 创建 `src/core/WorldReset.ts`：
     - 销毁现有世界（释放几何体、材质、纹理）
     - 重新生成世界（调用 `TerrainGenerator`）
     - 重置玩家位置到出生点
     - 重置昼夜循环时间
     - 重置快捷栏选中槽位
5. 处理 Pointer Lock 与暂停：
   - 进入 `PAUSED` 时，调用 `document.exitPointerLock()`
   - 点击"继续游戏"时，重新请求 Pointer Lock

### 前置代码调整与重新接线

- **修改 `src/core/Game.ts`**：主循环改为状态机驱动，根据 `GameState` 决定更新哪些系统
- **修改 `src/core/Input.ts`**：ESC 键触发暂停/恢复，仅在 `PLAYING` 状态响应游戏输入
- **修改 `src/world/World.ts`**：添加 `dispose()` 方法（释放所有 Three.js 资源），供重新开始时调用
- **修改 `src/player/Player.ts`**：添加 `reset()` 方法，重置位置和速度
- **修改 `src/environment/DayNightCycle.ts`**：添加 `reset()` 方法，重置时间
- **保留**：所有游戏逻辑系统不变，仅由状态机控制启停

### 验证目标

- 启动游戏显示主菜单，标题和三个按钮正确显示
- 点击"开始游戏"→ 显示加载界面和进度条 → 自动进入游戏
- 游戏中按 ESC → 显示暂停菜单，鼠标解锁
- 点击"继续游戏"→ 恢复游戏，鼠标重新锁定
- 点击"重新开始"→ 显示加载界面 → 生成新世界 → 进入游戏（玩家在出生点）
- 点击"返回主菜单"→ 回到主菜单
- 操作说明和关于界面可正常打开和返回
- 所有状态转换无报错，无内存泄漏（重复开始/返回 5 次后帧率不下降）

---

## Phase 8: 视觉打磨与最终润色 (Visual Polish & Final Polish)

### 功能特性范围（用户体验与视觉）

- 所有方块纹理增强：更丰富的噪点、颜色变化、边缘细节
- 破坏方块时显示 4 帧裂纹动画（每帧 50ms），随后方块消失并播放粒子
- 进入游戏时相机从高空平滑下降至玩家位置（1 秒过渡）
- 粒子效果优化：更自然的四散轨迹、大小变化、淡出
- 窗口大小变化时渲染画面自动适配，无拉伸变形
- 游戏全程保持 60fps，无视觉瑕疵

### 技术任务

1. 增强程序化纹理：
   - 修改 `src/textures/TextureGenerator.ts`：
     - 每种方块增加 2-3 个变体（随机种子），相邻方块使用不同变体
     - 增加纹理细节：草方块侧面增加下垂的草叶边缘、石头增加裂纹线条、木头增加年轮纹理
     - 使用 `NearestFilter` 保持像素风
2. 实现裂纹动画：
   - 创建 `src/effects/CrackOverlay.ts`：
     - 生成 4 帧裂纹纹理（CanvasTexture，黑色线条逐渐增多）
     - 方块被破坏时，在方块表面叠加裂纹纹理
     - 每 50ms 切换一帧，200ms 后移除并触发粒子
3. 实现相机过渡：
   - 创建 `src/effects/CameraTransition.ts`：
     - 进入游戏时，相机从出生点上方 20 格平滑下降至玩家眼睛位置
     - 使用缓动函数（easeInOutCubic），持续 1 秒
     - 过渡期间玩家不可移动
4. 优化粒子效果：
   - 修改 `src/effects/ParticleSystem.ts`：
     - 粒子初始速度随机方向（上半球）
     - 粒子大小随时间缩小（0.1 → 0.03）
     - 粒子透明度随时间降低，0.5 秒后完全消失
     - 粒子颜色取自方块纹理的多个采样点（更真实）
5. 实现响应式：
   - 修改 `src/core/Game.ts`：
     - 监听 `window.resize` 事件
     - 更新相机宽高比和渲染器尺寸
     - 快捷栏和 HUD 元素按比例缩放（使用 `vmin` 单位或 JS 计算）

### 前置代码调整与重新接线

- **修改 `src/textures/TextureGenerator.ts`**：替换所有基础纹理为增强版本，增加变体生成
- **修改 `src/interaction/BlockInteraction.ts`**：破坏方块时先播放裂纹动画（200ms），再执行实际破坏
- **修改 `src/core/Game.ts`**：进入 `PLAYING` 状态时触发相机过渡动画
- **修改 `src/effects/ParticleSystem.ts`**：替换粒子生成逻辑为优化版本
- **清理**：删除所有 `console.log` 调试输出、临时注释代码、未使用的导入

### 验证目标

- 所有方块纹理有丰富的噪点和细节，相邻方块有可见的纹理变化
- 破坏方块时显示 4 帧裂纹动画，动画结束后方块消失并播放粒子
- 进入游戏时相机从高空平滑下降，无跳变
- 粒子效果自然：四散、缩小、淡出，无突兀感
- 窗口大小调整时画面无拉伸、无变形，HUD 正确缩放
- 游戏全程 60fps，无视觉瑕疵（闪烁、穿透、残留）
- `npm run build` 构建成功，无 TypeScript 错误