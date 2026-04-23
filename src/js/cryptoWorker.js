/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

import { argon2id, scrypt } from 'hash-wasm';

self.onmessage = async (event) => {
    const { id, type, payload } = event.data;

    if (type !== 'DERIVE_KEY') return;

    try {
        const { passwordStr, salt, schema } = payload;
        let derivedKeyBytes;

        const passwordBytes = new TextEncoder().encode(passwordStr);

        if (schema.pbkdf2_iterations) {
            // Schemas 1, 2, 3: Standard PBKDF2 using Native Web Crypto API
            const keyMaterial = await self.crypto.subtle.importKey(
                "raw",
                passwordBytes,
                { name: "PBKDF2" },
                false,
                ["deriveBits"]
            );

            const buffer = await self.crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt: salt,
                    iterations: schema.pbkdf2_iterations,
                    hash: schema.pbkdf2_hash
                },
                keyMaterial,
                schema.aes_key_length
            );
            derivedKeyBytes = new Uint8Array(buffer);

        } else if (schema.kdf_algorithm === 'Argon2id') {
            // Schemas 4, 5: Next-Gen memory hard WASM derivations
            derivedKeyBytes = await argon2id({
                password: passwordBytes,
                salt: salt,
                parallelism: schema.parallelism,
                iterations: schema.time_cost,
                memorySize: schema.memory_cost,
                hashLength: schema.aes_key_length / 8, // 32 bytes
                outputType: 'binary'
            });

        } else if (schema.kdf_algorithm === 'scrypt') {
            // Schema 6: Robust legacy memory hard WASM derivation
            derivedKeyBytes = await scrypt({
                password: passwordBytes,
                salt: salt,
                costFactor: schema.cpu_memory_cost,
                blockSize: schema.block_size,
                parallelism: schema.parallelization,
                hashLength: schema.aes_key_length / 8, // 32 bytes
                outputType: 'binary'
            });
        } else {
            throw new Error('Unknown cryptographic schema structure');
        }

        // Post success back to main thread
        self.postMessage({ id, success: true, key: derivedKeyBytes });

    } catch (error) {
        // Post error back to main thread mapping
        self.postMessage({ id, success: false, error: error.message });
    }
};
