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

    <!-- ========== FEATURES WITH SCREENSHOTS ========== -->
    <section class="features">
      <div class="container">

        <!-- 1. Inline Review Comments — text left, image right -->
        <div class="showcase sr">
          <div class="showcase-text">
            <span class="showcase-label">Review</span>
            <h3 class="showcase-title">Inline review comments</h3>
            <p class="showcase-desc">
              Split-side diff viewer with inline commenting. Click any line to
              leave feedback, add context, or flag issues&thinsp;&mdash;&thinsp;just
              like a code review, but for your AI agents. Supports both
              <strong>online</strong> comments from GitHub and <strong>offline</strong>
              local comments.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/commenting-view.png" alt="Split diff with inline review comments" />
          </div>
        </div>

        <!-- 2. Resume with feedback — image left, text right -->
        <div class="showcase showcase-reverse sr">
          <div class="showcase-text">
            <span class="showcase-label">Resume</span>
            <h3 class="showcase-title">Send feedback to the agent</h3>
            <p class="showcase-desc">
              Select which comments to send, hit Send All, and the agent resumes
              with full conversation context. Your feedback becomes structured
              prompts with file paths, line numbers, and diff
              context&thinsp;&mdash;&thinsp;iterate until the code is right.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/sending-comments.png" alt="Sending review comments to Claude" />
          </div>
        </div>

        <!-- 3. Create workstreams — text left, image right -->
        <div class="showcase sr">
          <div class="showcase-text">
            <span class="showcase-label">Create</span>
            <h3 class="showcase-title">Natural language task creation</h3>
            <p class="showcase-desc">
              Describe what you want built, pick an agent and a refactor
              strategy, and go. Each workstream gets its own branch and isolated
              worktree automatically. Supports Claude Code, Aider, Gemini, and
              more.
            </p>
          </div>
          <div class="showcase-img">
            <img src="/creating-workstream.png" alt="Create workstream with agent selector" />
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
          <h2 class="cta-title">Ready to ship in&nbsp;parallel?</h2>
          <p class="cta-sub">
            Download the desktop app and run your first parallel agents in
            under a minute.
          </p>
          <div class="cta-actions">
            <a href="/download" class="btn btn-primary">
              <AppleIcon /> Download for macOS
            </a>
            <a href="https://github.com/workstream-labs/workstreams" class="btn btn-ghost" target="_blank">
              <GitHubIcon /> View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
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
section { position: relative; z-index: 1; }

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
.features { padding: 0 0 80px; }

.showcase {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 48px;
  align-items: center;
  padding: 56px 48px;
  margin-bottom: 24px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--bg2);
  transition: border-color 0.3s;
}
.showcase:hover { border-color: var(--border-h); }

.showcase-reverse { grid-template-columns: 1.3fr 1fr; }
.showcase-reverse .showcase-text { order: 2; }
.showcase-reverse .showcase-img { order: 1; }

.showcase-label {
  display: inline-block;
  font-family: var(--font-m); font-size: 0.72rem; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--accent); margin-bottom: 14px;
}

.showcase-title {
  font-family: var(--font-d); font-size: 1.6rem; font-weight: 700;
  margin: 0 0 14px; color: var(--t1); line-height: 1.2;
}

.showcase-desc {
  font-size: 0.95rem; line-height: 1.7; color: var(--t2); margin: 0;
}
.showcase-desc strong { color: var(--t1); font-weight: 600; }

.showcase-img {
  border-radius: var(--r);
  overflow: hidden;
  border: 1px solid var(--border);
}
.showcase-img img { width: 100%; display: block; }

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
.cta { padding: 20px 0 120px; }
.cta-inner {
  text-align: center; padding: 72px 40px;
  border-radius: var(--r-lg); border: 1px solid var(--border);
  background: var(--bg2); position: relative; overflow: hidden;
}
.cta-inner::before {
  content: ""; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 50%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: 0.4;
}
.cta-title {
  font-family: var(--font-d); font-size: clamp(1.6rem, 3.5vw, 2.4rem);
  font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px;
}
.cta-sub { font-size: 1rem; color: var(--t2); margin: 0 auto 32px; max-width: 480px; }
.cta-actions { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }

/* ===== RESPONSIVE ===== */
@media (max-width: 860px) {
  .showcase { grid-template-columns: 1fr; padding: 32px 24px; gap: 28px; }
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
