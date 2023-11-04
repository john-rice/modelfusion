import { BaseUrlApiConfiguration } from "../../core/api/BaseUrlApiConfiguration.js";
import { RetryFunction } from "../../core/api/RetryFunction.js";
import { ThrottleFunction } from "../../core/api/ThrottleFunction.js";

export class OllamaApiConfiguration extends BaseUrlApiConfiguration {
  constructor({
    baseUrl = "http://127.0.0.1:11434",
    retry,
    throttle,
  }: {
    baseUrl?: string;
    retry?: RetryFunction;
    throttle?: ThrottleFunction;
  } = {}) {
    super({
      baseUrl,
      headers: {},
      retry,
      throttle,
    });
  }
}
