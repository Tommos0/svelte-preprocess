import { resolve } from 'path';

import autoPreprocess from '../../src';
import { preprocess } from '../utils';

describe('transformer - stylus', () => {
  it('should return @imported files as dependencies', async () => {
    const template = `<style lang="stylus">@import "fixtures/style.styl";</style>`;
    const opts = autoPreprocess();
    const preprocessed = await preprocess(template, opts);

    expect(preprocessed.dependencies).toContain(
      resolve(__dirname, '..', 'fixtures', 'style.styl'),
    );
  });
});
