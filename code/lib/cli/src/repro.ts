import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import { dedent } from 'ts-dedent';
import { createAndInit, exec } from './repro-generators/scripts';
import * as configs from './repro-generators/configs';
import type { Parameters } from './repro-generators/configs';
import { SupportedRenderers } from './project_types';

const logger = console;

interface ReproOptions {
  outputDirectory: string;
  renderer?: SupportedRenderers;
  list?: boolean;
  template?: string;
  e2e?: boolean;
  registry?: string;
  local?: boolean;
  url?: string;
  generator?: string;
  pnp?: boolean;
  /** Skip downloading templates from git and use local generators instead */
  skipGit?: boolean;
}

const TEMPLATES = configs as Record<string, Parameters>;

// Create a curate list of template because some of them only make sense in E2E
// context, fon instance react_in_yarn_workspace
const CURATED_TEMPLATES = Object.fromEntries(
  Object.entries(configs).filter((entry) => entry[0] !== 'react_in_yarn_workspace')
) as Record<string, Parameters>;

const RENDERERS = Object.values(CURATED_TEMPLATES).reduce<Record<SupportedRenderers, Parameters[]>>(
  (acc, cur) => {
    acc[cur.renderer] = [...(acc[cur.renderer] || []), cur];
    return acc;
  },
  {} as Record<SupportedRenderers, Parameters[]>
);

const getRepoNameFromGitUrl = (url: string) => {
  // supports all kinds of git urls
  // https://github.com/Rich-Harris/degit/blob/64b80577acf3313b669840f7452800ee8d09fbf3/src/index.js#L327
  const match =
    /^(?:(?:https:\/\/)?([^:/]+\.[^:/]+)\/|git@([^:/]+)[:/]|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:((?:\/[^/\s#]+)+))?(?:\/)?(?:#(.+))?/.exec(
      url
    );

  if (!match || !match[5]) {
    return 'storybook-repro';
  }

  return match[5].replace(/\.git$/, '');
};

export const repro = async ({
  outputDirectory,
  list,
  template,
  renderer,
  generator,
  e2e,
  local,
  registry,
  url,
  pnp,
  skipGit = false,
}: ReproOptions) => {
  let selectedDirectory = outputDirectory;
  let selectedConfig;
  let selectedTemplate;
  const preferGitTemplate = !skipGit;

  if (url) {
    if (!selectedDirectory) {
      const { directory } = await prompts({
        type: 'text',
        message: 'Enter the output directory',
        name: 'directory',
        initial: getRepoNameFromGitUrl(url),
        validate: (directoryName) =>
          fs.existsSync(directoryName)
            ? `${directoryName} already exists. Please choose another name.`
            : true,
      });
      selectedDirectory = directory;
    }

    selectedTemplate = 'git repo';
    selectedConfig = {
      name: 'git repo',
      version: '',
      generator: `npx degit ${url} ${selectedDirectory}`,
    };
  } else {
    logger.info(
      boxen(
        dedent`
        🤗 Welcome to ${chalk.yellow('sb repro')}! 🤗 

        Create a ${chalk.green('new project')} to minimally reproduce Storybook issues.
        
        1. select an environment that most closely matches your project setup.
        2. select a location for the reproduction, outside of your project.
        
        After the reproduction is ready, we'll guide you through the next steps.
        `.trim(),
        { borderStyle: 'round', padding: 1, borderColor: '#F1618C' } as any
      )
    );

    if (list) {
      logger.info('🌈 Available templates');
      Object.entries(RENDERERS).forEach(([renderer, templates]) => {
        logger.info(renderer);
        templates.forEach((t) => logger.info(`- ${t.name}`));
        if (renderer === 'other') {
          logger.info('- blank');
        }
      });
      return;
    }

    selectedTemplate = template;
    let selectedRenderer = renderer;
    if (!selectedTemplate && !generator) {
      if (!selectedRenderer) {
        const { renderer: rendererOpt } = await prompts({
          type: 'select',
          message: '🌈 Select the repro renderer',
          name: 'renderer',
          choices: Object.keys(RENDERERS).map((f) => ({ title: f, value: f })),
        });
        selectedRenderer = rendererOpt;
      }
      if (!selectedRenderer) {
        throw new Error('🚨 Repro: please select a renderer!');
      }
      selectedTemplate = (
        await prompts({
          type: 'select',
          message: '📝 Select the repro base template',
          name: 'template',
          choices: RENDERERS[selectedRenderer as SupportedRenderers].map((renderer) => ({
            title: renderer.name,
            value: renderer.name,
          })),
        })
      ).template;
    }

    selectedConfig = !generator
      ? TEMPLATES[selectedTemplate]
      : ({
          name: 'custom',
          version: 'custom',
          generator,
        } as Parameters);

    selectedConfig.gitRepoGenerator = `npx degit storybookjs/repro-templates/${selectedConfig.name} ${selectedDirectory}`;
    selectedConfig.preferGitTemplate = preferGitTemplate;

    if (!selectedConfig) {
      throw new Error('🚨 Repro: please specify a valid template type');
    }

    if (!selectedDirectory) {
      const { directory } = await prompts({
        type: 'text',
        message: 'Enter the output directory',
        name: 'directory',
        initial: selectedConfig.name,
        validate: (directoryName) =>
          fs.existsSync(directoryName)
            ? `${directoryName} already exists. Please choose another name.`
            : true,
      });
      selectedDirectory = directory;
    }
  }

  try {
    const cwd = path.isAbsolute(selectedDirectory)
      ? selectedDirectory
      : path.join(process.cwd(), selectedDirectory);

    logger.info(`🏃 Running ${selectedTemplate} into ${cwd}`);

    await createAndInit(cwd, selectedConfig, {
      registry,
      e2e: !!e2e,
      pnp: !!pnp,
      local: !!local,
    });

    if (skipGit) {
      await initGitRepo(cwd);
    } else if (!e2e && !url) {
      await initGitRepo(cwd);
    }

    logger.info(
      boxen(
        dedent`
        🎉 Your Storybook reproduction project is ready to use! 🎉

        ${chalk.yellow(`cd ${selectedDirectory}`)}
        ${chalk.yellow(`yarn storybook`)}

        Once you've recreated the problem you're experiencing, please:
        
        1. Document any additional steps in ${chalk.cyan('README.md')}
        2. Publish the repository to github
        3. Link to the repro repository in your issue

        Having a clean repro helps us solve your issue faster! 🙏
      `.trim(),
        { borderStyle: 'round', padding: 1, borderColor: '#F1618C' } as any
      )
    );
  } catch (error) {
    logger.error('🚨 Failed to create repro');
    throw error;
  }
};

const initGitRepo = async (cwd: string) => {
  await exec('git init', { cwd });
  await exec('echo "node_modules" >> .gitignore', { cwd });
  await exec('git add --all', { cwd });
  await exec('git commit -am "added storybook"', { cwd });
  await exec('git tag repro-base', { cwd });
};
