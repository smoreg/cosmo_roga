import type { Meta, StoryObj } from "@storybook/react-vite";
import { OddsBar } from "../components/atoms/OddsBar";

const meta = {
  title: "atoms/OddsBar",
  component: OddsBar,
  args: { chance: 0.5625, label: "kills it" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof OddsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Even: Story = {};
export const Certain: Story = { args: { chance: 1, label: "kills it" } };
export const Never: Story = { args: { chance: 0, label: "you die", tone: "bad" } };
export const Risky: Story = { args: { chance: 0.31, label: "you die", tone: "bad" } };
