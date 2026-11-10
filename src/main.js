//20261110-0 add - Start the independent Vue application.
import { createSSRApp } from 'vue';
import App from './App.vue';

/******************************************************************************
 * Function Name   : createApp
 * Description     : Create the uni-app Vue instance for the Android local host.
 * Input Parameters: None
 * Return Value    : Application instance container.
 * Date            : 2026.11.10
 ******************************************************************************/
export function createApp() {
    const app = createSSRApp(App);

    return { app };
}
