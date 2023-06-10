import {
  TextGenerationFinishedEvent,
  TextGenerationStartedEvent,
} from "../model/text-generation/TextGenerationObserver.js";
import { RunObserver } from "./RunObserver.js";

export class ConsoleObserver implements RunObserver {
  onTextGenerationStarted(event: TextGenerationStartedEvent) {
    console.log(JSON.stringify(event, null, 2));
  }

  onTextGenerationFinished(event: TextGenerationFinishedEvent) {
    console.log(JSON.stringify(event, null, 2));
  }
}