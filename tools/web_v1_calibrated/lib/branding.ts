export const PARKMAP_LOGO_PATH = '/branding/parkmap-logo.png';
export type LogoLoadState = 'checking' | 'loaded' | 'missing';
export function shouldDisplayParkMapLogo(state: LogoLoadState): boolean { return state === 'loaded'; }
