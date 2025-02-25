import * as path from 'path';
import fs from 'fs';
import { Plugin } from 'vite';
import viteReact from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';
import { allowedEnvPrefix as envPrefix } from './envs';
import { codeGeneratorPlugin } from './code-generator-plugin';
import { injectExportOrderPlugin } from './inject-export-order-plugin';
import { mdxPlugin } from './plugins/mdx-plugin';
import { noFouc } from './plugins/no-fouc';
import type { ExtendedOptions } from './types';

export type PluginConfigType = 'build' | 'development';

export function readPackageJson(): Record<string, any> | false {
  const packageJsonPath = path.resolve('package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const jsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  return JSON.parse(jsonContent);
}

// Vite config that is common to development and production mode
export async function commonConfig(
  options: ExtendedOptions,
  _type: PluginConfigType
): Promise<UserConfig & { configFile: false; root: string }> {
  return {
    configFile: false,
    root: path.resolve(options.configDir, '..'),
    cacheDir: 'node_modules/.vite-storybook',
    envPrefix,
    define: {},
    plugins: await pluginConfig(options, _type),
  };
}

export async function pluginConfig(options: ExtendedOptions, _type: PluginConfigType) {
  const { framework, presets } = options;
  const svelteOptions: Record<string, any> = await presets.apply('svelteOptions', {}, options);

  const plugins = [
    codeGeneratorPlugin(options),
    // sourceLoaderPlugin(options),
    mdxPlugin(options),
    noFouc(),
    injectExportOrderPlugin,
    // We need the react plugin here to support MDX.
    viteReact({
      // Do not treat story files as HMR boundaries, storybook itself needs to handle them.
      exclude: [/\.stories\.([tj])sx?$/, /node_modules/].concat(
        framework === 'react' ? [] : [/\.([tj])sx?$/]
      ),
    }),
    {
      name: 'vite-plugin-storybook-allow',
      enforce: 'post',
      config(config) {
        // if there is no allow list then Vite allows anything in the root directory
        // if there is an allow list then Vite allows anything in the listed directories
        // add the .storybook directory only if there's an allow list so that we don't end up
        // disallowing the root directory unless it's already disallowed
        if (config?.server?.fs?.allow) {
          config.server.fs.allow.push('.storybook');
        }
      },
    },
  ] as Plugin[];
  if (framework === 'svelte') {
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const sveltePlugin = require('@sveltejs/vite-plugin-svelte').svelte;

      // We need to create two separate svelte plugins, one for stories, and one for other svelte files
      // because stories.svelte files cannot be hot-module-reloaded.
      // Suggested in: https://github.com/sveltejs/vite-plugin-svelte/issues/321#issuecomment-1113205509

      // First, create an array containing user exclude patterns, to combine with ours.

      let userExclude = [];
      if (Array.isArray(svelteOptions?.exclude)) {
        userExclude = svelteOptions?.exclude;
      } else if (svelteOptions?.exclude) {
        userExclude = [svelteOptions?.exclude];
      }

      // These are the svelte stories we need to exclude from HMR
      const storyPatterns = ['**/*.story.svelte', '**/*.stories.svelte'];
      // Non-story svelte files
      // Starting in 1.0.0-next.42, svelte.config.js is included by default.
      // We disable that, but allow it to be overridden in svelteOptions
      plugins.push(sveltePlugin({ ...svelteOptions, exclude: [...userExclude, ...storyPatterns] }));
      // Svelte stories without HMR
      const storySveltePlugin = sveltePlugin({
        ...svelteOptions,
        exclude: userExclude,
        include: storyPatterns,
        hot: false,
      });
      plugins.push({
        // Starting in 1.0.0-next.43, the plugin function returns an array of plugins.  We only want the first one here.
        ...(Array.isArray(storySveltePlugin) ? storySveltePlugin[0] : storySveltePlugin),
        name: 'vite-plugin-svelte-stories',
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        throw new Error(
          '@storybook/builder-vite requires @sveltejs/vite-plugin-svelte to be installed' +
            ' when using @storybook/svelte.' +
            '  Please install it and start storybook again.'
        );
      }
      throw err;
    }

    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const { loadSvelteConfig } = require('@sveltejs/vite-plugin-svelte');
    const config = { ...loadSvelteConfig(), ...svelteOptions };

    try {
      // eslint-disable-next-line global-require
      const csfPlugin = require('./svelte/csf-plugin').default;
      plugins.push(csfPlugin(config));
    } catch (err) {
      // Not all projects use `.stories.svelte` for stories, and by default 6.5+ does not auto-install @storybook/addon-svelte-csf.
      // If it's any other kind of error, re-throw.
      if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    }

    const { svelteDocgen } = await import('./plugins/svelte-docgen');
    plugins.push(svelteDocgen(config));
  }

  if (framework === 'preact') {
    // eslint-disable-next-line global-require
    plugins.push(require('@preact/preset-vite').default());
  }

  if (framework === 'glimmerx') {
    // eslint-disable-next-line global-require, import/extensions
    const plugin = require('vite-plugin-glimmerx/index.cjs');
    plugins.push(plugin.default());
  }

  return plugins;
}
