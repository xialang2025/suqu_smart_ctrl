//20261110-0 add - Share one application instance across visible pages.
import { createApplication } from './application.js';
import { createNativePlatform } from './native-platform.js';

const host = typeof window === 'undefined' ? globalThis : window;
export const platform = createNativePlatform(host.NativeBle, host);
export const application = createApplication(platform);
