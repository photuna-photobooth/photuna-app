/**
 * Shared default appearance used by all PhotoBooth screens.
 * Screens merge event/global appearance on top of this with spread:
 *   const appearance = { ...DEFAULT_APPEARANCE, ...(event?.appearance ?? {}) };
 */
export const DEFAULT_APPEARANCE = {
  boothName: 'Studio Photuna',
  tagline: 'Ahead of the moment.',
  headerFont: 'Ramillas',
  generalFont: 'Interphases',
  buttonFont: 'Interphases',
  headerFontColor: '#ffffff',
  generalFontColor: '#e5e5e5',
  bgColor: '#000000',
  logoPath: null,
  backgroundMediaPath: null,
  buttonBgColor: '#ec4899',
  buttonHoverColor: '#db2777',
  buttonFontColor: '#ffffff',
};
