import { z } from "zod";
import { FunctionOptions } from "../../core/FunctionOptions.js";
import { ApiCallError } from "../../core/api/ApiCallError.js";
import { ApiConfiguration } from "../../core/api/ApiConfiguration.js";
import { callWithRetryAndThrottle } from "../../core/api/callWithRetryAndThrottle.js";
import { ResponseHandler, postJsonToApi } from "../../core/api/postToApi.js";
import { ZodSchema } from "../../core/schema/ZodSchema.js";
import { safeParseJSON } from "../../core/schema/parseJSON.js";
import { AbstractModel } from "../../model-function/AbstractModel.js";
import { Delta } from "../../model-function/Delta.js";
import { PromptTemplateTextStreamingModel } from "../../model-function/generate-text/PromptTemplateTextStreamingModel.js";
import {
  TextGenerationModelSettings,
  TextStreamingModel,
} from "../../model-function/generate-text/TextGenerationModel.js";
import { TextGenerationPromptTemplate } from "../../model-function/generate-text/TextGenerationPromptTemplate.js";
import {
  TextGenerationToolCallModel,
  ToolCallPromptTemplate,
} from "../../tool/generate-tool-call/TextGenerationToolCallModel.js";
import {
  TextGenerationToolCallsOrGenerateTextModel,
  ToolCallsOrGenerateTextPromptTemplate,
} from "../../tool/generate-tool-calls-or-text/TextGenerationToolCallsOrGenerateTextModel.js";
import { AsyncQueue } from "../../util/AsyncQueue.js";
import { parseJsonStream } from "../../util/streaming/parseJsonStream.js";
import { OllamaApiConfiguration } from "./OllamaApiConfiguration.js";
import { failedOllamaCallResponseHandler } from "./OllamaError.js";

export interface OllamaCompletionPrompt {
  /**
   * Text prompt.
   */
  prompt: string;

  /**
   Images. Supports base64-encoded `png` and `jpeg` images up to 100MB in size.
   */
  images?: Array<string>;
}

/**
 * Text generation model that uses the Ollama completion API.
 *
 * @see https://github.com/jmorganca/ollama/blob/main/docs/api.md#generate-a-completion
 */
export interface OllamaCompletionModelSettings<
  CONTEXT_WINDOW_SIZE extends number | undefined,
> extends TextGenerationModelSettings {
  api?: ApiConfiguration;

  /**
   * The name of the model to use. For example, 'mistral'.
   *
   * @see https://ollama.ai/library
   */
  model: string;

  /**
   * The temperature of the model. Increasing the temperature will make the model
   * answer more creatively. (Default: 0.8)
   */
  temperature?: number;

  /**
   * Specify the context window size of the model that you have loaded in your
   * Ollama server. (Default: 2048)
   */
  contextWindowSize?: CONTEXT_WINDOW_SIZE;

  /**
   * Enable Mirostat sampling for controlling perplexity.
   * (default: 0, 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0)
   */
  mirostat?: number;

  /**
   * Influences how quickly the algorithm responds to feedback from the generated text.
   * A lower learning rate will result in slower adjustments,
   * while a higher learning rate will make the algorithm more responsive. (Default: 0.1)
   */
  mirostatEta?: number;

  /**
   * Controls the balance between coherence and diversity of the output.
   * A lower value will result in more focused and coherent text. (Default: 5.0)
   */
  mirostatTau?: number;

  /**
   * The number of GQA groups in the transformer layer. Required for some models,
   * for example it is 8 for llama2:70b
   */
  numGqa?: number;

  /**
   * The number of layers to send to the GPU(s). On macOS it defaults to 1 to
   * enable metal support, 0 to disable.
   */
  numGpu?: number;

  /**
   * Sets the number of threads to use during computation. By default, Ollama will
   * detect this for optimal performance. It is recommended to set this value to the
   * number of physical CPU cores your system has (as opposed to the logical number of cores).
   */
  numThreads?: number;

  /**
   * Sets how far back for the model to look back to prevent repetition.
   * (Default: 64, 0 = disabled, -1 = num_ctx)
   */
  repeatLastN?: number;

  /**
   * Sets how strongly to penalize repetitions. A higher value (e.g., 1.5)
   * will penalize repetitions more strongly, while a lower value (e.g., 0.9)
   * will be more lenient. (Default: 1.1)
   */
  repeatPenalty?: number;

  /**
   * Sets the random number seed to use for generation. Setting this to a
   * specific number will make the model generate the same text for the same prompt.
   * (Default: 0)
   */
  seed?: number;

  /**
   * Tail free sampling is used to reduce the impact of less probable tokens
   * from the output. A higher value (e.g., 2.0) will reduce the impact more,
   * while a value of 1.0 disables this setting. (default: 1)
   */
  tfsZ?: number;

  /**
   * Reduces the probability of generating nonsense. A higher value (e.g. 100)
   * will give more diverse answers, while a lower value (e.g. 10) will be more
   *  conservative. (Default: 40)
   */
  topK?: number;

  /**
   * Works together with top-k. A higher value (e.g., 0.95) will lead to more
   * diverse text, while a lower value (e.g., 0.5) will generate more focused
   * and conservative text. (Default: 0.9)
   */
  topP?: number;

  /**
   * When set to true, no formatting will be applied to the prompt and no context
   * will be returned.
   */
  raw?: boolean;

  /**
   * The format to return a response in. Currently the only accepted value is 'json'.
   * Leave undefined to return a string.
   */
  format?: "json";

  system?: string;
  template?: string;
  context?: number[];
}

export class OllamaCompletionModel<
    CONTEXT_WINDOW_SIZE extends number | undefined,
  >
  extends AbstractModel<OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>>
  implements
    TextStreamingModel<
      OllamaCompletionPrompt,
      OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>
    >
{
  constructor(settings: OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>) {
    super({ settings });
  }

  readonly provider = "ollama";
  get modelName() {
    return this.settings.model;
  }

  readonly tokenizer = undefined;
  readonly countPromptTokens = undefined;

  get contextWindowSize(): CONTEXT_WINDOW_SIZE {
    return this.settings.contextWindowSize as CONTEXT_WINDOW_SIZE;
  }

  async callAPI<RESPONSE>(
    prompt: OllamaCompletionPrompt,
    options: {
      responseFormat: OllamaCompletionResponseFormatType<RESPONSE>;
    } & FunctionOptions
  ): Promise<RESPONSE> {
    const { responseFormat } = options;
    const api = this.settings.api ?? new OllamaApiConfiguration();
    const abortSignal = options.run?.abortSignal;

    return callWithRetryAndThrottle({
      retry: api.retry,
      throttle: api.throttle,
      call: async () =>
        postJsonToApi({
          url: api.assembleUrl(`/api/generate`),
          headers: api.headers,
          body: {
            stream: responseFormat.stream,
            model: this.settings.model,
            prompt: prompt.prompt,
            images: prompt.images,
            format: this.settings.format,
            options: {
              mirostat: this.settings.mirostat,
              mirostat_eta: this.settings.mirostatEta,
              mirostat_tau: this.settings.mirostatTau,
              num_ctx: this.settings.contextWindowSize,
              num_gpu: this.settings.numGpu,
              num_gqa: this.settings.numGqa,
              num_predict: this.settings.maxGenerationTokens,
              num_threads: this.settings.numThreads,
              repeat_last_n: this.settings.repeatLastN,
              repeat_penalty: this.settings.repeatPenalty,
              seed: this.settings.seed,
              stop: this.settings.stopSequences,
              temperature: this.settings.temperature,
              tfs_z: this.settings.tfsZ,
              top_k: this.settings.topK,
              top_p: this.settings.topP,
            },
            system: this.settings.system,
            template: this.settings.template,
            context: this.settings.context,
            raw: this.settings.raw,
          },
          failedResponseHandler: failedOllamaCallResponseHandler,
          successfulResponseHandler: responseFormat.handler,
          abortSignal,
        }),
    });
  }

  get settingsForEvent(): Partial<
    OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>
  > {
    const eventSettingProperties: Array<string> = [
      "maxGenerationTokens",
      "stopSequences",
      "contextWindowSize",
      "temperature",
      "mirostat",
      "mirostatEta",
      "mirostatTau",
      "numGqa",
      "numGpu",
      "numThreads",
      "repeatLastN",
      "repeatPenalty",
      "seed",
      "tfsZ",
      "topK",
      "topP",
      "system",
      "template",
      "context",
      "format",
      "raw",
    ] satisfies (keyof OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>)[];

    return Object.fromEntries(
      Object.entries(this.settings).filter(([key]) =>
        eventSettingProperties.includes(key)
      )
    );
  }

  async doGenerateTexts(
    prompt: OllamaCompletionPrompt,
    options?: FunctionOptions
  ) {
    const response = await this.callAPI(prompt, {
      ...options,
      responseFormat: OllamaCompletionResponseFormat.json,
    });

    return {
      response,
      texts: [response.response],
    };
  }

  doStreamText(prompt: OllamaCompletionPrompt, options?: FunctionOptions) {
    return this.callAPI(prompt, {
      ...options,
      responseFormat: OllamaCompletionResponseFormat.deltaIterable,
    });
  }

  asToolCallGenerationModel<INPUT_PROMPT>(
    promptTemplate: ToolCallPromptTemplate<INPUT_PROMPT, OllamaCompletionPrompt>
  ) {
    return new TextGenerationToolCallModel({
      model: this,
      format: promptTemplate,
    });
  }

  asToolCallsOrTextGenerationModel<INPUT_PROMPT>(
    promptTemplate: ToolCallsOrGenerateTextPromptTemplate<
      INPUT_PROMPT,
      OllamaCompletionPrompt
    >
  ) {
    return new TextGenerationToolCallsOrGenerateTextModel({
      model: this,
      template: promptTemplate,
    });
  }

  withTextPrompt(): PromptTemplateTextStreamingModel<
    string,
    OllamaCompletionPrompt,
    OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>,
    this
  > {
    return this.withPromptTemplate({
      format(prompt: string) {
        return { prompt: prompt };
      },
      stopSequences: [],
    });
  }

  withPromptTemplate<INPUT_PROMPT>(
    promptTemplate: TextGenerationPromptTemplate<
      INPUT_PROMPT,
      OllamaCompletionPrompt
    >
  ): PromptTemplateTextStreamingModel<
    INPUT_PROMPT,
    OllamaCompletionPrompt,
    OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>,
    this
  > {
    return new PromptTemplateTextStreamingModel({
      model: this.withSettings({
        stopSequences: [
          ...(this.settings.stopSequences ?? []),
          ...promptTemplate.stopSequences,
        ],
      }),
      promptTemplate,
    });
  }

  withSettings(
    additionalSettings: Partial<
      OllamaCompletionModelSettings<CONTEXT_WINDOW_SIZE>
    >
  ) {
    return new OllamaCompletionModel(
      Object.assign({}, this.settings, additionalSettings)
    ) as this;
  }
}

const ollamaCompletionResponseSchema = z.object({
  done: z.literal(true),
  model: z.string(),
  created_at: z.string(),
  response: z.string(),
  total_duration: z.number(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number(),
  eval_duration: z.number(),
  context: z.array(z.number()).optional(),
});

export type OllamaCompletionResponse = z.infer<
  typeof ollamaCompletionResponseSchema
>;

const ollamaCompletionStreamSchema = new ZodSchema(
  z.discriminatedUnion("done", [
    z.object({
      done: z.literal(false),
      model: z.string(),
      created_at: z.string(),
      response: z.string(),
    }),
    z.object({
      done: z.literal(true),
      model: z.string(),
      created_at: z.string(),
      total_duration: z.number(),
      load_duration: z.number().optional(),
      sample_count: z.number().optional(),
      sample_duration: z.number().optional(),
      prompt_eval_count: z.number(),
      prompt_eval_duration: z.number().optional(),
      eval_count: z.number(),
      eval_duration: z.number(),
      context: z.array(z.number()).optional(),
    }),
  ])
);

export type OllamaCompletionDelta = {
  content: string;
  isComplete: boolean;
  delta: string;
};

async function createOllamaFullDeltaIterableQueue(
  stream: ReadableStream<Uint8Array>
): Promise<AsyncIterable<Delta<string>>> {
  const queue = new AsyncQueue<Delta<string>>();

  let accumulatedText = "";

  // process the stream asynchonously (no 'await' on purpose):
  parseJsonStream({
    stream,
    schema: ollamaCompletionStreamSchema,
    process(event) {
      if (event.done === true) {
        queue.push({
          type: "delta",
          fullDelta: {
            content: accumulatedText,
            isComplete: true,
            delta: "",
          },
          valueDelta: "",
        });
      } else {
        accumulatedText += event.response;

        queue.push({
          type: "delta",
          fullDelta: {
            content: accumulatedText,
            isComplete: false,
            delta: event.response,
          },
          valueDelta: event.response,
        });
      }
    },
    onDone() {
      queue.close();
    },
  });

  return queue;
}

export type OllamaCompletionResponseFormatType<T> = {
  stream: boolean;
  handler: ResponseHandler<T>;
};

export const OllamaCompletionResponseFormat = {
  /**
   * Returns the response as a JSON object.
   */
  json: {
    stream: false,
    handler: (async ({ response, url, requestBodyValues }) => {
      const responseBody = await response.text();

      const parsedResult = safeParseJSON({
        text: responseBody,
        schema: new ZodSchema(
          z.union([
            ollamaCompletionResponseSchema,
            z.object({
              done: z.literal(false),
              model: z.string(),
              created_at: z.string(),
              response: z.string(),
            }),
          ])
        ),
      });

      if (!parsedResult.success) {
        throw new ApiCallError({
          message: "Invalid JSON response",
          cause: parsedResult.error,
          statusCode: response.status,
          responseBody,
          url,
          requestBodyValues,
        });
      }

      if (parsedResult.data.done === false) {
        throw new ApiCallError({
          message: "Incomplete Ollama response received",
          statusCode: response.status,
          responseBody,
          url,
          requestBodyValues,
          isRetryable: true,
        });
      }

      return parsedResult.data;
    }) satisfies ResponseHandler<OllamaCompletionResponse>,
  } satisfies OllamaCompletionResponseFormatType<OllamaCompletionResponse>,

  /**
   * Returns an async iterable over the full deltas (all choices, including full current state at time of event)
   * of the response stream.
   */
  deltaIterable: {
    stream: true,
    handler: async ({ response }: { response: Response }) =>
      createOllamaFullDeltaIterableQueue(response.body!),
  } satisfies OllamaCompletionResponseFormatType<AsyncIterable<Delta<string>>>,
};