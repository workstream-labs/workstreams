<script setup lang="ts">
import { ref, onMounted } from "vue";
import DiscordIcon from "./icons/DiscordIcon.vue";
import GitHubIcon from "./icons/GitHubIcon.vue";
import AppleIcon from "./icons/AppleIcon.vue";
import CheckCircleIcon from "./icons/CheckCircleIcon.vue";

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
          <a href="https://discord.gg/xG4hn8WFR" class="dl-nav-discord" target="_blank" title="Discord">
            <DiscordIcon /> Discord
          </a>
          <a
            :href="`https://github.com/${REPO}`"
            class="dl-nav-gh"
            target="_blank"
          >
            <GitHubIcon /> GitHub
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
              <AppleIcon :size="32" />
            </div>
            <h3>Apple Silicon</h3>
            <p>M1, M2, M3, M4</p>
          </button>

          <button class="dl-card" @click="startDownload('x64')">
            <div class="dl-card-icon">
              <AppleIcon :size="32" />
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
            <CheckCircleIcon />
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
.dl-nav-discord {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--t2); text-decoration: none;
  font-size: 0.88rem; font-weight: 500;
  transition: color 0.15s;
}
.dl-nav-discord:hover { color: #5865F2; }

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
