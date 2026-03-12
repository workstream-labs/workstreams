import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Workstream",
  description:
    "Orchestrate parallel AI coding agents in isolated git worktrees",

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
      { text: "Guide", link: "/getting-started/installation" },
      { text: "Reference", link: "/reference/cli" },
      {
        text: "GitHub",
        link: "https://github.com/workstream-labs/workstreams",
      },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Installation", link: "/getting-started/installation" },
          { text: "Quickstart", link: "/getting-started/quickstart" },
          { text: "Configuration", link: "/getting-started/configuration" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Concepts", link: "/guide/concepts" },
          { text: "Running Workstreams", link: "/guide/running" },
          { text: "Dashboard", link: "/guide/dashboard" },
          { text: "Reviewing Changes", link: "/guide/reviewing" },
          { text: "Resuming Work", link: "/guide/resuming" },
          { text: "Merging", link: "/guide/merging" },
          { text: "Agents", link: "/guide/agents" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI Commands", link: "/reference/cli" },
          { text: "Config Schema", link: "/reference/config" },
          {
            text: "Keyboard Shortcuts",
            link: "/reference/keyboard-shortcuts",
          },
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
      message: "Built with VitePress",
    },
  },
});
