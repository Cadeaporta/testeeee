import { PGliteInterface } from '@electric-sql/pglite';

declare const pg_uuidv7: {
    name: string;
    setup: (_pg: PGliteInterface, emscriptenOpts: any) => Promise<{
        emscriptenOpts: any;
        bundlePath: URL;
    }>;
};

export { pg_uuidv7 };
