/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import { resolve } from 'path';

import autoPreprocess from '../../src';
import { preprocess, spyConsole } from '../utils';

spyConsole();

describe('transformer - postcss', () => {
  it('should not transform plain css with postcss if { postcss: falsy }', async () => {
    const template = `<div></div><style>div{appearance:none;}</style>`;
    const preprocessed = await preprocess(template, autoPreprocess());

    expect(preprocessed.toString()).not.toMatch(/-webkit-/);
  });

  it('should not transform plain css with postcss if { postcss: true } and no configuration file at cwd', async () => {
    const template = `<div></div><style>div{appearance:none;}</style>`;
    const preprocessed = await preprocess(
      template,
      autoPreprocess({
        postcss: true,
      }),
    );

    expect(preprocessed.toString()).not.toMatch(/-webkit-/);
  });

  it('should transform plain css with postcss if { postcss: { plugins... } }', async () => {
    const template = `<div></div><style>div{appearance:none;}</style>`;
    const optsWithoutConfigFile = autoPreprocess({
      postcss: {
        plugins: [
          require('autoprefixer')({
            overrideBrowserslist: 'Safari >= 5.1',
          }),
        ],
      },
    });

    const preprocessed = await preprocess(template, optsWithoutConfigFile);

    expect(preprocessed.toString()).toMatch(/-webkit-/);
  });

  it('should transform async preprocessed css with postcss if { postcss: { plugins... } }', async () => {
    const templateSass = `<div></div><style lang="scss">div{appearance:none;}</style>`;
    const optsWithoutConfigFile = autoPreprocess({
      postcss: {
        plugins: [
          require('autoprefixer')({
            overrideBrowserslist: 'Safari >= 5.1',
          }),
        ],
      },
    });

    const preprocessed = await preprocess(templateSass, optsWithoutConfigFile);

    expect(preprocessed.toString()).toMatch(/-webkit-/);
  });

  it('should transform plain css with postcss if { postcss: { configFilePath: ... } }', async () => {
    const template = `<div></div><style>div{appearance:none;}</style>`;
    const preprocessed = await preprocess(
      template,
      autoPreprocess({
        postcss: {
          configFilePath: './test/fixtures/',
        },
      }),
    );

    expect(preprocessed.toString()).toMatch(/-webkit-/);
  });

  it('should return @imported files as dependencies', async () => {
    const template = `<style>@import './fixtures/style.css';</style>`;
    const opts = autoPreprocess({
      postcss: {
        plugins: [require('postcss-easy-import')],
      },
    });

    const preprocessed = await preprocess(template, opts);

    expect(preprocessed.dependencies).toContain(
      resolve(__dirname, '..', 'fixtures', 'style.css'),
    );
  });

  it('should allow custom postcss parsers', async () => {
    const template = `<style>
div
  color: red
</style>`;

    const opts = autoPreprocess({
      postcss: {
        parser: require('sugarss'),
        plugins: [require('postcss-easy-import')],
      },
    });

    const preprocessed = await preprocess(template, opts);

    expect(preprocessed.toString()).toContain(`div {
  color: red
}`);
  });
});
