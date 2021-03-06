import {
  PreprocessorGroup,
  Preprocessor,
  Processed,
  TransformerArgs,
  TransformerOptions,
  Transformers,
  Options,
} from './types';
import { hasDepInstalled } from './modules/hasDepInstalled';
import { concat } from './modules/concat';
import { getTagInfo } from './modules/tagInfo';
import {
  addLanguageAlias,
  getLanguageFromAlias,
  SOURCE_MAP_PROP_MAP,
} from './modules/language';
import { prepareContent } from './modules/prepareContent';

type AutoPreprocessGroup = PreprocessorGroup & {
  defaultLanguages: Readonly<{
    markup: string;
    style: string;
    script: string;
  }>;
};

type AutoPreprocessOptions = {
  markupTagName?: string;
  aliases?: Array<[string, string]>;
  preserve?: string[];
  defaults?: {
    markup?: string;
    style?: string;
    script?: string;
  };
  sourceMap?: boolean;

  // transformers
  typescript?: TransformerOptions<Options.Typescript>;
  scss?: TransformerOptions<Options.Sass>;
  sass?: TransformerOptions<Options.Sass>;
  less?: TransformerOptions<Options.Less>;
  stylus?: TransformerOptions<Options.Stylus>;
  postcss?: TransformerOptions<Options.Postcss>;
  coffeescript?: TransformerOptions<Options.Coffeescript>;
  pug?: TransformerOptions<Options.Pug>;
  globalStyle?: Options.GlobalStyle | boolean;
  replace?: Options.Replace;

  // workaround while we don't have this
  // https://github.com/microsoft/TypeScript/issues/17867
  [languageName: string]:
    | string
    | Promise<string>
    | Array<[string, string]>
    | string[]
    | TransformerOptions;
};

const ALIAS_OPTION_OVERRIDES: Record<string, any> = {
  sass: {
    indentedSyntax: true,
  },
};

export const runTransformer = async (
  name: string,
  options: TransformerOptions,
  { content, map, filename, attributes }: TransformerArgs<any>,
): Promise<Processed> => {
  if (options === false) {
    return { code: content };
  }

  if (typeof options === 'function') {
    return options({ content, map, filename, attributes });
  }

  const { transformer } = await import(`./transformers/${name}`);

  return transformer({
    content,
    filename,
    map,
    attributes,
    options: typeof options === 'boolean' ? null : options,
  });
};

export function autoPreprocess(
  {
    aliases,
    markupTagName = 'template',
    preserve = [],
    defaults,
    sourceMap = false,
    ...rest
  } = {} as AutoPreprocessOptions,
): AutoPreprocessGroup {
  markupTagName = markupTagName.toLocaleLowerCase();

  const defaultLanguages = Object.freeze({
    markup: 'html',
    style: 'css',
    script: 'javascript',
    ...defaults,
  });

  const transformers = rest as Transformers;
  const markupPattern = new RegExp(
    `<${markupTagName}([\\s\\S]*?)(?:>([\\s\\S]*)<\\/${markupTagName}>|/>)`,
  );

  if (aliases?.length) {
    addLanguageAlias(aliases);
  }

  const getTransformerOptions = (
    name: string,
    alias?: string,
  ): TransformerOptions<unknown> => {
    const { [name]: nameOpts, [alias]: aliasOpts } = transformers;

    if (typeof aliasOpts === 'function') return aliasOpts;
    if (typeof nameOpts === 'function') return nameOpts;
    if (aliasOpts === false || nameOpts === false) return false;

    const opts: TransformerOptions<unknown> = {};

    if (typeof nameOpts === 'object') {
      Object.assign(opts, nameOpts);
    }

    if (name !== alias) {
      Object.assign(opts, ALIAS_OPTION_OVERRIDES[alias] || null);

      if (typeof aliasOpts === 'object') {
        Object.assign(opts, aliasOpts);
      }
    }

    if (sourceMap && name in SOURCE_MAP_PROP_MAP) {
      const [propName, value] = SOURCE_MAP_PROP_MAP[name];

      opts[propName] = value;
    }

    return opts;
  };

  const getTransformerTo = (
    type: 'markup' | 'script' | 'style',
    targetLanguage: string,
  ): Preprocessor => async (svelteFile) => {
    let {
      content,
      filename,
      lang,
      alias,
      dependencies,
      attributes,
    } = await getTagInfo(svelteFile);

    if (lang == null || alias == null) {
      alias = defaultLanguages[type];
      lang = getLanguageFromAlias(alias);
    }

    if (preserve.includes(lang) || preserve.includes(alias)) {
      return { code: content };
    }

    const transformerOptions = getTransformerOptions(lang, alias);

    content = prepareContent({
      options: transformerOptions,
      content,
    });

    if (lang === targetLanguage) {
      return { code: content, dependencies };
    }

    const transformed = await runTransformer(lang, transformerOptions, {
      content,
      filename,
      attributes,
    });

    return {
      ...transformed,
      dependencies: concat(dependencies, transformed.dependencies),
    };
  };

  const scriptTransformer = getTransformerTo('script', 'javascript');
  const cssTransformer = getTransformerTo('style', 'css');
  const markupTransformer = getTransformerTo('markup', 'html');

  const markup: PreprocessorGroup['markup'] = async ({ content, filename }) => {
    if (transformers.replace) {
      const transformed = await runTransformer(
        'replace',
        transformers.replace,
        { content, filename },
      );

      content = transformed.code;
    }

    const templateMatch = content.match(markupPattern);

    /** If no <template> was found, just return the original markup */
    if (!templateMatch) {
      return markupTransformer({ content, attributes: {}, filename });
    }

    const [fullMatch, attributesStr, templateCode] = templateMatch;

    /** Transform an attribute string into a key-value object */
    const attributes = attributesStr
      .split(/\s+/)
      .filter(Boolean)
      .reduce((acc: Record<string, string | boolean>, attr) => {
        const [name, value] = attr.split('=');

        // istanbul ignore next
        acc[name] = value ? value.replace(/['"]/g, '') : true;

        return acc;
      }, {});

    /** Transform the found template code */
    let { code, map, dependencies } = await markupTransformer({
      content: templateCode,
      attributes,
      filename,
    });

    code =
      content.slice(0, templateMatch.index) +
      code +
      content.slice(templateMatch.index + fullMatch.length);

    return { code, map, dependencies };
  };

  const script: PreprocessorGroup['script'] = async ({
    content,
    attributes,
    filename,
  }) => {
    const transformResult: Processed = await scriptTransformer({
      content,
      attributes,
      filename,
    });

    let { code, map, dependencies, diagnostics } = transformResult;

    if (transformers.babel) {
      const transformed = await runTransformer(
        'babel',
        getTransformerOptions('babel'),
        {
          content: code,
          map,
          filename,
          attributes,
        },
      );

      code = transformed.code;
      map = transformed.map;
      dependencies = concat(dependencies, transformed.dependencies);
      diagnostics = concat(diagnostics, transformed.diagnostics);
    }

    return { code, map, dependencies, diagnostics };
  };

  const style: PreprocessorGroup['style'] = async ({
    content,
    attributes,
    filename,
  }) => {
    const transformResult = await cssTransformer({
      content,
      attributes,
      filename,
    });

    let { code, map, dependencies } = transformResult;

    // istanbul ignore else
    if (await hasDepInstalled('postcss')) {
      if (transformers.postcss) {
        const transformed = await runTransformer(
          'postcss',
          getTransformerOptions('postcss'),
          { content: code, map, filename, attributes },
        );

        code = transformed.code;
        map = transformed.map;
        dependencies = concat(dependencies, transformed.dependencies);
      }

      const transformed = await runTransformer(
        'globalStyle',
        getTransformerOptions('globalStyle'),
        { content: code, map, filename, attributes },
      );

      code = transformed.code;
      map = transformed.map;
    }

    return { code, map, dependencies };
  };

  return {
    defaultLanguages,
    markup,
    script,
    style,
  };
}
