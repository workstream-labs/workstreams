import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Workstreams",
  description:
    "Desktop IDE for parallel AI coding in isolated git worktrees",
  appearance: "dark",

  head: [
    [
      "link",
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 16 16%22 fill=%22%23cccccc%22><path d=%22M2 3.5h3v1H2v-1zm5 0h7v1H7v-1zM2 7.5h3v1H2v-1zm5 0h7v1H7v-1zM2 11.5h3v1H2v-1zm5 0h7v1H7v-1z%22/><path d=%22M3.5 3L1.5 4l2 1V3zM3.5 7L1.5 8l2 1V7zM3.5 11l-2 1 2 1v-2z%22/></svg>",
      },
    ],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    [
      "link",
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@1,400;1,500&family=Lilex:wght@400;500;600;700&display=swap",
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: "Get Started", link: "/getting-started/installation" },
      { text: "Guide", link: "/guide/concepts" },
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
      {
        icon: "discord",
        link: "https://discord.gg/xG4hn8WFR",
      },
    ],

    footer: {
      message: "Desktop-first docs for Workstreams",
    },
  },
});
