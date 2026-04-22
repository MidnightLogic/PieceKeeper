import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

export default [
    {
        ignores: ["dist/", "node_modules/", "/agents/"]
    },
    sonarjs.configs.recommended,
    {
        languageOptions: {
            globals: {
"NDEFReader": "readonly",

                ...globals.browser,
                ...globals.node,
                ...globals.worker
            }
        },
        rules: {
"sonarjs/cognitive-complexity": "off", "sonarjs/no-ignored-exceptions": "off", "sonarjs/pseudo-random": "off", "sonarjs/no-nested-conditional": "off", "sonarjs/slow-regex": "off", "sonarjs/void-use": "off", "sonarjs/no-nested-functions": "off", "sonarjs/no-identical-functions": "off", "sonarjs/no-redundant-jump": "off", "sonarjs/no-redundant-assignments": "off", "sonarjs/concise-regex": "off", "sonarjs/no-nested-template-literals": "off", "sonarjs/no-unenclosed-multiline-block": "off",

            
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];