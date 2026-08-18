/**
 * index.ts — computer_use 外置工具出口
 *
 * 实现 IAgentTool（与内建工具同构）：getSchema / execute / check。
 * 出口形态：命名导出 class ComputerUse + 默认实例（ToolCenter 加载契约：mod.tool ?? mod.default）。
 */
export { ComputerUse } from './computer-use'
import { ComputerUse } from './computer-use'
export default new ComputerUse()
