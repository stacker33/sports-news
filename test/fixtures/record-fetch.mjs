// Preloaded into a child process by test/state-failsafe.test.js: replaces fetch so nothing leaves the machine and
// reports, on exit, how many network calls the process tried (a stopped run must try none).
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  throw new Error('network disabled in this test');
};
process.on('exit', () => process.stdout.write(`\nFETCH_CALLS ${calls}\n`));
