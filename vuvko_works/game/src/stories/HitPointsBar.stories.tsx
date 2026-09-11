import type { Meta, StoryObj } from "@storybook/react-vite";
import { HitPointsBar } from "../components/atoms/HitPointsBar";

const meta = {
  title: "atoms/HitPointsBar",
  component: HitPointsBar,
  args: { current: 12, max: 12, showNumbers: true },
} satisfies Meta<typeof HitPointsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {};
export const Hurt: Story = { args: { current: 7, max: 12 } };
export const Critical: Story = { args: { current: 2, max: 12 } };
export const Destroyed: Story = { args: { current: 0, max: 12 } };
export const Scout: Story = { args: { current: 4, max: 4 } };
