// smoke-e2e.js — real end-to-end synthesis via dist/index.js (requires local IndexTTS env)
const t = require('./dist/index.js');
const ref = 'C:/Users/Administrator/Documents/tinkerdesk-ecosystem/tinkerdesk-plugins/packages/index-tts2/emo_test.wav';
const out = 'C:/Users/Administrator/AppData/Local/Temp/indextts-e2e-test.wav';
const started = Date.now();
t.execute({
  arguments: {
    text: '你好，这是 IndexTTS 语音合成外置工具的端到端验证。',
    refAudio: ref,
    outputPath: out,
    lang: 'ZH',
    useBf16: true,
  },
})
  .then((r) => {
    console.log('elapsed_ms:', Date.now() - started);
    console.log('result:', JSON.stringify(r));
    process.exit(r.ok ? 0 : 2);
  })
  .catch((e) => {
    console.error('EXEC-ERROR', e);
    process.exit(1);
  });