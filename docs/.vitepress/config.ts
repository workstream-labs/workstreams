import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Workstreams",
  description:
    "Desktop IDE for parallel AI coding in isolated git worktrees",

  head: [
    [
      "link",
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>%E2%9A%A1</text></svg>",
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: "Get Started", link: "/getting-started/installation" },
      { text: "Guide", link: "/guide/concepts" },
      {
        text: "GitHub",
        link: "https://github.com/workstream-labs/workstreams",
      },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Download & Build", link: "/getting-started/installation" },
          { text: "Quickstart", link: "/getting-started/quickstart" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Workstreams & Switching", link: "/guide/concepts" },
          { text: "Sidebar & Workspace State", link: "/guide/dashboard" },
          { text: "Review Loop", link: "/guide/reviewing" },
          { text: "Agent Lifecycle", link: "/guide/resuming" },
          { text: "Agent Options", link: "/guide/agents" },
        ],
      },
    ],

    search: {
      provider: "local",
    },

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/workstream-labs/workstreams",
      },
    ],

    footer: {
      message: "Desktop-first docs for Workstreams",
    },
  },
});
