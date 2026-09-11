import type { Preview } from "@storybook/react-vite";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      options: {
        void: { name: "void", value: "#0e1114" },
        panel: { name: "panel", value: "#181d22" },
      },
    },
    controls: { matchers: { color: /(background|color)$/i } },
  },
  initialGlobals: { backgrounds: { value: "void" } },
};

export default preview;
