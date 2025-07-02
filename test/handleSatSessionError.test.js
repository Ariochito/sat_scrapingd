const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const file = fs.readFileSync('js/cfdi-ui.js','utf8');
const fn = file.match(/async function handleSatSessionError[^]*?\n}/)[0];

function loadContext() {
  const ctx = {
    SAT_SESSION_ERROR_MSG: 'expected to have the session registered',
    SAT_SESSION_INACTIVE_MSG: 'No hay sesión activa SAT para este RFC',
    SAT_SESSION_MAX_RETRIES: 3,
    satSessionErrorCount: 0,
    showToast: function(){},
    estadoCalled: null,
    mostrarEstadoSesion: function(activa, mensaje){ ctx.estadoCalled = [activa, mensaje]; },
    loginSat: async () => ({success: true, msg: 'ok'}),
    $: () => ({ value: 'dummy', trim(){ return this.value; } })
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  return ctx;
}

(async function testErrorMsg(){
  const ctx = loadContext();
  const msg = 'error: expected to have the session registered';
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 1);
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 2);
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 0);
  assert.deepStrictEqual(ctx.estadoCalled, [false, 'Sesión expirada']);
})();

(async function testInactiveMsg(){
  const ctx = loadContext();
  const msg = 'No hay sesión activa SAT para este RFC. Por favor inicia sesión primero.';
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 1);
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 2);
  assert.strictEqual(await ctx.handleSatSessionError(msg), true);
  assert.strictEqual(ctx.satSessionErrorCount, 0);
  assert.deepStrictEqual(ctx.estadoCalled, [false, 'Sesión expirada']);
})();

console.log('All tests passed.');
