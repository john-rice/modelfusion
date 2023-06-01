import { OpenAITextGenerationModel } from "ai-utils.js/provider/openai";
import { generateText } from "ai-utils.js/text";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

(async () => {
  const model = new OpenAITextGenerationModel({
    apiKey: OPENAI_API_KEY,
    model: "text-davinci-003",
    settings: { temperature: 0.7, maxTokens: 500 },
  });

  const generateStory = generateText.asFunction({
    model,
    prompt: async ({ character }: { character: string }) =>
      `Write a short story about ${character} learning to love:\n\n`,
  });

  const text = await generateStory({ character: "a robot" });

  console.log(text);
})();