<script setup>
import { ref, onMounted, computed } from "vue";
import ImageDetail from "./ImageDetail.vue";

const token = localStorage.getItem("gallery_token");
const entries = ref([]);
const loading = ref(false);
const error = ref("");
const selectedIndex = ref(-1);

// 图片缓存管理（永久缓存）
const IMAGE_CACHE_KEY = 'gallery_image_cache';
const GALLERY_LIST_CACHE_KEY = 'gallery_list_cache';

function getImageCache() {
  try {
    const cache = localStorage.getItem(IMAGE_CACHE_KEY);
    return cache ? JSON.parse(cache) : {};
  } catch (e) {
    return {};
  }
}

function setImageCache(fileId, url) {
  try {
    const cache = getImageCache();
    cache[fileId] = { url };
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to cache image:', e);
  }
}

function getGalleryListCache() {
  try {
    const cache = localStorage.getItem(GALLERY_LIST_CACHE_KEY);
    return cache ? JSON.parse(cache) : null;
  } catch (e) {
    return null;
  }
}

function setGalleryListCache(list) {
  try {
    localStorage.setItem(GALLERY_LIST_CACHE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to cache gallery list:', e);
  }
}

// 加载图片数据（优化：先显示缓存，再异步更新）
async function load(forceRefresh = false) {
  error.value = "";
  
  // 第一步：立即从缓存加载并显示
  if (!forceRefresh) {
    const cachedList = getGalleryListCache();
    if (cachedList && cachedList.length > 0) {
      const imageCache = getImageCache();
      entries.value = cachedList.map((e) => {
        const fileId = e.telegram?.file_id;
        const cachedUrl = fileId && imageCache[fileId];
        return {
          ...e,
          src: cachedUrl ? cachedUrl.url : null,
          loading: !cachedUrl
        };
      });
      loading.value = false;
    } else {
      loading.value = true;
    }
  } else {
    loading.value = true;
  }
  
  // 第二步：异步从服务器获取最新数据
  try {
    const resp = await fetch("/api/gallery", {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!resp.ok) {
      const j = await resp.json();
      throw new Error(j.error || "Failed to load");
    }
    
    const serverList = await resp.json();
    
    // 缓存最新的画廊列表
    setGalleryListCache(serverList);
    
    const imageCache = forceRefresh ? {} : getImageCache();
    
    // 合并服务器数据和当前数据
    const existingIds = new Set(entries.value.map(e => e.id));
    const newEntries = [];
    
    serverList.forEach((e) => {
      const fileId = e.telegram?.file_id;
      const cachedData = fileId && imageCache[fileId];
      
      const entry = {
        ...e,
        src: cachedData && !forceRefresh ? cachedData.url : null,
        loading: !cachedData || forceRefresh
      };
      
      // 如果是新图片，添加到列表前面
      if (!existingIds.has(e.id)) {
        newEntries.unshift(entry);
      } else {
        // 更新现有图片的元数据
        const idx = entries.value.findIndex(ex => ex.id === e.id);
        if (idx !== -1) {
          entries.value[idx] = entry;
        }
      }
    });
    
    // 将新图片添加到列表开头
    if (newEntries.length > 0) {
      entries.value = [...newEntries, ...entries.value];
    }

    // 加载未缓存的图片URL
    entries.value.forEach(async (e) => {
      if (!e.telegram?.file_id || (e.src && !forceRefresh)) return;
      
      try {
        const r = await fetch(
          `/api/fileurl?file_id=${encodeURIComponent(e.telegram.file_id)}`
        );
        if (!r.ok) return;
        
        const j = await r.json();
        e.src = j.url;
        e.loading = false;
        
        // 永久缓存图片 URL
        setImageCache(e.telegram.file_id, j.url);
      } catch (err) {
        console.error('Failed to load image:', err);
        e.loading = false;
      }
    });
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

// 刷新单个图片
async function refreshSingleImage(entry) {
  if (!entry.telegram?.file_id) return;
  
  entry.loading = true;
  try {
    const r = await fetch(
      `/api/fileurl?file_id=${encodeURIComponent(entry.telegram.file_id)}`
    );
    if (!r.ok) throw new Error('Failed to refresh');
    
    const j = await r.json();
    entry.src = j.url;
    entry.loading = false;
    
    // 更新缓存
    setImageCache(entry.telegram.file_id, j.url);
  } catch (err) {
    console.error('Failed to refresh image:', err);
    entry.loading = false;
  }
}

// 全部强制刷新
function forceRefreshAll() {
  load(true);
}

function open(entry) {
  const index = entries.value.findIndex(e => e.id === entry.id);
  selectedIndex.value = index;
}

function close() {
  selectedIndex.value = -1;
}

function prevImage() {
  if (selectedIndex.value > 0) {
    selectedIndex.value--;
  }
}

function nextImage() {
  if (selectedIndex.value < entries.value.length - 1) {
    selectedIndex.value++;
  }
}

function logout() {
  localStorage.removeItem('gallery_token');
  location.reload();
}

// 解析 prompt 为 tags
function parseTags(prompt) {
  if (!prompt) return [];
  return prompt
    .replace(/[()]/g, '')
    .split(',')
    .map(t => t.trim())
    .filter(t => t);
}

// 为 tag 生成颜色（淡色背景+深色文字+描边）- 64种配色
const tagColors = [
  // 蓝色系 (8)
  { bg: '#e0f2fe', text: '#0c4a6e', border: '#7dd3fc' },
  { bg: '#dbeafe', text: '#1e3a8a', border: '#93c5fd' },
  { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  { bg: '#e7e5e4', text: '#1c1917', border: '#a8a29e' },
  { bg: '#dfe9f3', text: '#1e40af', border: '#60a5fa' },
  { bg: '#e1e8f0', text: '#1e3a8a', border: '#7dd3fc' },
  { bg: '#dbeafe', text: '#1e293b', border: '#94a3b8' },
  { bg: '#e0f2fe', text: '#164e63', border: '#67e8f9' },
  
  // 紫色系 (8)
  { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe' },
  { bg: '#f5f3ff', text: '#4c1d95', border: '#c4b5fd' },
  { bg: '#fae8ff', text: '#86198f', border: '#f0abfc' },
  { bg: '#f3e8ff', text: '#581c87', border: '#e9d5ff' },
  { bg: '#ede9fe', text: '#6d28d9', border: '#a78bfa' },
  { bg: '#f5f3ff', text: '#7c3aed', border: '#c4b5fd' },
  { bg: '#fae8ff', text: '#a21caf', border: '#f0abfc' },
  
  // 粉红色系 (8)
  { bg: '#fce7f3', text: '#9f1239', border: '#f9a8d4' },
  { bg: '#fce7f3', text: '#831843', border: '#f9a8d4' },
  { bg: '#ffe4e6', text: '#9f1239', border: '#fda4af' },
  { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
  { bg: '#fce7f3', text: '#be185d', border: '#f9a8d4' },
  { bg: '#fff1f2', text: '#881337', border: '#fda4af' },
  { bg: '#fce7f3', text: '#9d174d', border: '#f472b6' },
  { bg: '#ffe4e6', text: '#be123c', border: '#fb7185' },
  
  // 橙红色系 (8)
  { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' },
  { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },
  { bg: '#fef2f2', text: '#7f1d1d', border: '#fca5a5' },
  { bg: '#fff7ed', text: '#7c2d12', border: '#fed7aa' },
  { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  { bg: '#fed7aa', text: '#c2410c', border: '#fb923c' },
  { bg: '#fee2e2', text: '#b91c1c', border: '#f87171' },
  
  // 绿色系 (8)
  { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
  { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' },
  { bg: '#d1fae5', text: '#047857', border: '#34d399' },
  { bg: '#f0fdf4', text: '#15803d', border: '#4ade80' },
  { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
  { bg: '#ecfdf5', text: '#14532d', border: '#10b981' },
  
  // 青色系 (8)
  { bg: '#cffafe', text: '#164e63', border: '#67e8f9' },
  { bg: '#ecfeff', text: '#155e75', border: '#22d3ee' },
  { bg: '#e0f2fe', text: '#0c4a6e', border: '#38bdf8' },
  { bg: '#cffafe', text: '#0e7490', border: '#06b6d4' },
  { bg: '#ecfeff', text: '#164e63', border: '#67e8f9' },
  { bg: '#e0f2fe', text: '#075985', border: '#0ea5e9' },
  { bg: '#cffafe', text: '#155e75', border: '#22d3ee' },
  { bg: '#f0f9ff', text: '#0c4a6e', border: '#38bdf8' },
  
  // 黄绿色系 (8)
  { bg: '#fef9c3', text: '#713f12', border: '#fde047' },
  { bg: '#fefce8', text: '#713f12', border: '#fde047' },
  { bg: '#fef3c7', text: '#78350f', border: '#fcd34d' },
  { bg: '#fef9c3', text: '#854d0e', border: '#facc15' },
  { bg: '#ecfccb', text: '#3f6212', border: '#bef264' },
  { bg: '#fefce8', text: '#65a30d', border: '#a3e635' },
  { bg: '#f7fee7', text: '#1a2e05', border: '#84cc16' },
  { bg: '#ecfccb', text: '#365314', border: '#a3e635' },
  
  // 中性灰色系 (8)
  { bg: '#f5f5f4', text: '#1c1917', border: '#a8a29e' },
  { bg: '#fafaf9', text: '#292524', border: '#a8a29e' },
  { bg: '#f5f5f5', text: '#171717', border: '#a3a3a3' },
  { bg: '#fafafa', text: '#262626', border: '#a3a3a3' },
  { bg: '#f8fafc', text: '#0f172a', border: '#94a3b8' },
  { bg: '#f1f5f9', text: '#1e293b', border: '#94a3b8' },
  { bg: '#f9fafb', text: '#111827', border: '#9ca3af' },
  { bg: '#f3f4f6', text: '#1f2937', border: '#9ca3af' }
];
function getTagColor(tag) {
  const hash = tag.split('').reduce((acc, char) => char.charCodeAt(0) + acc, 0);
  return tagColors[hash % tagColors.length];
}

// 瀑布流左右优先：将图片分配到多列
const columnCount = ref(5);
const columns = computed(() => {
  const cols = Array.from({ length: columnCount.value }, () => []);
  const heights = new Array(columnCount.value).fill(0);
  
  entries.value.forEach((entry) => {
    // 找到最短的列
    const minIndex = heights.indexOf(Math.min(...heights));
    cols[minIndex].push(entry);
    heights[minIndex] += 1; // 简化：假设每个图片高度相同
  });
  
  return cols;
});

// 响应式列数
function updateColumnCount() {
  const width = window.innerWidth;
  if (width < 576) columnCount.value = 1;
  else if (width < 768) columnCount.value = 2;
  else if (width < 992) columnCount.value = 3;
  else if (width < 1200) columnCount.value = 4;
  else columnCount.value = 5;
}

onMounted(() => {
  load();
  updateColumnCount();
  window.addEventListener('resize', updateColumnCount);
});
</script>

<template>
  <div class="gallery-page">
    <!-- 导航栏 -->
    <nav class="navbar">
      <div class="container">
        <h1 class="navbar-brand">图床</h1>
        <div class="navbar-actions">
          <button @click="forceRefreshAll" class="btn btn-outline-secondary btn-sm">
            <span>🔄</span> 刷新全部
          </button>
          <button @click="logout" class="btn btn-outline-secondary btn-sm">登出</button>
        </div>
      </div>
    </nav>

    <div class="container">
      <!-- 加载状态 -->
      <div v-if="loading" class="text-center py-5">
        <div class="spinner"></div>
        <p class="mt-3">加载中...</p>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="alert alert-danger">{{ error }}</div>

      <!-- 统计信息 -->
      <div v-if="entries.length > 0" class="stats">
        共 {{ entries.length }} 张图片
      </div>

      <!-- 瀑布流网格（左右优先） -->
      <div class="masonry-grid" v-if="!loading">
        <div 
          v-for="(column, colIndex) in columns" 
          :key="colIndex"
          class="masonry-column"
        >
          <div 
            v-for="entry in column" 
            :key="entry.id" 
            class="masonry-item card"
            @click="open(entry)"
          >
            <!-- 图片容器 -->
            <div class="image-container">
              <img 
                v-if="entry.src" 
                :src="entry.src" 
                :alt="entry.prompt"
                class="card-img-top"
              />
              <div v-else class="image-placeholder">
                <div class="mini-spinner"></div>
              </div>
              
              <!-- 刷新按钮 -->
              <button 
                class="refresh-btn" 
                @click.stop="refreshSingleImage(entry)"
                title="刷新此图片"
              >
                🔄
              </button>
            </div>

            <!-- Tags -->
            <div class="card-body">
              <div class="tags">
                <span 
                  v-for="(tag, idx) in parseTags(entry.prompt).slice(0, 5)" 
                  :key="idx"
                  class="badge badge-colored"
                  :style="{ 
                    backgroundColor: getTagColor(tag).bg, 
                    color: getTagColor(tag).text,
                    borderColor: getTagColor(tag).border
                  }"
                >
                  {{ tag }}
                </span>
                <span v-if="parseTags(entry.prompt).length > 5" class="badge badge-secondary">
                  +{{ parseTags(entry.prompt).length - 5 }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!loading && entries.length === 0" class="text-center py-5">
        <p class="text-muted">暂无图片</p>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <ImageDetail 
      v-if="selectedIndex >= 0" 
      :entries="entries"
      :currentIndex="selectedIndex"
      :onClose="close"
      :onPrev="prevImage"
      :onNext="nextImage"
      :onRefresh="() => refreshSingleImage(entries[selectedIndex])" 
    />
  </div>
</template>

<style scoped>
.gallery-page {
  min-height: 100vh;
  padding-bottom: 2rem;
}

/* 导航栏 */
.navbar {
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 1rem 0;
  margin-bottom: 1.5rem;
}

.navbar .container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.navbar-brand {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.navbar-actions {
  display: flex;
  gap: 0.5rem;
}

/* 容器 */
.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* 按钮 */
.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
}

/* 加载动画 */
.spinner {
  width: 3rem;
  height: 3rem;
  border: 0.25rem solid var(--border-color);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.mini-spinner {
  width: 2rem;
  height: 2rem;
  border: 0.2rem solid var(--border-color);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* 警告框 */
.alert {
  padding: 0.75rem 1.25rem;
  margin-bottom: 1rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
}

.alert-danger {
  color: #842029;
  background-color: #f8d7da;
  border-color: #f5c2c7;
}

[data-theme="dark"] .alert-danger {
  color: #ea868f;
  background-color: #2c0b0e;
  border-color: #842029;
}

/* 统计信息 */
.stats {
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

/* 瀑布流网格 */
.masonry-grid {
  display: flex;
  gap: 1rem;
}

.masonry-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* 瀑布流项目 */
.masonry-item {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.masonry-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* 图片容器 */
.image-container {
  position: relative;
  background: var(--bg-tertiary);
}

.card-img-top {
  width: 100%;
  height: auto;
  display: block;
}

.image-placeholder {
  width: 100%;
  aspect-ratio: 3/4;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 刷新按钮 */
.refresh-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background: var(--bg-secondary);
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.masonry-item:hover .refresh-btn {
  opacity: 1;
}

.refresh-btn:hover {
  background: var(--bg-tertiary);
}

/* 卡片主体 */
.card-body {
  padding: 0.75rem;
}

/* Tags */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: 0.25rem;
}

.badge-colored {
  border: 1.5px solid;
  font-weight: 600;
  transition: transform 0.2s, box-shadow 0.2s;
}

.badge-colored:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.badge-secondary {
  background-color: var(--text-muted);
  color: var(--bg-primary);
}

/* 工具类 */
.text-center {
  text-align: center;
}

.py-5 {
  padding-top: 3rem;
  padding-bottom: 3rem;
}

.mt-3 {
  margin-top: 1rem;
}

.text-muted {
  color: var(--text-muted);
}

/* 响应式 */
@media (max-width: 768px) {
  .navbar-actions {
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .btn-sm {
    width: 100%;
  }
}
</style>
