/**
 * index.ts — index_tts 外置工具出口
 *
 * 实现 IAgentTool（与内建工具同构）：getSchema / execute / check。
 * 出口形态：命名导出 class IndexTTS + 默认实例（ToolCenter 加载契约：mod.tool ?? mod.default）。
 */
export { IndexTTS } from './index-tts'
import { IndexTTS } from './index-tts'
export default new IndexTTS()
