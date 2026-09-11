import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "../components/atoms/Tag";

const meta = {
  title: "atoms/Tag",
  component: Tag,
  args: { children: "drive" },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Role: Story = {};
export const Hazard: Story = { args: { children: "plasma leak", tone: "warn" } };
export const Good: Story = { args: { children: "boarding point", tone: "good" } };
export const RoomRoles: Story = {
  render: () => (
    <div>
      <Tag>command</Tag>
      <Tag>weapon</Tag>
      <Tag>quarters</Tag>
      <Tag>service</Tag>
    </div>
  ),
};
