import dotenv from "dotenv";
import { OpenAITextGenerationModel, generateText } from "modelfusion";
import { customObserver } from "./custom-observer";

dotenv.config();

async function main() {
  // Set the observer on the model:
  const text = await generateText(
    new OpenAITextGenerationModel({
      model: "gpt-3.5-turbo-instruct",
      maxCompletionTokens: 50,
      observers: [customObserver],
    }),
    "Write a short story about a robot name Bud:\n\n"
  );
}

main().catch(console.error);