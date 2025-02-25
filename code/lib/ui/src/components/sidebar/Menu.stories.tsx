import { expect } from '@storybook/jest';
import React, { Fragment, FunctionComponent } from 'react';

import { WithTooltip, TooltipLinkList, Icons } from '@storybook/components';
import { styled } from '@storybook/theming';
import { within, userEvent, screen } from '@storybook/testing-library';
import { MenuItemIcon, SidebarMenu, ToolbarMenu } from './Menu';
import { useMenu } from '../../containers/menu';

export default {
  component: MenuItemIcon,
  title: 'UI/Sidebar/Menu',
  decorators: [
    (StoryFn: FunctionComponent) => (
      <Fragment>
        <StoryFn />
      </Fragment>
    ),
  ],
};

const fakemenu = [
  { title: 'has icon', left: <MenuItemIcon icon="check" />, id: 'icon' },
  {
    title: 'has imgSrc',
    left: <MenuItemIcon imgSrc="https://storybook.js.org/images/placeholders/20x20.png" />,
    id: 'img',
  },
  { title: 'has neither', left: <MenuItemIcon />, id: 'non' },
];

export const Items = () => <TooltipLinkList links={fakemenu} />;

export const Real = () => <SidebarMenu menu={fakemenu} isHighlighted />;

export const Toolbar = () => <ToolbarMenu menu={fakemenu} />;

const DoubleThemeRenderingHack = styled.div({
  '#storybook-root > [data-side="left"] > &': {
    textAlign: 'right',
  },
});

export const Expanded = () => {
  const menu = useMenu(
    {
      // @ts-ignore
      getShortcutKeys: () => ({}),
      getAddonsShortcuts: () => ({}),
      versionUpdateAvailable: () => false,
      releaseNotesVersion: () => '6.0.0',
    },
    false,
    false,
    false,
    false,
    false
  );
  return (
    <DoubleThemeRenderingHack>
      <SidebarMenu menu={menu} isHighlighted />
    </DoubleThemeRenderingHack>
  );
};
Expanded.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const menuButton = await canvas.findByRole('button');
  await userEvent.click(menuButton);
  const aboutStorybookBtn = await screen.findByText(/About your Storybook/);
  await expect(aboutStorybookBtn).toBeInTheDocument();
};

export const ExpandedWithoutReleaseNotes = () => {
  const menu = useMenu(
    {
      // @ts-ignore
      getShortcutKeys: () => ({}),
      getAddonsShortcuts: () => ({}),
      versionUpdateAvailable: () => false,
      releaseNotesVersion: () => undefined,
    },
    false,
    false,
    false,
    false,
    false
  );

  return (
    <DoubleThemeRenderingHack>
      <SidebarMenu menu={menu} />
    </DoubleThemeRenderingHack>
  );
};
ExpandedWithoutReleaseNotes.play = async (context) => {
  const canvas = within(context.canvasElement);
  await Expanded.play(context);
  const releaseNotes = await canvas.queryByText(/Release notes/);
  await expect(releaseNotes).not.toBeInTheDocument();
};
