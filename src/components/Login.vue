<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const username = ref('');
const password = ref('');
const error = ref('');
const turnstileToken = ref('');
const turnstileWidgetId = ref(null);
const emit = defineEmits(['login']);

// Turnstile 配置 - 需要在环境变量或配置中设置
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'; // 测试用的 site key

onMounted(() => {
  // 初始化 Cloudflare Turnstile
  if (window.turnstile) {
    turnstileWidgetId.value = window.turnstile.render('#turnstile-container', {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => {
        turnstileToken.value = token;
      },
      'error-callback': () => {
        error.value = '人机验证失败，请刷新页面重试';
      },
      theme: 'light',
      size: 'normal',
    });
  }
});

onBeforeUnmount(() => {
  if (window.turnstile && turnstileWidgetId.value !== null) {
    window.turnstile.remove(turnstileWidgetId.value);
  }
});

async function submit() {
  error.value = '';
  
  // 验证 Turnstile token
  if (!turnstileToken.value) {
    error.value = '请完成人机验证';
    return;
  }
  
  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: username.value, 
        password: password.value,
        turnstileToken: turnstileToken.value 
      }),
    });
    const j = await resp.json();
    if (!resp.ok) {
      error.value = j.error || '登录失败';
      // 重置 Turnstile
      if (window.turnstile && turnstileWidgetId.value !== null) {
        window.turnstile.reset(turnstileWidgetId.value);
        turnstileToken.value = '';
      }
      return;
    }
    localStorage.setItem('gallery_token', j.token);
    emit('login');
  } catch (e) {
    error.value = String(e);
    // 重置 Turnstile
    if (window.turnstile && turnstileWidgetId.value !== null) {
      window.turnstile.reset(turnstileWidgetId.value);
      turnstileToken.value = '';
    }
  }
}
</script>

<template>
  <div class="login-container">
    <div class="login-card card">
      <div class="card-body">
        <div class="text-center mb-4">
          <h2 class="mb-2">图床</h2>
          <p class="text-muted">请登录您的账户</p>
        </div>
        
        <form @submit.prevent="submit">
          <div class="mb-3">
            <label for="username" class="form-label">用户名</label>
            <input 
              id="username"
              v-model="username" 
              type="text"
              class="form-control"
              placeholder="请输入用户名"
              autocomplete="username"
              required
            />
          </div>
          
          <div class="mb-3">
            <label for="password" class="form-label">密码</label>
            <input 
              id="password"
              v-model="password" 
              type="password"
              class="form-control"
              placeholder="请输入密码"
              autocomplete="current-password"
              required
            />
          </div>

          <!-- Cloudflare Turnstile 人机验证 -->
          <div class="mb-3">
            <div id="turnstile-container"></div>
          </div>

          <div v-if="error" class="alert alert-danger">
            {{ error }}
          </div>
          
          <button type="submit" class="btn btn-primary w-100">
            登录
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.login-card {
  max-width: 400px;
  width: 100%;
}

.card-body {
  padding: 2rem;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-3 {
  margin-bottom: 1rem;
}

.mb-4 {
  margin-bottom: 1.5rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-control {
  display: block;
  width: 100%;
  padding: 0.375rem 0.75rem;
  font-size: 1rem;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.form-control:focus {
  outline: 0;
  border-color: #86b7fe;
  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);
}

.w-100 {
  width: 100%;
}

#turnstile-container {
  display: flex;
  justify-content: center;
}

@media (max-width: 576px) {
  .card-body {
    padding: 1.5rem;
  }
}
</style>
