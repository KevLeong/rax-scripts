const { readFileSync, existsSync, mkdirpSync } = require('fs-extra');
const { join, sep } = require('path');
const { getOptions } = require('loader-utils');
const chalk = require('chalk');
const { doubleBackslash, getHighestPriorityPackage } = require('./utils/pathHelper');
const eliminateDeadCode = require('./utils/dce');
const defaultStyle = require('./defaultStyle');
const processCSS = require('./styleProcessor');
const output = require('./output');
const { isTypescriptFile } = require('./utils/judgeModule');

function createImportStatement(req) {
  return `import '${doubleBackslash(req)}';`;
}

function generateDependencies(dependencies) {
  return Object
    .keys(dependencies)
    .map(mod => createImportStatement(mod))
    .join('\n');
}

module.exports = async function appLoader(content) {
  const loaderOptions = getOptions(this);
  const { entryPath, outputPath, platform, mode, disableCopyNpm, turnOffSourceMap } = loaderOptions;
  const rawContent = readFileSync(this.resourcePath, 'utf-8');

  if (!existsSync(outputPath)) mkdirpSync(outputPath);

  const sourcePath = join(this.rootContext, entryPath);

  const JSXCompilerPath = getHighestPriorityPackage('jsx-compiler', this.rootContext);
  const compiler = require(JSXCompilerPath);

  const compilerOptions = Object.assign({}, compiler.baseOptions, {
    resourcePath: this.resourcePath,
    outputPath,
    sourcePath,
    platform,
    type: 'app',
    sourceFileName: this.resourcePath,
    disableCopyNpm,
    turnOffSourceMap
  });
  const rawContentAfterDCE = eliminateDeadCode(rawContent);

  let transformed;
  try {
    transformed = compiler(rawContentAfterDCE, compilerOptions);
  } catch (e) {
    console.log(chalk.red(`\n[${platform.name}] Error occured when handling App ${this.resourcePath}`));
    if (process.env.DEBUG === 'true') {
      throw new Error(e);
    } else {
      const errMsg = e.node ? `${e.message}\nat ${this.resourcePath}` : `Unknown compile error! please check your code at ${this.resourcePath}`;
      throw new Error(errMsg);
    }
  }

  const { style, assets } = await processCSS(transformed.cssFiles, sourcePath);
  transformed.style = style;
  transformed.assets = assets;

  const outputContent = {
    code: transformed.code,
    map: transformed.map,
    css: transformed.style ? defaultStyle + transformed.style : defaultStyle,
  };
  const outputOption = {
    outputPath: {
      code: join(outputPath, 'app.js'),
      css: join(outputPath, 'app' + platform.extension.css),
    },
    mode,
    isTypescriptFile: isTypescriptFile(this.resourcePath)
  };

  output(outputContent, rawContent, outputOption);

  return [
    `/* Generated by JSX2MP AppLoader, sourceFile: ${this.resourcePath}. */`,
    generateDependencies(transformed.imported),
  ].join('\n');
};
