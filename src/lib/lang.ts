/** Language label for the editor status bar — a subset of the desktop Monaco map. */

const BY_NAME: Record<string, string> = {
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  'cmakelists.txt': 'cmake',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.editorconfig': 'ini',
};

const BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  rs: 'rust',
  py: 'python',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  vue: 'vue',
  gradle: 'groovy',
  ini: 'ini',
  conf: 'ini',
  properties: 'ini',
  txt: 'plaintext',
  log: 'plaintext',
};

export function languageForPath(path: string) {
  const name = (path.split('/').pop() || path).toLowerCase();
  if (BY_NAME[name]) {
    return BY_NAME[name];
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return BY_EXT[ext] || 'plaintext';
}
