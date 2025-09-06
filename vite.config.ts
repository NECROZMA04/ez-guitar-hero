import pluginChecker from "vite-plugin-checker";
import { UserConfig } from "vite";

const config: UserConfig = {
    base: "/ez-guitar-hero/",
    plugins: [pluginChecker({ typescript: true, overlay: false })],
    build: {
        rollupOptions: {
            input: {
                main: "index.html",
            },
        },
    },
};

const getConfig = () => config;

export default getConfig;
