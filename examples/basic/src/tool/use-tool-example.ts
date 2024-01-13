import dotenv from "dotenv";
import { openai, useTool } from "modelfusion";
import { calculator } from "./tools/calculator-tool";

dotenv.config();

async function main() {
  const { tool, toolCall, args, ok, result } = await useTool({
    model: openai
      .ChatTextGenerator({ model: "gpt-3.5-turbo" })
      .withTextPrompt(),

    tool: calculator,
    prompt: "What's fourteen times twelve?",
  });

  console.log(`Tool call:`, toolCall);
  console.log(`Tool:`, tool);
  console.log(`Arguments:`, args);
  console.log(`Ok:`, ok);
  console.log(`Result or Error:`, result);
}

main().catch(console.error);
