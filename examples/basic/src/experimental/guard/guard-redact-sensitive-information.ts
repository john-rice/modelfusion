import dotenv from "dotenv";
import { Llama2Prompt, generateText, llamacpp, modelfusion } from "modelfusion";
import { guard } from "modelfusion-experimental";

dotenv.config();

modelfusion.setLogFormat("detailed-object");

const OPENAI_KEY_REGEXP = new RegExp("sk-[a-zA-Z0-9]{24}", "gi");

// example assumes you are running https://huggingface.co/TheBloke/Llama-2-7B-GGUF with llama.cpp
async function main() {
  const result = await guard(
    (input, options) =>
      generateText(
        llamacpp
          .TextGenerator({
            temperature: 0.7,
            maxGenerationTokens: 500,
          })
          .withTextPromptTemplate(Llama2Prompt.instruction()),
        input,
        options
      ),
    {
      instruction:
        "Show me how to use OpenAI's completion API in JavaScript, including authentication.",
    },
    async (result) => {
      if (result.type === "value") {
        return {
          action: "return",
          output: result.output.replaceAll(OPENAI_KEY_REGEXP, "sk-xxx"),
        };
      }
    }
  );

  console.log(result);
}

main().catch(console.error);