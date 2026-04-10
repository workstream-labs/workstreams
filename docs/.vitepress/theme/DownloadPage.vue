<script setup lang="ts">
import { ref, onMounted } from "vue";
import NavBar from "./NavBar.vue";
import AppleIcon from "./icons/AppleIcon.vue";
import CheckCircleIcon from "./icons/CheckCircleIcon.vue";

const REPO = "workstream-labs/workstreams";
const FALLBACK_TAG = "v0.2.8";
const API_BASE = "https://workstream-api.azurewebsites.net";

const latestTag = ref(FALLBACK_TAG);
const selectedArch = ref<"arm64" | "x64">("arm64");
/**
 * Controls the "Why is this needed?" disclosure panel in the quarantine step.
 * macOS quarantine removal is the most confusing install step for unsigned apps,
 * so we keep the explanation collapsed by default to avoid overwhelming new users
 * while still making it accessible on demand.
 */
const showWhy = ref(false);

function dmgUrl(arch: string) {
  return `https://github.com/${REPO}/releases/download/${latestTag.value}/Workstreams-darwin-${arch}.dmg`;
}

async function fetchLatestTag() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    const data = await res.json();
    latestTag.value = data.tag_name || FALLBACK_TAG;
  } catch {
    // silent
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

onMounted(async () => {
  await fetchLatestTag();

  // Read arch from query param (default to arm64)
  const params = new URLSearchParams(window.location.search);
  const arch = params.get("arch");
  if (arch === "arm64" || arch === "x64") {
    selectedArch.value = arch;
  }
  trackDownload(selectedArch.value);
  // Start download after a brief delay so the page renders first
  setTimeout(() => {
    window.location.href = dmgUrl(selectedArch.value);
  }, 500);
});
</script>

<template>
  <div class="dl">
    <div class="dl-bg" aria-hidden="true">
      <div class="dl-grid"></div>
      <div class="dl-fade"></div>
    </div>

    <!-- Nav -->
    <NavBar />

    <div class="dl-content">
      <!-- Download started: show instructions -->
        <div class="dl-started">
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
              <p>Drag the Workstreams icon into the Applications folder.</p>
              <img src="/dmg-install.png" alt="Drag Workstreams to Applications" class="dl-step-img" />
            </div>
          </div>
          <div class="dl-step">
            <span class="dl-step-num">3</span>
            <div>
              <h4>Remove quarantine flag</h4>
              <p>Since the app isn't signed with an Apple certificate yet, macOS will block it. Run this command to allow it:</p>
              <div class="dl-cmd">
                <code>xattr -cr /Applications/Workstreams.app</code>
              </div>
              <div class="dl-details">
                <button class="dl-details-toggle" @click="showWhy = !showWhy">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" :class="{ rotated: showWhy }"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.3-5.3 5.4z"/></svg>
                  Why is this needed?
                </button>
                <div v-if="showWhy" class="dl-details-body">
                  <p>
                    When you download a DMG from the internet, macOS tags every file
                    with a hidden <code>com.apple.quarantine</code> flag. Gatekeeper
                    then checks if the app has an Apple Developer certificate. Since
                    this build isn't signed or notarised, macOS shows a misleading
                    "app is damaged" error&thinsp;&mdash;&thinsp;the app is fine, it
                    just doesn't have a $99/year Apple signature.
                  </p>
                  <p>
                    <code>xattr -cr</code> strips the quarantine flag so Gatekeeper
                    has nothing to complain about.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div class="dl-step">
            <span class="dl-step-num">4</span>
            <div>
              <h4>Launch Workstreams</h4>
              <p>Open the app from Applications. You're all set!</p>
            </div>
          </div>
        </div>

        <div class="dl-retry">
          <p>
            Download didn't start?
            <a :href="dmgUrl(selectedArch)" class="dl-retry-link">Try again</a>
          </p>
        </div>
    </div>
  </div>
</template>

<style scoped>
/* Alias shared :root tokens from custom.css */
.dl {
  --bg: var(--ws-bg);
  --bg2: var(--ws-bg2);
  --bg3: var(--ws-bg3);
  --border: var(--ws-border);
  --border-h: var(--ws-border-h);
  --t1: var(--ws-t1);
  --t2: var(--ws-t2);
  --t3: var(--ws-t3);
  --accent: var(--ws-accent);
  --font-d: var(--ws-font-d);
  --font-b: var(--ws-font-b);
  --font-m: var(--ws-font-m);
  --r: var(--ws-r);
  --r-lg: var(--ws-r-lg);

  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: var(--bg);
  font-family: var(--font-b);
  color: var(--t1);
  -webkit-font-smoothing: antialiased;
}

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
  display: flex; flex-direction: column;
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
.dl-step p { font-size: 0.9rem; line-height: 1.6; color: var(--t2); margin: 0; }
.dl-step code {
  font-family: var(--font-m); font-size: 0.82rem;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.06); color: var(--t1);
}

.dl-step-img {
  margin-top: 16px;
  border-radius: var(--r);
  overflow: hidden;
  max-width: 100%;
  border: 1px solid var(--border);
}

.dl-cmd {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  font-family: var(--font-m);
  font-size: 0.85rem;
  color: var(--t1);
  user-select: all;
}

.dl-details {
  margin-top: 14px;
}

.dl-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--t2);
  font-family: var(--font-b);
  font-size: 0.85rem;
  font-weight: 500;
  transition: color 0.15s;
}
.dl-details-toggle:hover { color: var(--t1); }

.dl-details-toggle svg {
  transition: transform 0.2s ease;
}
.dl-details-toggle svg.rotated {
  transform: rotate(90deg);
}

.dl-details-body p {
  margin: 10px 0 0;
  line-height: 1.6;
  color: var(--t2);
  font-size: 0.85rem;
  padding: 0;
}
.dl-details-body code {
  font-family: var(--font-m);
  font-size: 0.8rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--t1);
}

.dl-retry { font-size: 0.88rem; color: var(--t3); }
.dl-retry-link { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

@media (max-width: 500px) {
  .dl-content { padding: 120px 16px 80px; }
  .dl-title { font-size: 1.8rem; }
}
</style>
