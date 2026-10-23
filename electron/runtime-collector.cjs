const { collectMacosRuntimeData } = require('./macos-runtime-collector.cjs');
const { collectWindowsRuntimeData } = require('./windows-runtime-collector.cjs');

function collectRuntimeData() {
  if (process.platform === 'darwin') return collectMacosRuntimeData();
  return collectWindowsRuntimeData();
}

module.exports = { collectRuntimeData };
