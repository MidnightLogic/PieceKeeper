import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig(() => {
    // Check if we are running in "tunnel" mode (HTTP)
    const isTunnelMode = process.env.TUNNEL === 'true';

    return {
        base: '/PieceKeeper/',
        define: {
            __APP_VERSION__: JSON.stringify(pkg.version)
        },
        root: 'src',
        plugins: [
            viteSingleFile(),
            // Conditionally load the SSL plugin ONLY if we are not tunneling
            ...(isTunnelMode ? [] : [basicSsl()])
        ],
        server: {
            host: true, // Listens on all local IPs
            port: 4173,
            strictPort: true,
            https: !isTunnelMode, // HTTPS is true normally, false for tunnels
            allowedHosts: true // Bypasses strict host checking for Ngrok/Localtunnel mappings
        },
        preview: {
            host: true, // Listens on all local IPs
            port: 4173,
            strictPort: true,
            https: !isTunnelMode,
            allowedHosts: true // Bypasses strict host checking for Ngrok/Localtunnel mappings
        },
        build: {
            outDir: '../dist',
            emptyOutDir: true
        }
    };
});
