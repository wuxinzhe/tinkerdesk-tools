# scripts/gen_index.py - IndexTTS-2.5 合成脚本（由插件 spawn 调用）
#
# 输入（stdin JSON）：{ text, refAudio, lang, durationFactor, outPath,
#                        emotionMode, emoAudioPrompt, emotionPreset, emoAlpha,
#                        textNormalization, intervalSilence, useRandom, useBf16 }
# 输出：stdout JSON { ok, outPath?, error? }
#
# 运行铁律（IndexTTS 部署经验）：
# 1. spawn cwd = C:\\tools\\index-tts（import indextts 需要项目根在 PYTHONPATH）
# 2. PYTHONPATH 必须指向项目根（indextts 是项目内模块，不是 pip 包）
# 3. 模型 checkpoints 由 modelscope 下载到项目根（gpt.pth ~3.26G）
# 4. use_bf16=True（省显存——IndexTTS-2.5 支持 BF16 推理）
# 5. lang: ZH / EN / JA / ES / AR（IndexTTS-2.5 五语）
# 6. duration_factor: 0.5-2.0（语速——>1 更慢 <1 更快——speed 的倒数）
# 7. 情感控制：emo_audio_prompt（参考音频）/ emo_vector（8 维预设）/ emo_alpha
# 8. 发音控制是文本内标注（pinyin/CMU 音素/假名）——无需配置
import json
import sys

# 情感向量预设（顺序固定：[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]）
EMO_PRESETS = {
    "happy": [0.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "angry": [0.0, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "sad": [0.0, 0.0, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0],
    "afraid": [0.0, 0.0, 0.0, 0.7, 0.0, 0.0, 0.0, 0.0],
    "disgusted": [0.0, 0.0, 0.0, 0.0, 0.7, 0.0, 0.0, 0.0],
    "melancholic": [0.0, 0.0, 0.0, 0.0, 0.0, 0.7, 0.0, 0.0],
    "surprised": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.7, 0.0],
    "calm": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.7],
}


def main():
    try:
        payload = json.loads(sys.stdin.read())
        text = payload["text"]
        ref_audio = payload["refAudio"]
        lang = payload.get("lang") or "ZH"
        duration_factor = payload.get("durationFactor") or 1.0
        out_path = payload["outPath"]
        emotion_mode = payload.get("emotionMode") or "none"
        emo_audio_prompt = payload.get("emoAudioPrompt") or None
        emotion_preset = payload.get("emotionPreset") or "none"
        emo_alpha = payload.get("emoAlpha", 1.0)
        text_normalization = payload.get("textNormalization", True)
        interval_silence = payload.get("intervalSilence", 200)
        use_random = payload.get("useRandom", False)
        use_bf16 = payload.get("useBf16", True)

        import torch
        from indextts.infer_v2_5 import IndexTTS2

        tts = IndexTTS2(
            cfg_path="checkpoints/config.yaml",
            model_dir="checkpoints",
            use_bf16=use_bf16,
        )
        # 情感参数组装（对齐 webui 三模式）
        emo_args = {}
        if emotion_mode == "audio" and emo_audio_prompt:
            emo_args["emo_audio_prompt"] = emo_audio_prompt
            emo_args["emo_alpha"] = emo_alpha
        elif emotion_mode == "vector" and emotion_preset in EMO_PRESETS:
            emo_args["emo_vector"] = EMO_PRESETS[emotion_preset]
            emo_args["emo_alpha"] = emo_alpha

        tts.infer(
            spk_audio_prompt=ref_audio,
            text=text,
            lang=lang,
            output_path=out_path,
            duration_factor=duration_factor,
            interval_silence=interval_silence,
            use_random=use_random,
            text_normalization=text_normalization,
            verbose=False,
            **emo_args,
        )
        print(json.dumps({"ok": True, "outPath": out_path}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
