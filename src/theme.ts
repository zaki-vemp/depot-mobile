/* Harbor — Slate.
   The desktop app's palette, carried over token for token from App.css so both
   builds render the same colours. Names match the CSS custom properties minus
   the `--color-` prefix. */

export const light = {
  bg: '#fdfdfc',
  surface: '#f2f2f0',
  raised: '#ffffff',
  text: '#1b1c1e',
  accent: '#3b74d1',
  accent2: '#3f8570',
  divider: 'rgba(27,28,30,0.11)',

  neutral100: '#fbfbfa',
  neutral200: '#f4f4f2',
  neutral300: '#eaeae7',
  neutral400: '#dcdcd9',
  neutral500: '#bcbcb8',
  neutral600: '#92928d',
  neutral700: '#6b6b67',
  neutral800: '#45453f',
  neutral900: '#262623',

  accent100: '#eef3fd',
  accent200: '#dbe7fa',
  accent300: '#bcd1f3',
  accent400: '#92afe8',
  accent500: '#5b87dc',
  accent600: '#3566bd',
  accent700: '#2a5199',
  accent800: '#213e75',
  accent900: '#182c53',

  accent2_100: '#edf6f2',
  accent2_200: '#d9ece4',
  accent2_300: '#b4d8c9',
  accent2_400: '#86bda8',
  accent2_500: '#5b9d85',
  accent2_600: '#427f6a',
  accent2_700: '#336354',
  accent2_800: '#274b40',
  accent2_900: '#1c352d',

  danger: '#c23b2e',
  /** Text on an accent-filled surface. */
  onAccent: '#ffffff',
  scrim: 'rgba(20,21,24,0.34)',

  ft: {
    folder: '#4a7fd1',
    image: '#7d5bd0',
    video: '#b5497f',
    audio: '#2b8f8f',
    pdf: '#cc4436',
    doc: '#3f6fb0',
    sheet: '#2f8455',
    slides: '#c9762a',
    code: '#6f8f2a',
    text: '#6d7480',
    archive: '#a8802a',
    disk: '#6d7480',
    file: '#8a8f96',
  },
};

export const dark: Theme = {
  bg: '#1d1e21',
  surface: '#242629',
  raised: '#2a2c30',
  text: '#e9eaec',
  accent: '#5f92e4',
  accent2: '#5fae93',
  divider: 'rgba(232,233,234,0.13)',

  neutral100: '#17181a',
  neutral200: '#1d1e21',
  neutral300: '#272a2d',
  neutral400: '#34373b',
  neutral500: '#4e5258',
  neutral600: '#7b7f86',
  neutral700: '#a4a8ae',
  neutral800: '#cccfd3',
  neutral900: '#eceef0',

  accent100: '#1a2740',
  accent200: '#223357',
  accent300: '#2c4676',
  accent400: '#3c5f9c',
  accent500: '#4d7ac0',
  accent600: '#5f92e4',
  accent700: '#87afee',
  accent800: '#b1cbf5',
  accent900: '#d8e5fb',

  accent2_100: '#16261f',
  accent2_200: '#1c332a',
  accent2_300: '#26473b',
  accent2_400: '#356150',
  accent2_500: '#48836b',
  accent2_600: '#5fae93',
  accent2_700: '#89c8b0',
  accent2_800: '#b2dcc9',
  accent2_900: '#d7ede2',

  danger: '#f09182',
  onAccent: '#12151b',
  scrim: 'rgba(0,0,0,0.55)',

  ft: {
    folder: '#6d9fea',
    image: '#a68bec',
    video: '#e07aac',
    audio: '#4bbcbc',
    pdf: '#eb7264',
    doc: '#7aa6e0',
    sheet: '#58bd85',
    slides: '#e5a05a',
    code: '#a5c356',
    text: '#9aa3af',
    disk: '#9aa3af',
    archive: '#d4ac54',
    file: '#8f959d',
  },
};

export type Theme = typeof light;

/** Brand tints for the social apps, same values the desktop chrome uses. */
export const BRAND = {
  facebook: '#1877f2',
  instagram: '#c13584',
  google: '#1a73e8',
  microsoft: '#0f6cbd',
  dropbox: '#0061ff',
};

export const radius = {sm: 5, md: 8, lg: 12, pill: 999};
export const space = {x1: 4, x2: 8, x3: 13, x4: 18, x6: 26, x8: 35};
