<script setup>
import { ref, onMounted, onUnmounted, computed, inject, nextTick } from "vue";
import ImageDetail from "./ImageDetail.vue";

const token = localStorage.getItem("gallery_token");
const entries = ref([]);
const loading = ref(false);
const error = ref("");
const selectedIndex = ref(-1);
let pollTimer = null;
let loadMoreObserver = null;
const loadMoreAnchor = ref(null);
const loadingMore = ref(false);
const hasMore = ref(true);
const paginationCursor = ref(null);
const PAGE_SIZE = 60;
const pendingImageLoads = new Set();

// 从 App 提供的 theme 注入
const theme = inject('theme', ref('light'));
const toggleTheme = inject('toggleTheme', null);

// 删除模态与提示
const showDeleteModal = ref(false);
const pendingDelete = ref(null);
const toastMessage = ref('');
const showToast = ref(false);
const batchMode = ref(false);
const selectedEntryIds = ref([]);
const pendingDeleteIds = new Set();
const selectedCount = computed(() => selectedEntryIds.value.length);
const allEntriesSelected = computed(() => (
  entries.value.length > 0 && selectedEntryIds.value.length === entries.value.length
));

function showToastMsg(message, duration = 2500) {
  toastMessage.value = message;
  showToast.value = true;
  setTimeout(() => {
    showToast.value = false;
    toastMessage.value = '';
  }, duration);
}

function syncSelectionWithEntries() {
  const visibleIds = new Set(entries.value.map((entry) => entry.id));
  selectedEntryIds.value = selectedEntryIds.value.filter((id) => visibleIds.has(id));
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value;
  selectedIndex.value = -1;
  if (!batchMode.value) {
    selectedEntryIds.value = [];
  }
}

function isEntrySelected(entryId) {
  return selectedEntryIds.value.includes(entryId);
}

function toggleEntrySelection(entryId) {
  if (!entryId) return;
  if (isEntrySelected(entryId)) {
    selectedEntryIds.value = selectedEntryIds.value.filter((id) => id !== entryId);
  } else {
    selectedEntryIds.value = [...selectedEntryIds.value, entryId];
  }
}

function clearBatchSelection() {
  selectedEntryIds.value = [];
}

function toggleSelectAllEntries() {
  if (allEntriesSelected.value) {
    clearBatchSelection();
    return;
  }
  selectedEntryIds.value = entries.value.map((entry) => entry.id);
}

function openDeleteModal(entry) {
  pendingDelete.value = entry;
  showDeleteModal.value = true;
}

function cancelDelete() {
  pendingDelete.value = null;
  showDeleteModal.value = false;
}

async function performDelete() {
  const entry = pendingDelete.value;
  if (!entry || !entry.id) return;
  showDeleteModal.value = false;

  const snapshot = hideEntryOptimistically(entry.id);

  try {
    await requestDeleteById(entry.id);
    finalizeDeleteSuccess(entry);
    showToastMsg('已删除');
  } catch (e) {
    console.error('Delete failed', e);
    restoreHiddenEntry(snapshot);
    showToastMsg('删除失败: ' + String(e.message || e), 3500);
  } finally {
    pendingDelete.value = null;
  }
}

async function performBatchDelete() {
  const targetEntries = entries.value.filter((entry) => selectedEntryIds.value.includes(entry.id));
  if (targetEntries.length === 0) {
    showToastMsg('请先选择要删除的图片');
    return;
  }

  const ok = window.confirm(`确定要删除选中的 ${targetEntries.length} 张图片吗？此操作不可恢复。`);
  if (!ok) return;

  const targets = targetEntries.map((entry) => ({
    entry,
    snapshot: hideEntryOptimistically(entry.id)
  }));

  selectedEntryIds.value = [];
  batchMode.value = false;

  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    try {
      await requestDeleteById(target.entry.id);
      finalizeDeleteSuccess(target.entry);
      successCount += 1;
    } catch (e) {
      console.error('Batch delete failed', e);
      restoreHiddenEntry(target.snapshot);
      failCount += 1;
    }
  }

  if (failCount === 0) {
    showToastMsg(`已删除 ${successCount} 张图片`);
  } else {
    showToastMsg(`已删除 ${successCount} 张，${failCount} 张删除失败`, 3500);
  }
}

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
    // 仅缓存首屏，避免本地缓存过大
    const topList = Array.isArray(list) ? list.slice(0, PAGE_SIZE) : [];
    localStorage.setItem(GALLERY_LIST_CACHE_KEY, JSON.stringify(topList));
  } catch (e) {
    console.error('Failed to cache gallery list:', e);
  }
}

function removeEntryFromLocalCache(entry) {
  const cached = getGalleryListCache() || [];
  setGalleryListCache(cached.filter((item) => item.id !== entry.id));

  try {
    const fileId = entry.telegram?.file_id;
    if (!fileId) return;
    const imageCache = getImageCache();
    if (imageCache[fileId]) {
      delete imageCache[fileId];
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(imageCache));
    }
  } catch (e) {
    // ignore cache cleanup errors
  }
}

function hideEntryOptimistically(entryId) {
  const index = entries.value.findIndex((entry) => entry.id === entryId);
  if (index < 0) return null;

  const [entry] = entries.value.splice(index, 1);

  if (selectedIndex.value === index) {
    selectedIndex.value = -1;
  } else if (selectedIndex.value > index) {
    selectedIndex.value -= 1;
  }

  pendingDeleteIds.add(entryId);
  syncSelectionWithEntries();
  return { entry, index };
}

function restoreHiddenEntry(snapshot) {
  if (!snapshot || !snapshot.entry) return;

  pendingDeleteIds.delete(snapshot.entry.id);
  if (entries.value.some((entry) => entry.id === snapshot.entry.id)) return;

  const insertIndex = Math.min(snapshot.index, entries.value.length);
  entries.value.splice(insertIndex, 0, snapshot.entry);

  if (selectedIndex.value >= insertIndex) {
    selectedIndex.value += 1;
  }
  syncSelectionWithEntries();
}

function finalizeDeleteSuccess(entry) {
  pendingDeleteIds.delete(entry.id);
  removeEntryFromLocalCache(entry);
  syncSelectionWithEntries();
}

async function requestDeleteById(entryId) {
  const resp = await fetch('/api/gallery', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ id: entryId })
  });

  let body = null;
  try {
    body = await resp.json();
  } catch (e) {
    body = null;
  }

  if (!resp.ok) {
    throw new Error(body?.error || '删除失败');
  }

  return body;
}

function buildEntryWithCache(entry, existingEntry, imageCache, forceImageRefresh = false) {
  const fileId = entry.telegram?.file_id;
  const cachedData = fileId && imageCache[fileId];
  const keepExistingSrc = Boolean(existingEntry?.src) && !forceImageRefresh;

  let loadingState = false;
  if (forceImageRefresh) {
    loadingState = Boolean(fileId);
  } else if (keepExistingSrc) {
    loadingState = false;
  } else if (existingEntry?.loading && !cachedData) {
    loadingState = true;
  } else {
    loadingState = Boolean(fileId) && !cachedData;
  }

  return {
    ...existingEntry,
    ...entry,
    src: keepExistingSrc ? existingEntry.src : (cachedData && !forceImageRefresh ? cachedData.url : null),
    loading: loadingState,
  };
}

async function fetchGalleryPage(cursor = null, limit = PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);

  const resp = await fetch(`/api/gallery?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  let body = null;
  try {
    body = await resp.json();
  } catch (e) {
    body = null;
  }

  if (!resp.ok) {
    throw new Error(body?.error || 'Failed to load');
  }

  // 兼容后端旧版（数组）
  if (Array.isArray(body)) {
    const items = body;
    return {
      items,
      hasMore: items.length >= limit,
      nextCursor: items.length > 0 ? items[items.length - 1].id : null,
    };
  }

  return {
    items: Array.isArray(body?.items) ? body.items : [],
    hasMore: Boolean(body?.hasMore),
    nextCursor: body?.nextCursor || null,
  };
}

async function loadEntryImage(entry) {
  const fileId = entry.telegram?.file_id;
  if (!fileId) return;
  if (entry.src && !entry.loading) return;
  if (pendingImageLoads.has(fileId)) return;

  pendingImageLoads.add(fileId);
  try {
    // 直接将 src 设置为后端的 fileurl 接口，让浏览器直接请求图片
    const imageUrl = `/api/fileurl?file_id=${encodeURIComponent(fileId)}`;
    entry.src = imageUrl;
    entry.loading = false;
    setImageCache(fileId, imageUrl);
  } catch (err) {
    console.error('Failed to load image:', err);
    entry.loading = false;
  } finally {
    pendingImageLoads.delete(fileId);
  }
}

function queueImageLoads(targetEntries) {
  targetEntries.forEach((entry) => {
    if (!entry.telegram?.file_id) return;
    if (entry.src && !entry.loading) return;
    void loadEntryImage(entry);
  });
}

function mergeTopPage(serverItems, forceImageRefresh = false, keepExistingTail = false) {
  const visibleServerList = serverItems.filter((e) => !pendingDeleteIds.has(e.id));
  const imageCache = forceImageRefresh ? {} : getImageCache();
  const existingById = new Map(entries.value.map((entry) => [entry.id, entry]));
  const topEntries = visibleServerList.map((entry) =>
    buildEntryWithCache(entry, existingById.get(entry.id), imageCache, forceImageRefresh)
  );

  if (keepExistingTail) {
    const topIds = new Set(topEntries.map((entry) => entry.id));
    const tail = entries.value.filter((entry) => !topIds.has(entry.id));
    entries.value = [...topEntries, ...tail];
  } else {
    entries.value = topEntries;
  }

  setGalleryListCache(visibleServerList);
  queueImageLoads(entries.value);
  syncSelectionWithEntries();
}

// 加载图片数据（优化：先显示缓存，再异步更新）
async function load(forceImageRefresh = false, forceListRefresh = false) {
  error.value = "";
  const hadEntries = entries.value.length > 0;

  if (!forceListRefresh) {
    const cachedList = getGalleryListCache();
    if (cachedList && cachedList.length > 0) {
      const visibleCachedList = cachedList
        .slice(0, PAGE_SIZE)
        .filter((e) => !pendingDeleteIds.has(e.id));
      const imageCache = forceImageRefresh ? {} : getImageCache();
      entries.value = visibleCachedList.map((entry) =>
        buildEntryWithCache(entry, null, imageCache, forceImageRefresh)
      );
      queueImageLoads(entries.value);
      loading.value = false;
    } else {
      loading.value = true;
    }
  } else if (!hadEntries) {
    // 背景轮询：仅当当前没有任何条目时显示加载指示，避免刷新时的闪烁
    loading.value = true;
  }

  try {
    const page = await fetchGalleryPage(null, PAGE_SIZE);
    mergeTopPage(page.items, forceImageRefresh, forceListRefresh);

    // 首次加载/重置时，更新分页游标；后台刷新时保留现有游标，避免打断下滑连续加载。
    if (!forceListRefresh || !hadEntries) {
      paginationCursor.value = page.nextCursor;
      hasMore.value = page.hasMore;
    } else if (!paginationCursor.value) {
      paginationCursor.value = page.nextCursor;
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
    if (!loadMoreObserver) {
      nextTick(() => {
        setupLoadMoreObserver();
      });
    }
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value) return;
  if (!hasMore.value || !paginationCursor.value) return;

  loadingMore.value = true;
  try {
    const page = await fetchGalleryPage(paginationCursor.value, PAGE_SIZE);
    const visibleItems = page.items.filter((entry) => !pendingDeleteIds.has(entry.id));
    const imageCache = getImageCache();
    const existingIds = new Set(entries.value.map((entry) => entry.id));
    const appendedEntries = [];

    visibleItems.forEach((entry) => {
      if (existingIds.has(entry.id)) return;
      appendedEntries.push(buildEntryWithCache(entry, null, imageCache, false));
      existingIds.add(entry.id);
    });

    if (appendedEntries.length > 0) {
      entries.value = [...entries.value, ...appendedEntries];
      queueImageLoads(appendedEntries);
      syncSelectionWithEntries();
    }

    paginationCursor.value = page.nextCursor;
    hasMore.value = page.hasMore;
  } catch (e) {
    error.value = String(e);
  } finally {
    loadingMore.value = false;
  }
}

function setupLoadMoreObserver() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
  if (!loadMoreAnchor.value) return;

  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
  }

  loadMoreObserver = new IntersectionObserver(
    (observedEntries) => {
      if (observedEntries.some((item) => item.isIntersecting)) {
        void loadMore();
      }
    },
    {
      root: null,
      rootMargin: '600px 0px 600px 0px',
      threshold: 0.01,
    }
  );

  loadMoreObserver.observe(loadMoreAnchor.value);
}

// 刷新单个图片
async function refreshSingleImage(entry) {
  if (!entry.telegram?.file_id) return;
  
  entry.loading = true;
  try {
    // 直接使用 fileurl 接口作为图片源，并添加时间戳强制刷新
    const imageUrl = `/api/fileurl?file_id=${encodeURIComponent(entry.telegram.file_id)}&t=${Date.now()}`;
    entry.src = imageUrl;
    entry.loading = false;
    
    // 更新缓存
    setImageCache(entry.telegram.file_id, imageUrl);
  } catch (err) {
    console.error('Failed to refresh image:', err);
    entry.loading = false;
  }
}

// 全部强制刷新
function forceRefreshAll() {
  // 从数据库刷新画廊列表（不强制刷新图片 URL）
  load(false, true);
}

async function clearImageCache() {
  const ok = window.confirm('确定要清除图片缓存吗？清除后会重新加载图片。');
  if (!ok) return;

  try {
    localStorage.removeItem(IMAGE_CACHE_KEY);

    entries.value = entries.value.map((entry) => ({
      ...entry,
      src: null,
      loading: Boolean(entry.telegram?.file_id)
    }));

    toastMessage.value = '图片缓存已清除，正在重新加载';
    showToast.value = true;
    setTimeout(() => { showToast.value = false; toastMessage.value = ''; }, 2500);

    await load(true, false);
  } catch (e) {
    console.error('Failed to clear image cache:', e);
    toastMessage.value = '清除图片缓存失败: ' + String(e.message || e);
    showToast.value = true;
    setTimeout(() => { showToast.value = false; toastMessage.value = ''; }, 3500);
  }
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
  nextTick(() => {
    setupLoadMoreObserver();
  });

  // 每 60 秒轮询服务器，合并新图片列表（从数据库刷新列表，不强制刷新图片 URL）
  pollTimer = setInterval(() => {
    load(false, true);
  }, 60000);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateColumnCount);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }
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
          <button
            @click="clearImageCache"
            class="btn btn-outline-secondary btn-sm"
            title="清除图片缓存并重新加载"
          >
            清缓存
          </button>
          <button
            v-if="!batchMode"
            @click="toggleBatchMode"
            class="btn btn-outline-secondary btn-sm"
            title="开启批量删除模式"
          >
            批量删除
          </button>
          <button
            v-else
            @click="toggleSelectAllEntries"
            class="btn btn-outline-secondary btn-sm"
            :title="allEntriesSelected ? '取消全选' : '全选当前图片'"
          >
            {{ allEntriesSelected ? '取消全选' : '全选' }}
          </button>
          <button
            v-if="batchMode"
            @click="clearBatchSelection"
            class="btn btn-outline-secondary btn-sm"
            title="清空当前选择"
          >
            清空选择
          </button>
          <button
            v-if="batchMode"
            @click="performBatchDelete"
            class="btn btn-danger btn-sm"
            :disabled="selectedCount === 0"
            title="删除选中的图片"
          >
            删除选中({{ selectedCount }})
          </button>
          <button
            v-if="batchMode"
            @click="toggleBatchMode"
            class="btn btn-outline-secondary btn-sm"
            title="退出批量删除模式"
          >
            退出批量
          </button>
          <button 
            v-if="toggleTheme" 
            @click="toggleTheme()" 
            class="btn btn-outline-secondary btn-sm"
            :title="theme === 'light' ? '切换到深色模式' : '切换到亮色模式'"
          >
            {{ theme === 'light' ? '🌙' : '☀️' }}
          </button>

          <button 
            v-if="selectedIndex >= 0" 
            @click="refreshSingleImage(entries[selectedIndex])" 
            class="btn btn-outline-secondary btn-sm"
            title="刷新当前图片"
          >
            🔄 当前
          </button>

          <button @click="logout" class="btn btn-outline-secondary btn-sm">登出</button>
          </div>
      </div>
    </nav>

      <!-- 删除确认模态 -->
      <div v-if="showDeleteModal" class="modal-backdrop" @click.self="cancelDelete">
        <div class="modal-card">
          <div class="modal-header">
            <h3>确认删除</h3>
          </div>
          <div class="modal-body">
            <p>确定要删除这张图片吗？此操作不可恢复。</p>
            <p v-if="pendingDelete?.prompt" class="muted small">{{ pendingDelete.prompt }}</p>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" @click="cancelDelete">取消</button>
            <button class="btn btn-danger" @click="performDelete">删除</button>
          </div>
        </div>
      </div>

      <!-- 顶部短提示 (toast) -->
      <div v-if="showToast" class="top-toast">{{ toastMessage }}</div>

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
        已加载 {{ entries.length }} 张图片
      </div>
      <div v-if="batchMode" class="batch-tip">
        已选择 {{ selectedCount }} 张，点击图片可选择/取消选择
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
            :class="{ 'is-selected': batchMode && isEntrySelected(entry.id) }"
            @click="batchMode ? toggleEntrySelection(entry.id) : open(entry)"
          >
            <!-- 图片容器 -->
            <div class="image-container">
              <button
                v-if="batchMode"
                class="select-btn"
                :class="{ selected: isEntrySelected(entry.id) }"
                @click.stop="toggleEntrySelection(entry.id)"
                :title="isEntrySelected(entry.id) ? '取消选择' : '选择该图片'"
              >
                {{ isEntrySelected(entry.id) ? '✓' : '' }}
              </button>
              <img 
                v-if="entry.src" 
                :src="entry.src" 
                :alt="entry.prompt"
                class="card-img-top"
              />
              <div v-else class="image-placeholder">
                <div class="mini-spinner"></div>
              </div>
              
              <!-- 删除按钮 -->
              <button 
                class="refresh-btn" 
                @click.stop="openDeleteModal(entry)"
                title="删除此图片"
              >
                🗑️
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

      <div v-if="!loading && entries.length > 0" class="load-more-status">
        <span v-if="loadingMore">正在加载更多图片...</span>
        <span v-else-if="hasMore">下滑自动加载更多图片</span>
        <span v-else>已加载全部图片</span>
      </div>

      <div
        ref="loadMoreAnchor"
        class="load-more-anchor"
        v-show="!loading && hasMore && entries.length > 0"
        aria-hidden="true"
      ></div>

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

.batch-tip {
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.load-more-status {
  margin: 1.25rem 0 0.75rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.load-more-anchor {
  width: 100%;
  height: 1px;
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

.masonry-item.is-selected {
  box-shadow: 0 0 0 2px var(--primary), var(--shadow-lg);
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

.select-btn {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.select-btn.selected {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
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

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10,10,10,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.modal-card {
  width: 90%;
  max-width: 520px;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(2,6,23,0.6);
  overflow: hidden;
  border: 1px solid var(--border-color);
}
.modal-header {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}
.modal-header h3 { margin: 0; }
.modal-body { padding: 1rem 1.25rem; color: var(--text-primary); }
.modal-actions { padding: 0.75rem 1.25rem; display:flex; gap:0.5rem; justify-content:flex-end; }
.btn-danger { background: #ef4444; color: white; border: none; padding: 0.6rem 1rem; border-radius: 8px; cursor: pointer; }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem 0.9rem; border-radius: 8px; cursor: pointer; }

/* Top toast */
.top-toast {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(90deg,var(--primary),var(--primary-hover));
  color: white;
  padding: 0.6rem 1rem;
  border-radius: 999px;
  z-index: 2100;
  box-shadow: 0 8px 30px rgba(0,0,0,0.35);
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
