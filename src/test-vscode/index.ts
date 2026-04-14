import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '..');
    const files = await glob('**/**.test.{js,ts}', { cwd: testsRoot });

    for (const f of files) {
        const p = path.resolve(testsRoot, f);
        console.log("mocha.addFile:", p);
        mocha.addFile(p);
    }

    return new Promise((resolve, reject) => {
        try {
            console.log("mocha.run");
            mocha.run(failures => {
                console.log("mocha in run", failures);
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
            console.log("mocha.run end");
        } catch (err) {
            console.error(err);
            reject(err);
        }
    });
}