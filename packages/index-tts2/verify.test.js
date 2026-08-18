// verification test — runs entirely in-process; validation-layer errors return before any spawn
const t = require('./dist/index.js');
const assert = require('assert');

const fails = (cond, msg) => { if (!cond) { console.error('❌ ' + msg); process.exit(1); } };

// ── 结构检查 ──
fails(t && typeof t === 'object', 'dist/index.js 未导出对象');
fails(t.schema && t.schema.name === 'index_tts', 'schema.name 应为 index_tts');
fails(typeof t.execute === 'function', 'execute 应为函数');
fails(t.schema.parameters && t.schema.parameters.type === 'object', 'schema.parameters.type 应为 object');

const props = t.schema.parameters.properties;
const required = ['text', 'lang', 'durationFactor', 'emotionMode', 'emoAudioPrompt', 'emotionPreset', 'emoAlpha', 'textNormalization', 'intervalSilence', 'useRandom', 'useBf16', 'outputPath', 'refAudio'];
for (const key of required) {
  fails(props && props[key], `schema.properties 缺少 ${key}`);
}
fails(JSON.stringify(t.schema.parameters.required) === JSON.stringify(['text']), 'required 应为 ["text"]');

console.log('keys:', JSON.stringify(Object.keys(t)));
console.log('schema.name:', t.schema.name);
console.log('properties:', Object.keys(t.schema.parameters.properties).join(', '));
console.log('typeof execute:', typeof t.execute);

async function run() {
  const r = (name, call) =>
    t.execute(call).then((res) => {
      console.log(name + ':', JSON.stringify(res));
      return res;
    });

  // ── 校验层错误（不 spawn 模型） ──
  let res = await r('missing-text', { arguments: {} });
  fails(res.ok === false && /text/.test(res.error), '缺 text 应返回 ok:false');

  res = await r('bad-lang', { arguments: { text: '你好', lang: 'FR' } });
  fails(res.ok === false && /lang/.test(res.error), 'lang 不在五语应返回 ok:false');

  res = await r('bad-emotion-mode', { arguments: { text: '你好', emotionMode: 'bogus' } });
  fails(res.ok === false && /emotionMode/.test(res.error), 'emotionMode 非法应返回 ok:false');

  res = await r('bad-emotion-preset', { arguments: { text: '你好', emotionMode: 'preset', emotionPreset: 'rage' } });
  fails(res.ok === false && /emotionPreset/.test(res.error), 'emotionPreset 非法应返回 ok:false');

  res = await r('audio-mode-no-prompt', { arguments: { text: '你好', emotionMode: 'audio' } });
  fails(res.ok === false && /emoAudioPrompt/.test(res.error), 'audio 模式缺 emoAudioPrompt 应返回 ok:false');

  res = await r('bad-duration', { arguments: { text: '你好', durationFactor: 'abc' } });
  fails(res.ok === false && /durationFactor/.test(res.error), 'durationFactor 非数字应返回 ok:false');

  res = await r('no-refaudio', { arguments: { text: '你好' } });
  fails(res.ok === false && /refAudio|INDEX_TTS_VOICE_PROFILE/.test(res.error), '缺 refAudio 且无环境配置应返回 ok:false');

  // ── 合法参数抵达环境检查（有 INDEX_TTS_VOICE_PROFILE 时会走到模型就绪检查——仍不 spawn） ──
  res = await r('valid-shape-with-env', { arguments: { text: '你好世界', lang: 'EN', durationFactor: 1.2, emotionMode: 'preset', emotionPreset: 'calm', emoAlpha: 0.8 } });
  // 若无环境变量，走到 refAudio 缺失错误；有环境变量则走到模型就绪/环境错误——都不应该抛异常
  fails(res && typeof res.ok === 'boolean', '合法参数形状应返回统一结果对象');

  console.log('✅ verify 通过');
}

run().then(() => process.exit(0), (e) => { console.error('TEST-FAILED', e); process.exit(1); });