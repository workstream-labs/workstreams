<script setup lang="ts">
import DiscordIcon from "./icons/DiscordIcon.vue";
import GitHubIcon from "./icons/GitHubIcon.vue";
</script>

<template>
  <nav class="ws-nav">
    <div class="ws-nav-inner">
      <a href="/" class="ws-nav-logo">Workstreams</a>
      <div class="ws-nav-right">
        <a href="/getting-started/installation" class="ws-nav-link">Docs</a>
        <a href="/guide/concepts" class="ws-nav-link">Guide</a>
        <a href="https://discord.gg/xG4hn8WFR" class="ws-nav-discord" target="_blank" title="Discord">
          <DiscordIcon /> Discord
        </a>
        <a href="https://github.com/workstream-labs/workstreams" class="ws-nav-gh" target="_blank">
          <GitHubIcon /> GitHub
        </a>
        <slot />
      </div>
    </div>
  </nav>
</template>

<style scoped>
.ws-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 0 32px;
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--ws-border);
}

.ws-nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ws-nav-logo {
  font-family: var(--ws-font-d);
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--ws-t1);
  text-decoration: none;
  letter-spacing: -0.02em;
}

.ws-nav-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ws-nav-link {
  color: var(--ws-t2);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.ws-nav-link:hover { color: var(--ws-t1); }

.ws-nav-discord {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ws-t2);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.ws-nav-discord:hover { color: #5865F2; }

.ws-nav-gh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ws-t2);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: color 0.15s;
}
.ws-nav-gh:hover { color: var(--ws-t1); }

@media (max-width: 768px) {
  .ws-nav { padding: 0 16px; }
}
</style>
