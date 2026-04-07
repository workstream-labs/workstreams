import DefaultTheme from "vitepress/theme";
import { h, watch } from "vue";
import { useRoute } from "vitepress";
import CustomHome from "./CustomHome.vue";
import DownloadPage from "./DownloadPage.vue";
import "./custom.css";

const CUSTOM_PAGES = ["/", "/index.html", "/download", "/download.html"];

export default {
  extends: DefaultTheme,
  Layout() {
    const route = useRoute();

    watch(
      () => route.path,
      (path) => {
        if (CUSTOM_PAGES.includes(path)) {
          document.documentElement.classList.add("is-home");
        } else {
          document.documentElement.classList.remove("is-home");
        }
      },
      { immediate: true }
    );

    return h(DefaultTheme.Layout);
  },
  enhanceApp({ app }) {
    app.component("CustomHome", CustomHome);
    app.component("DownloadPage", DownloadPage);
  },
};
