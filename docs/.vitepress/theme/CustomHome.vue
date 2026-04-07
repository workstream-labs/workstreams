<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import DiscordIcon from "./icons/DiscordIcon.vue";
import GitHubIcon from "./icons/GitHubIcon.vue";
import AppleIcon from "./icons/AppleIcon.vue";
import DownloadIcon from "./icons/DownloadIcon.vue";
import ArrowRightIcon from "./icons/ArrowRightIcon.vue";

// --- FAQ ---
const faqOpen = ref<number | null>(null);
function toggleFaq(i: number) {
  faqOpen.value = faqOpen.value === i ? null : i;
}

const faqs = [
  {
    q: "What is Workstreams?",
    a: "An open-source desktop IDE for orchestrating parallel AI coding agents. Define tasks, let agents run in isolated git worktrees simultaneously, then review and iterate from a single interface.",
  },
  {
    q: "Which AI agents does it support?",
    a: "Workstreams is agent-agnostic. Claude Code has deep integration with session capture, resume, and auto-commit. Aider and Gemini are also supported, with Codex coming soon.",
  },
  {
    q: "How do git worktrees work?",
    a: "Each agent gets its own isolated git worktree — a separate working directory sharing the same .git history. Agents work in parallel without file conflicts. Worktree creation is serialized to prevent git lock races, then agents run fully parallel.",
  },
  {
    q: "Is it free?",
    a: "Yes. Workstreams is fully open source. It orchestrates AI agents that you already have installed — there are no extra accounts, subscriptions, or API keys required by Workstreams itself.",
  },
  {
    q: "Does it work with my editor?",
    a: "Workstreams is a standalone desktop IDE for macOS with full LSP support, syntax highlighting, and an integrated terminal. It runs as its own app — no extensions or plugins needed.",
  },
  {
    q: "Can I use it with GitHub PRs?",
    a: "Yes. Workstreams supports pulling online comments from GitHub alongside local offline review comments. Both are included when resuming agents, so your feedback loop spans across tools.",
  },
];

// --- Companies ---
const companies = [
  { name: "LinkedIn", domain: "linkedin.com" },
  { name: "Uber", domain: "uber.com" },
  { name: "Intuit", domain: "intuit.com" },
  { name: "Oracle", domain: "oracle.com" },
  { name: "Simbian", domain: "simbian.ai" },
  { name: "Google", domain: "google.com" },
  { name: "Rubrik", domain: "rubrik.com" },
  { name: "Amazon", domain: "amazon.com" },
  { name: "Great Kapital", domain: "greatkapital.com" },
  { name: "American Express", domain: "americanexpress.com" },
  { name: "Glean", domain: "glean.com" },
  { name: "DE Shaw", domain: "deshaw.com" },
];

// --- Download count ---
const downloadCount = ref<number | null>(null);

async function fetchDownloadCount() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/workstream-labs/workstreams/releases/latest"
    );
    if (!res.ok) return;
    const data = await res.json();
    const dmgs = (data.assets || []).filter((a: any) =>
      a.name.endsWith(".dmg")
    );
    downloadCount.value = dmgs.reduce(
      (sum: number, a: any) => sum + (a.download_count || 0),
      0
    );
  } catch {
    // silent
  }
}

// --- Scroll reveal ---
let observer: IntersectionObserver | null = null;

onMounted(async () => {
  fetchDownloadCount();
  await nextTick();
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add("visible");
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -30px 0px" }
  );
  document.querySelectorAll(".sr").forEach((el) => observer!.observe(el));
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="ws">
    <!-- BG -->
    <div class="ws-bg" aria-hidden="true">
      <div class="ws-grid"></div>
      <div class="ws-fade"></div>
    </div>

    <!-- ========== NAV ========== -->
    <nav class="nav">
      <div class="nav-inner">
        <a href="/" class="nav-logo">Workstream</a>
        <div class="nav-right">
          <a href="/getting-started/installation" class="nav-link">Docs</a>
          <a href="/guide/concepts" class="nav-link">Guide</a>
          <a href="https://discord.gg/xG4hn8WFR" class="nav-discord" target="_blank" title="Discord">
            <DiscordIcon /> Discord
          </a>
          <a href="https://github.com/workstream-labs/workstreams" class="nav-gh" target="_blank">
            <GitHubIcon /> GitHub
          </a>
          <a href="/download" class="nav-download">
            Download for macOS
            <DownloadIcon />
          </a>
        </div>
      </div>
    </nav>

    <!-- ========== HERO ========== -->
    <section class="hero">
      <div class="hero-inner">
        <h1 class="hero-title anim" style="--d: 0">
          The IDE for parallel<br />AI coding agents
        </h1>

        <p class="hero-sub anim" style="--d: 1">
          Run dozens of AI agents simultaneously in isolated git worktrees.
          Review diffs, leave inline comments, resume with
          feedback&thinsp;&mdash;&thinsp;all from one interface.
        </p>

        <!-- Download count hidden for now — uncomment when numbers are meaningful
        <div v-if="downloadCount != null" class="hero-count anim" style="--d: 2">
          {{ downloadCount.toLocaleString() }} downloads
        </div>
        -->

        <div class="hero-actions anim" style="--d: 3">
          <a href="/download" class="btn btn-primary">
            <AppleIcon /> Download for macOS
          </a>
          <a href="https://github.com/workstream-labs/workstreams" class="btn btn-ghost" target="_blank">
            <GitHubIcon /> View on GitHub
          </a>
        </div>

        <div class="hero-image anim" style="--d: 4">
          <img src="/session-view.png" alt="Workstream IDE — worktree sidebar, agent session, and workspace explorer" class="hero-screenshot" />
        </div>
      </div>
    </section>

    <!-- ========== TRUSTED BY ========== -->
    <section class="trusted sr">
      <h3 class="trusted-title">
        Trusted by world-class developers
      </h3>
      <div class="trusted-logos">
        <img v-for="c in companies" :key="c.name" :src="`https://img.logo.dev/${c.domain}?token=pk_MdLdiT0EQ6uFB9FQBG3xcA&size=120&format=png`" :alt="c.name" class="trusted-logo" />
      </div>
    </section>

    <!-- ========== TAGLINE ========== -->
    <section class="tagline sr">
      <h2 class="tagline-text">
        Ship code <span class="gradient">10&times; faster</span> with no context switching
      </h2>
    </section>

    <!-- ========== FEATURES ========== -->
    <section class="features">
      <div class="container">

        <!-- 1. Parallel Execution -->
        <div class="showcase sr">
          <div class="showcase-text">
            <span class="showcase-label">Orchestrate</span>
            <h3 class="showcase-title">Run dozens of agents at once</h3>
            <p class="showcase-desc">
              Spin up agents across multiple repos from a single orchestration
              panel. Track live status for every agent&thinsp;&mdash;&thinsp;get
              notified instantly when one needs your permission.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/session-view.png" alt="Orchestration panel with multiple agents" />
          </div>
        </div>

        <!-- 2. Agent Agnostic -->
        <div class="showcase showcase-reverse sr">
          <div class="showcase-text">
            <span class="showcase-label">Agents</span>
            <h3 class="showcase-title">Works with any CLI agent</h3>
            <p class="showcase-desc">
              Deeply integrated with <strong>Claude Code</strong> and
              <strong>Codex</strong>, but the terminal is your open
              playground&thinsp;&mdash;&thinsp;run any agent of your choice.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/creating-workstream.png" alt="Agent selection with Claude Code and Codex" />
          </div>
        </div>

        <!-- 3. Isolation -->
        <div class="showcase sr">
          <div class="showcase-text">
            <span class="showcase-label">Isolation</span>
            <h3 class="showcase-title">Changes are isolated</h3>
            <p class="showcase-desc">
              Every agent works in its own git worktree. No conflicts, no
              stepping on each other. Each branch is fully isolated, backed
              by git&thinsp;&mdash;&thinsp;merge when you're ready.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/commenting-view.png" alt="Isolated worktrees with split diff view" />
          </div>
        </div>

        <!-- 4. Review Loop -->
        <div class="showcase showcase-reverse sr">
          <div class="showcase-text">
            <span class="showcase-label">Review loop</span>
            <h3 class="showcase-title">Offline &amp; online comments</h3>
            <p class="showcase-desc">
              Write <strong>offline comments</strong> directly on diffs. Fetch
              <strong>online comments</strong> from GitHub PRs with isolated git
              authorisation per repo. Send them all back to the agent in one
              click.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/sending-comments.png" alt="Review comments sent to agent" />
          </div>
        </div>

        <!-- 5. LSP & Terminal -->
        <div class="showcase sr">
          <div class="showcase-text">
            <span class="showcase-label">Editor</span>
            <h3 class="showcase-title">LSP-integrated full-fledged terminal</h3>
            <p class="showcase-desc">
              A complete development environment with Language Server Protocol
              support, syntax highlighting, and an integrated terminal to back
              you up on everything.
            </p>
          </div>
          <div class="showcase-img showcase-img-placeholder">
            <span>Screenshot coming soon</span>
          </div>
        </div>

      </div>
    </section>


    <!-- ========== FAQ ========== -->
    <section class="faq">
      <div class="container">
        <h2 class="section-title sr" style="text-align:center">Frequently asked questions</h2>
        <div class="faq-list">
          <div
            v-for="(f, i) in faqs"
            :key="i"
            class="faq-item"
            :class="{ open: faqOpen === i }"
          >
            <button class="faq-q" @click="toggleFaq(i)">
              <span>{{ f.q }}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="faq-chevron"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div class="faq-a" :ref="(el) => {}">
              <div class="faq-a-inner">
                <p>{{ f.a }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== CTA ========== -->
    <section class="cta">
      <div class="container">
        <div class="cta-inner sr">
          <h2 class="cta-title">Get Workstreams Today</h2>
          <div class="cta-actions">
            <a href="/download" class="btn btn-primary btn-lg">
              Download for macOS
              <DownloadIcon />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== FOOTER ========== -->
    <footer class="ws-footer">
      <div class="container">
        <div class="footer-top">
          <div class="footer-brand">
            <span class="footer-logo">Workstreams</span>
            <div class="footer-links">
              <a href="/getting-started/installation">Docs</a>
              <a href="/guide/concepts">Guide</a>
            </div>
          </div>
          <div class="footer-social">
            <a href="https://discord.gg/xG4hn8WFR" target="_blank" title="Discord"><DiscordIcon /></a>
            <a href="https://github.com/workstream-labs/workstreams" target="_blank" title="GitHub"><GitHubIcon /></a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; 2026 Workstreams. All rights reserved.</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ===== TOKENS ===== */
.ws {
  --bg: #0a0a0a;
  --bg2: #111;
  --bg3: #161616;
  --border: rgba(255, 255, 255, 0.08);
  --border-h: rgba(255, 255, 255, 0.14);
  --t1: #fafafa;
  --t2: #888;
  --t3: #555;
  --accent: #34d399;
  --accent2: #6ee7b7;
  --cyan: #22d3ee;
  --font-d: "IBM Plex Sans", system-ui, sans-serif;
  --font-b: "IBM Plex Sans", system-ui, sans-serif;
  --font-m: "Lilex", "Fira Code", monospace;
  --r: 12px;
  --r-lg: 16px;

  position: relative;
  width: 100%;
  overflow-x: hidden;
  background: var(--bg);
  font-family: var(--font-b);
  color: var(--t1);
  -webkit-font-smoothing: antialiased;
}

/* ===== BG ===== */
.ws-bg { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; }
.ws-grid {
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M60 0H0v60' fill='none' stroke='rgba(255,255,255,0.06)' stroke-width='0.5'/%3E%3C/svg%3E");
  background-size: 60px 60px;
}
.ws-fade {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 40%, transparent 30%, var(--bg) 70%);
}

/* ===== LAYOUT ===== */
.container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
section, footer { position: relative; z-index: 1; }

/* ===== ANIMATIONS ===== */
.anim {
  opacity: 0; transform: translateY(22px);
  animation: up 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--d, 0) * 0.12s + 0.25s);
}
@keyframes up { to { opacity: 1; transform: translateY(0); } }

.sr {
  opacity: 0; transform: translateY(24px);
  transition: opacity 0.65s cubic-bezier(0.16, 1, 0.3, 1), transform 0.65s cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: calc(var(--stagger, 0) * 0.08s);
}
.sr.visible { opacity: 1; transform: translateY(0); }

/* Showcase slide-in from left */
.showcase.sr {
  opacity: 0; transform: translateX(-60px);
}
.showcase.sr.visible { opacity: 1; transform: translateX(0); }

/* Showcase reverse slide-in from right */
.showcase-reverse.sr {
  opacity: 0; transform: translateX(60px);
}
.showcase-reverse.sr.visible { opacity: 1; transform: translateX(0); }

/* ===== NAV ===== */
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 0 32px;
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
}

.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-logo {
  font-family: var(--font-d);
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--t1);
  text-decoration: none;
  letter-spacing: -0.02em;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.nav-link {
  color: var(--t2);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.nav-link:hover { color: var(--t1); }

.nav-discord {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--t2); text-decoration: none;
  font-size: 0.88rem; font-weight: 500;
  transition: color 0.15s;
}
.nav-discord:hover { color: #5865F2; }

.nav-gh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--t2);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.nav-gh:hover { color: var(--t1); }

.nav-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--t1);
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
  transition: all 0.2s;
}
.nav-download:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-h);
}

@media (max-width: 768px) {
  .nav-links { display: none; }
  .nav-download span { display: none; }
  .nav { padding: 0 16px; }
}

/* ===== HERO ===== */
.hero { padding: 140px 24px 60px; text-align: center; }
.hero-inner { max-width: 1000px; margin: 0 auto; }

.hero-title {
  font-family: var(--font-d); font-size: clamp(2.8rem, 6.5vw, 4.5rem);
  font-weight: 800; line-height: 1.08; letter-spacing: -0.035em;
  margin: 0 0 24px; color: var(--t1);
}

.hero-sub {
  font-size: 1.12rem; line-height: 1.7; color: var(--t2);
  max-width: 580px; margin: 0 auto 36px;
}

.hero-count {
  display: inline-block;
  padding: 5px 14px; border-radius: 100px;
  border: 1px solid var(--border); background: rgba(255,255,255,0.03);
  font-family: var(--font-m); font-size: 0.78rem; color: var(--t2);
  margin-bottom: 28px;
}

/* ===== BUTTONS ===== */
.hero-actions {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; margin-bottom: 64px; flex-wrap: wrap;
}
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px; border-radius: 10px;
  font-family: var(--font-b); font-size: 0.9rem; font-weight: 600;
  text-decoration: none; cursor: pointer; transition: all 0.2s ease; border: none;
}
.btn-primary { background: var(--t1); color: #0a0a0a; }
.btn-primary:hover { background: #ddd; transform: translateY(-1px); }
.btn-ghost { background: transparent; color: var(--t2); border: 1px solid var(--border); }
.btn-ghost:hover { color: var(--t1); border-color: var(--border-h); background: rgba(255,255,255,0.03); }

/* ===== HERO IMAGE ===== */
.hero-image {
  max-width: 100%;
  margin: 0 auto;
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 30px 80px -20px rgba(0,0,0,0.7);
}
.hero-screenshot { width: 100%; display: block; }

/* ===== TAGLINE ===== */
.tagline { padding: 100px 24px; text-align: center; }
.tagline-text {
  font-family: var(--font-d); font-size: clamp(1.6rem, 4vw, 2.8rem);
  font-weight: 700; letter-spacing: -0.025em; color: var(--t2);
  max-width: 650px; margin: 0 auto; line-height: 1.2;
}
.gradient {
  background: linear-gradient(135deg, var(--accent), var(--cyan));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}

/* ===== TRUSTED BY ===== */
.trusted {
  padding: 60px 24px 80px;
  text-align: center;
}

.trusted-title {
  font-family: var(--font-d);
  font-size: clamp(1.3rem, 3vw, 1.8rem);
  font-weight: 500;
  line-height: 1.45;
  color: var(--t3);
  margin: 0 auto 48px;
  max-width: 500px;
}

.trusted-logos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 40px 56px;
  max-width: 1000px;
  margin: 0 auto;
}

.trusted-logo {
  height: 32px;
  width: auto;
  opacity: 0.45;
  filter: grayscale(1) brightness(1.6);
  transition: all 0.3s ease;
}
.trusted-logo:hover {
  opacity: 0.85;
  filter: grayscale(0) brightness(1);
}

/* ===== SHOWCASE FEATURES (with screenshots) ===== */
.features { padding: 0 0 40px; }

.showcase {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 64px;
  align-items: center;
  padding: 80px 0;
  max-width: 1100px;
  margin: 0 auto;
  border-bottom: 1px solid var(--border);
}
.showcase:last-child { border-bottom: none; }

.showcase-reverse { grid-template-columns: 1.4fr 1fr; }
.showcase-reverse .showcase-text { order: 2; }
.showcase-reverse .showcase-img { order: 1; }

.showcase-label {
  display: inline-block;
  font-family: var(--font-m); font-size: 0.7rem; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.12em;
  color: var(--accent); margin-bottom: 16px;
}

.showcase-title {
  font-family: var(--font-d); font-size: 1.8rem; font-weight: 700;
  margin: 0 0 16px; color: var(--t1); line-height: 1.2;
}

.showcase-desc {
  font-size: 0.95rem; line-height: 1.7; color: var(--t2); margin: 0;
}
.showcase-desc strong { color: var(--t1); font-weight: 600; }

.showcase-img {
  border-radius: var(--r);
  overflow: hidden;
  box-shadow: 0 20px 60px -15px rgba(0, 0, 0, 0.5);
}
.showcase-img img { width: 100%; display: block; }

.showcase-img-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: var(--bg2);
  border: 1px dashed var(--border);
  border-radius: var(--r);
  color: var(--t3);
  font-family: var(--font-m);
  font-size: 0.82rem;
}

/* ===== CAPABILITIES GRID ===== */
.capabilities { padding: 40px 0 100px; }

.section-head { text-align: center; margin-bottom: 56px; }
.section-title {
  font-family: var(--font-d); font-size: clamp(1.6rem, 3.5vw, 2.2rem);
  font-weight: 700; letter-spacing: -0.02em; margin: 0 0 14px;
}
.section-sub { font-size: 1.05rem; color: var(--t2); margin: 0; }

.cap-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--border);
}

.cap {
  background: var(--bg2);
  padding: 32px 28px;
  transition: background 0.25s;
}
.cap:hover { background: var(--bg3); }

.cap-icon {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px; color: var(--accent);
}
.cap-icon svg { width: 20px; height: 20px; }

.cap h4 {
  font-family: var(--font-d); font-size: 1rem; font-weight: 700;
  margin: 0 0 8px; color: var(--t1);
}
.cap p {
  font-size: 0.88rem; line-height: 1.6; color: var(--t2); margin: 0;
}

/* ===== FAQ ===== */
.faq { padding: 80px 0 100px; }

.faq-list { max-width: 680px; margin: 0 auto; }

.faq-item { border-bottom: 1px solid var(--border); }
.faq-item:first-child { border-top: 1px solid var(--border); }

.faq-q {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 20px 0; background: none; border: none;
  color: var(--t1); font-family: var(--font-b); font-size: 1rem; font-weight: 500;
  cursor: pointer; text-align: left; transition: color 0.2s;
}
.faq-q:hover { color: var(--accent); }

.faq-chevron {
  flex-shrink: 0; transition: transform 0.3s ease; color: var(--t3);
}
.open .faq-chevron { transform: rotate(180deg); }

.faq-a {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.open .faq-a {
  grid-template-rows: 1fr;
}
.faq-a-inner {
  overflow: hidden;
}
.faq-a p {
  padding: 0 0 20px; margin: 0;
  font-size: 0.92rem; line-height: 1.7; color: var(--t2);
}

/* ===== CTA ===== */
.cta { padding: 80px 0 120px; }
.cta-inner {
  text-align: center; padding: 0;
}
.cta-title {
  font-family: var(--font-m); font-size: clamp(1.6rem, 4vw, 2.8rem);
  font-weight: 500; letter-spacing: -0.02em; margin: 0 0 36px;
  color: var(--t1);
}
.cta-actions { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }

.btn-lg { padding: 14px 32px; font-size: 1rem; }

/* ===== FOOTER ===== */
.ws-footer {
  border-top: 1px solid var(--border);
  padding: 48px 24px;
}

.footer-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 32px;
}

.footer-brand { display: flex; flex-direction: column; gap: 16px; }

.footer-logo {
  font-family: var(--font-d);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--t1);
}

.footer-links {
  display: flex; gap: 20px;
}
.footer-links a {
  color: var(--t2); text-decoration: none; font-size: 0.88rem;
  transition: color 0.15s;
}
.footer-links a:hover { color: var(--t1); }

.footer-social {
  display: flex; gap: 16px;
}
.footer-social a {
  color: var(--t3); text-decoration: none;
  transition: color 0.15s;
}
.footer-social a:hover { color: var(--t1); }

.footer-bottom {
  border-top: 1px solid var(--border);
  padding-top: 24px;
  font-size: 0.8rem;
  color: var(--t3);
}

/* ===== RESPONSIVE ===== */
@media (max-width: 860px) {
  .showcase { grid-template-columns: 1fr; padding: 48px 24px; gap: 32px; }
  .showcase-reverse { grid-template-columns: 1fr; }
  .showcase-reverse .showcase-text { order: 1; }
  .showcase-reverse .showcase-img { order: 2; }
  .cap-grid { grid-template-columns: repeat(2, 1fr); }
  .hero { padding: 110px 20px 40px; }
  .hero-actions { margin-bottom: 48px; }
}

@media (max-width: 640px) {
  .hero { padding: 90px 16px 32px; }
  .hero-title { font-size: 2.3rem; }
  .hero-sub { font-size: 1rem; }
  .hero-actions { flex-direction: column; }
  .btn { width: 100%; justify-content: center; }
  .showcase { padding: 24px 18px; }
  .cap-grid { grid-template-columns: 1fr; }
  .cta-inner { padding: 48px 20px; }
  .cta-actions { flex-direction: column; }
}
</style>
