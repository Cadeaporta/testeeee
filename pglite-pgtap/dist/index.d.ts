import { PGliteInterface } from '@electric-sql/pglite';

declare const pgtap: {
    name: string;
    setup: (_pg: PGliteInterface, emscriptenOpts: any) => Promise<{
        emscriptenOpts: any;
        bundlePath: URL;
    }>;
};

export { pgtap };
