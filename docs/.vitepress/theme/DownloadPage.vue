<script setup lang="ts">
import { ref, onMounted } from "vue";

const REPO = "workstream-labs/workstreams";
const FALLBACK_TAG = "v0.2.8";

const API_BASE = "https://workstream-api.azurewebsites.net";

const latestTag = ref(FALLBACK_TAG);
const downloadCount = ref<number | null>(null);
const selectedArch = ref<"arm64" | "x64" | null>(null);
const downloading = ref(false);

function dmgUrl(arch: string) {
  return `https://github.com/${REPO}/releases/download/${latestTag.value}/Workstreams-darwin-${arch}.dmg`;
}

async function fetchLatestTag() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    const data = await res.json();
    latestTag.value = data.tag_name || FALLBACK_TAG;

    // Sum download counts from DMG assets
    const dmgAssets = (data.assets || []).filter((a: any) =>
      a.name.endsWith(".dmg")
    );
    const ghCount = dmgAssets.reduce(
      (sum: number, a: any) => sum + (a.download_count || 0),
      0
    );
    downloadCount.value = ghCount;
  } catch {
    // silent
  }
}

async function fetchDownloadCount() {
  if (!API_BASE) return;
  try {
    const res = await fetch(`${API_BASE}/api/download-count`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.total != null) {
      downloadCount.value = (downloadCount.value || 0) + data.total;
    }
  } catch {
    // silent — GitHub count is the fallback
  }
}

async function trackDownload(arch: string) {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        architecture: arch,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // non-blocking
  }
}

async function startDownload(arch: "arm64" | "x64") {
  selectedArch.value = arch;
  downloading.value = true;

  // Track in background, don't block download
  trackDownload(arch);

  // Start download
  window.location.href = dmgUrl(arch);
}

onMounted(() => {
  fetchLatestTag().then(fetchDownloadCount);
});
</script>

<template>
  <div class="dl">
    <div class="dl-bg" aria-hidden="true">
      <div class="dl-grid"></div>
      <div class="dl-fade"></div>
    </div>

    <!-- Nav (same as landing page) -->
    <nav class="dl-nav">
      <div class="dl-nav-inner">
        <a href="/" class="dl-nav-logo">Workstream</a>
        <div class="dl-nav-right">
          <a href="/getting-started/installation" class="dl-nav-link">Docs</a>
          <a href="/guide/concepts" class="dl-nav-link">Guide</a>
          <a href="/reference/cli" class="dl-nav-link">Reference</a>
          <a
            :href="`https://github.com/${REPO}`"
            class="dl-nav-gh"
            target="_blank"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>
    </nav>

    <div class="dl-content">
      <!-- Before download: arch picker -->
      <template v-if="!downloading">
        <h1 class="dl-title">Download Workstream</h1>
        <p class="dl-sub">
          Choose your Mac architecture to start the download.
        </p>

        <!-- Download count hidden for now — uncomment when numbers are meaningful
        <div v-if="downloadCount != null" class="dl-count">
          {{ downloadCount.toLocaleString() }} downloads
        </div>
        -->

        <div class="dl-cards">
          <button class="dl-card" @click="startDownload('arm64')">
            <div class="dl-card-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
            </div>
            <h3>Apple Silicon</h3>
            <p>M1, M2, M3, M4</p>
          </button>

          <button class="dl-card" @click="startDownload('x64')">
            <div class="dl-card-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
            </div>
            <h3>Intel</h3>
            <p>x86_64</p>
          </button>
        </div>

        <p class="dl-version">
          {{ latestTag }} &middot; macOS 12+
        </p>
      </template>

      <!-- After download: instructions -->
      <template v-else>
        <div class="dl-started">
          <div class="dl-check">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <h1 class="dl-title">Your download has started</h1>
          <p class="dl-sub">
            Workstreams for
            <strong>{{ selectedArch === "arm64" ? "Apple Silicon" : "Intel" }}</strong>
            is downloading. Here's how to install:
          </p>
        </div>

        <div class="dl-steps">
          <div class="dl-step">
            <span class="dl-step-num">1</span>
            <div>
              <h4>Open the .dmg file</h4>
              <p>Find <code>Workstreams-darwin-{{ selectedArch }}.dmg</code> in your Downloads folder and double-click to open.</p>
            </div>
          </div>

          <div class="dl-step">
            <span class="dl-step-num">2</span>
            <div>
              <h4>Drag to Applications</h4>
              <p>Drag the Workstreams icon into your Applications folder.</p>
            </div>
          </div>

          <div class="dl-step">
            <span class="dl-step-num">3</span>
            <div>
              <h4>Launch Workstreams</h4>
              <p>Open the app from Applications. If macOS shows a security prompt, go to <strong>System Settings &rarr; Privacy &amp; Security</strong> and click <strong>Open Anyway</strong>.</p>
            </div>
          </div>
        </div>

        <div class="dl-retry">
          <p>
            Download didn't start?
            <a :href="dmgUrl(selectedArch!)" class="dl-retry-link">Try again</a>
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dl {
  --bg: #0a0a0a;
  --bg2: #111;
  --bg3: #161616;
  --border: rgba(255, 255, 255, 0.08);
  --border-h: rgba(255, 255, 255, 0.14);
  --t1: #fafafa;
  --t2: #888;
  --t3: #555;
  --accent: #34d399;
  --font-d: "IBM Plex Sans", system-ui, sans-serif;
  --font-b: "IBM Plex Sans", system-ui, sans-serif;
  --font-m: "Lilex", "Fira Code", monospace;
  --r: 12px;
  --r-lg: 16px;

  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: var(--bg);
  font-family: var(--font-b);
  color: var(--t1);
  -webkit-font-smoothing: antialiased;
}

/* BG */
.dl-bg { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; }
.dl-grid {
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M60 0H0v60' fill='none' stroke='rgba(255,255,255,0.06)' stroke-width='0.5'/%3E%3C/svg%3E");
  background-size: 60px 60px;
}
.dl-fade {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 40%, transparent 30%, var(--bg) 70%);
}

/* Nav */
.dl-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  padding: 0 32px;
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
}
.dl-nav-inner {
  max-width: 1200px; margin: 0 auto; height: 60px;
  display: flex; align-items: center; justify-content: space-between;
}
.dl-nav-logo {
  font-family: var(--font-d); font-size: 1.1rem; font-weight: 800;
  color: var(--t1); text-decoration: none; letter-spacing: -0.02em;
}
.dl-nav-right { display: flex; align-items: center; gap: 16px; }
.dl-nav-link {
  color: var(--t2); text-decoration: none; font-size: 0.88rem; font-weight: 500;
  transition: color 0.15s;
}
.dl-nav-link:hover { color: var(--t1); }
.dl-nav-gh {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--t2); text-decoration: none; font-size: 0.88rem; font-weight: 500;
  transition: color 0.15s;
}
.dl-nav-gh:hover { color: var(--t1); }

/* Content */
.dl-content {
  position: relative; z-index: 1;
  max-width: 640px; margin: 0 auto;
  padding: 160px 24px 120px;
  text-align: center;
}

.dl-title {
  font-family: var(--font-d); font-size: 2.4rem; font-weight: 700;
  letter-spacing: -0.03em; margin: 0 0 14px; line-height: 1.15;
}

.dl-sub {
  font-size: 1.05rem; line-height: 1.65; color: var(--t2); margin: 0 0 24px;
}
.dl-sub strong { color: var(--t1); font-weight: 600; }

.dl-count {
  display: inline-block;
  padding: 5px 14px; border-radius: 100px;
  border: 1px solid var(--border); background: rgba(255,255,255,0.03);
  font-family: var(--font-m); font-size: 0.78rem; color: var(--t2);
  margin-bottom: 36px;
}

/* Arch cards */
.dl-cards {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 16px; margin-bottom: 24px;
}

.dl-card {
  padding: 36px 24px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--bg2);
  cursor: pointer;
  text-align: center;
  transition: all 0.25s ease;
  font-family: var(--font-b);
  color: var(--t1);
}
.dl-card:hover {
  border-color: var(--accent);
  background: var(--bg3);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(52,211,153,0.1);
}

.dl-card-icon {
  margin-bottom: 16px; color: var(--t2);
}
.dl-card:hover .dl-card-icon { color: var(--t1); }

.dl-card h3 {
  font-family: var(--font-d); font-size: 1.2rem; font-weight: 700;
  margin: 0 0 6px;
}
.dl-card p {
  font-size: 0.85rem; color: var(--t2); margin: 0;
  font-family: var(--font-m);
}

.dl-version {
  font-family: var(--font-m); font-size: 0.78rem; color: var(--t3); margin: 0;
}

/* Post-download */
.dl-started { margin-bottom: 48px; }

.dl-check {
  color: var(--accent); margin-bottom: 24px;
  animation: checkPop 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes checkPop {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 1; transform: scale(1); }
}

.dl-steps {
  text-align: left;
  display: flex; flex-direction: column; gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  margin-bottom: 32px;
}

.dl-step {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 24px;
  border-bottom: 1px solid var(--border);
}
.dl-step:last-child { border-bottom: none; }

.dl-step-num {
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: rgba(52,211,153,0.1);
  color: var(--accent);
  font-family: var(--font-m); font-size: 0.82rem; font-weight: 600;
}

.dl-step h4 {
  font-family: var(--font-d); font-size: 1rem; font-weight: 600;
  margin: 0 0 6px; color: var(--t1);
}
.dl-step p {
  font-size: 0.9rem; line-height: 1.6; color: var(--t2); margin: 0;
}
.dl-step code {
  font-family: var(--font-m); font-size: 0.82rem;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.06); color: var(--t1);
}

.dl-retry {
  font-size: 0.88rem; color: var(--t3);
}
.dl-retry-link {
  color: var(--accent); text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 500px) {
  .dl-cards { grid-template-columns: 1fr; }
  .dl-content { padding: 120px 16px 80px; }
  .dl-title { font-size: 1.8rem; }
}
</style>
