const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const vendorDir = path.join(projectRoot, 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

for (const [source, target] of [
    ['xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js'],
    ['echarts/dist/echarts.min.js', 'echarts.min.js'],
    ['feather-icons/dist/feather.min.js', 'feather.min.js'],
    ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
    ['tesseract.js/dist/worker.min.js', 'tesseract-worker.min.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
    ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm'],
    ['@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz', 'chi_sim.traineddata.gz'],
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz']
]) {
    fs.copyFileSync(path.join(projectRoot, 'node_modules', source), path.join(vendorDir, target));
}
